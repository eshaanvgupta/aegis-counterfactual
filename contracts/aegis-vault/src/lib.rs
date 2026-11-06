//! # AEGIS // Counterfactual — authorization vault
//!
//! A native-NEAR vault that lets an AI agent *propose* payments without ever being able
//! to *authorize* them.
//!
//! * The **owner** writes business mandates (`Authorization`) and the spending `Policy`.
//! * The **agent** may only `submit_intent` and `execute_intent`. It never holds a key
//!   for this account and cannot approve its own proposals.
//! * The **attestor** (a separate verifier process with its own key) approves or denies
//!   exactly one canonical intent hash, committing to an off-chain evidence hash.
//! * The **vault** re-checks every mandate and policy invariant at approval *and* at
//!   execution, reserves budget before the asynchronous transfer, and settles or
//!   releases the reservation in a private callback.
//!
//! AI findings are evidence only. No code path in this contract lets a model output,
//! a risk score or an evidence document move money: only an owner mandate that matches
//! the proposal field-for-field, under the current policy version, can.
//!
//! The numbered invariants in comments refer to `docs/THREAT_MODEL.md`.

use near_sdk::json_types::{U64, U128};
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, borsh, env,
    near, require,
};

/// Semantic version of the on-chain interface.
pub const CONTRACT_VERSION: &str = "1.0.0";
/// This prototype refuses to run anywhere except NEAR testnet.
pub const NETWORK_ID: &str = "testnet";
pub const ASSET_NEAR: &str = "NEAR";
pub const ACTION_NATIVE_TRANSFER: &str = "native_transfer";

const DAY_MS: u64 = 86_400_000;
const MAX_AUTHORIZATIONS: u32 = 256;
const MAX_RECIPIENTS: usize = 16;
/// Bounds how much vault-paid storage a compromised agent can consume per day.
const MAX_DAILY_INTENTS: u32 = 64;
/// The newest audit events kept in state. Every event is also emitted as a permanent
/// NEP-297 log, so older history remains available from the chain itself.
const AUDIT_CAPACITY: u64 = 128;
const MAX_PAGE: u32 = 50;
const MIN_EXECUTE_GAS: Gas = Gas::from_tgas(60);
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
/// Balance always left above the storage requirement (0.05 NEAR, about 5 KB of state),
/// so that bookkeeping writes in the current call can never starve the account.
const STORAGE_MARGIN: u128 = 50_000_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Authorizations,
    Intents,
    IntentIndex,
    AgentNonces,
    DailyBudgets,
    Audit,
}

/// The exact action a reviewer approves. Its Borsh encoding, hashed with SHA-256, is the
/// intent identity shared by Rust, TypeScript and Python (see
/// `packages/shared-types/canonical-vectors.json`). Field order is part of the format.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentFields {
    pub network_id: String,
    pub vault_id: AccountId,
    pub agent_id: AccountId,
    pub authorization_id: String,
    pub recipient: AccountId,
    pub asset: String,
    pub amount: U128,
    pub action: String,
    pub nonce: U64,
    pub expires_at_ms: U64,
    pub policy_version: U64,
    pub invoice_fingerprint: String,
    pub purpose_id: String,
}

/// Owner-controlled spending policy. Any change must increment `version`, which
/// invalidates every attestation and mandate issued under the previous version.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub version: U64,
    pub allowed_recipients: Vec<AccountId>,
    pub max_transaction: U128,
    pub daily_limit: U128,
    pub allowed_actions: Vec<String>,
    pub expires_at_ms: U64,
}

/// A business mandate written by the owner, independently of any invoice text the agent
/// reads. The agent's proposal must match it exactly.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Authorization {
    pub id: String,
    pub owner_id: AccountId,
    pub agent_id: AccountId,
    pub recipient: AccountId,
    pub amount: U128,
    pub max_total: U128,
    pub asset: String,
    pub purpose_id: String,
    pub invoice_fingerprint: String,
    pub expires_at_ms: U64,
    pub policy_version: U64,
    pub action: String,
    pub revoked: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Budget {
    pub spent: U128,
    pub reserved: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct AuthorizationRecord {
    pub authorization: Authorization,
    pub budget: Budget,
    pub created_at_ms: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IntentStatus {
    Proposed,
    Attested,
    Executing,
    Executed,
    Rejected,
    Failed,
    Expired,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct IntentRecord {
    pub intent: IntentFields,
    pub intent_hash: String,
    pub status: IntentStatus,
    pub proposed_at_ms: U64,
    pub evidence_hash: Option<String>,
    pub attested_by: Option<AccountId>,
    pub attested_at_ms: Option<U64>,
    pub agent_generation: U64,
    pub attestor_generation: Option<U64>,
    pub reservation_day: Option<U64>,
    pub settled_at_ms: Option<U64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct AuditEvent {
    pub id: U64,
    pub timestamp_ms: U64,
    pub caller: AccountId,
    pub event: String,
    /// Authorization ID or intent hash the event refers to, when there is one.
    pub subject: Option<String>,
}

/// Result of evaluating a proposal against current on-chain state without changing it.
#[near(serializers = [json])]
pub struct IntentCheck {
    pub intent_hash: String,
    pub executable: bool,
    pub violations: Vec<String>,
}

#[near(serializers = [json])]
pub struct VaultStatus {
    pub contract_version: String,
    pub network_id: String,
    pub vault_id: AccountId,
    pub owner_id: AccountId,
    pub agent_id: Option<AccountId>,
    pub attestor_id: AccountId,
    pub agent_generation: U64,
    pub attestor_generation: U64,
    pub paused: bool,
    pub balance: U128,
    pub storage_usage: U64,
    pub storage_cost: U128,
    pub available: U128,
    pub reserved: U128,
    pub pending_transfers: U64,
    pub today: Budget,
    pub daily_limit: U128,
    pub policy_version: U64,
    pub authorization_count: U64,
    pub intent_count: U64,
    pub intents_today: u32,
    pub audit_count: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner_id: AccountId,
    agent_id: Option<AccountId>,
    attestor_id: AccountId,
    /// Incremented on every agent change, so re-registering an agent cannot revive an
    /// old proposal (invariant 5, 17).
    agent_generation: u64,
    /// Incremented on every attestor change, so rotating away and back cannot revive an
    /// old approval (invariant 4).
    attestor_generation: u64,
    paused: bool,
    policy: Policy,
    authorizations: IterableMap<String, AuthorizationRecord>,
    intents: LookupMap<String, IntentRecord>,
    intent_index: Vector<String>,
    /// Highest nonce each agent has consumed. Nonces must strictly increase, so a
    /// proposal can never be replayed (invariant 12).
    agent_nonces: LookupMap<AccountId, u64>,
    daily_budgets: LookupMap<u64, Budget>,
    /// (UTC day, proposals submitted that day).
    intent_quota: (u64, u32),
    /// Sum of transfers dispatched but not yet settled by their callback.
    reserved: u128,
    pending_transfers: u64,
    audit: LookupMap<u64, AuditEvent>,
    audit_count: u64,
}

#[near]
impl Vault {
    /// Deploy and initialize in one transaction signed by the vault account itself, so
    /// that nobody can front-run initialization with their own principals.
    #[init]
    pub fn init(
        owner_id: AccountId,
        agent_id: AccountId,
        attestor_id: AccountId,
        policy: Policy,
    ) -> Self {
        let vault = env::current_account_id();
        require!(
            env::predecessor_account_id() == vault,
            "ATOMIC_VAULT_INITIALIZATION_ONLY"
        );
        require!(
            vault.as_str().ends_with(".testnet"),
            "TESTNET_ONLY_PROTOTYPE"
        );
        require!(
            owner_id != agent_id && owner_id != attestor_id && agent_id != attestor_id,
            "PRINCIPALS_MUST_DIFFER"
        );
        require!(
            vault != owner_id && vault != agent_id && vault != attestor_id,
            "VAULT_MUST_DIFFER"
        );
        Self::validate_policy(&policy);
        require!(policy.version.0 == 1, "INITIAL_POLICY_VERSION");
        let mut this = Self {
            owner_id,
            agent_id: Some(agent_id),
            attestor_id,
            agent_generation: 0,
            attestor_generation: 0,
            paused: false,
            policy,
            authorizations: IterableMap::new(StorageKey::Authorizations),
            intents: LookupMap::new(StorageKey::Intents),
            intent_index: Vector::new(StorageKey::IntentIndex),
            agent_nonces: LookupMap::new(StorageKey::AgentNonces),
            daily_budgets: LookupMap::new(StorageKey::DailyBudgets),
            intent_quota: (0, 0),
            reserved: 0,
            pending_transfers: 0,
            audit: LookupMap::new(StorageKey::Audit),
            audit_count: 0,
        };
        this.record("VAULT_INITIALIZED", None);
        this
    }

    /// Anyone may add testnet funds. Donations emit a log but allocate no state.
    #[payable]
    pub fn fund(&mut self) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "DEPOSIT_REQUIRED");
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"aegis\",\"version\":\"1.0.0\",\"event\":\"FUNDED\",\"data\":[{{\"caller\":\"{}\",\"amount\":\"{}\"}}]}}",
            env::predecessor_account_id(),
            amount
        ));
    }

    // ------------------------------------------------------------------ owner

    /// Invariant 2: only the owner creates business mandates.
    pub fn create_authorization(&mut self, authorization: Authorization) {
        self.assert_owner();
        require!(
            self.authorizations.len() < MAX_AUTHORIZATIONS,
            "AUTHORIZATION_CAPACITY"
        );
        Self::assert_identifier(&authorization.id, 80);
        Self::assert_identifier(&authorization.purpose_id, 160);
        Self::assert_digest(&authorization.invoice_fingerprint);
        require!(
            !self.authorizations.contains_key(&authorization.id),
            "AUTHORIZATION_EXISTS"
        );
        require!(authorization.owner_id == self.owner_id, "WRONG_OWNER");
        require!(
            self.agent_id.as_ref() == Some(&authorization.agent_id),
            "AGENT_NOT_REGISTERED"
        );
        require!(!authorization.revoked, "AUTHORIZATION_REVOKED");
        require!(
            authorization.asset == ASSET_NEAR && authorization.action == ACTION_NATIVE_TRANSFER,
            "UNSUPPORTED_ACTION"
        );
        require!(
            authorization.amount.0 > 0 && authorization.max_total.0 >= authorization.amount.0,
            "INVALID_AMOUNT"
        );
        require!(
            authorization.amount.0 <= self.policy.max_transaction.0,
            "MAX_TRANSACTION"
        );
        require!(
            authorization.policy_version == self.policy.version,
            "POLICY_VERSION"
        );
        require!(
            authorization.expires_at_ms.0 > Self::now_ms()
                && authorization.expires_at_ms.0 <= self.policy.expires_at_ms.0,
            "AUTHORIZATION_EXPIRY"
        );
        require!(
            self.policy
                .allowed_recipients
                .contains(&authorization.recipient),
            "RECIPIENT_NOT_ALLOWED"
        );
        let id = authorization.id.clone();
        self.authorizations.insert(
            id.clone(),
            AuthorizationRecord {
                authorization,
                budget: Budget::default(),
                created_at_ms: U64(Self::now_ms()),
            },
        );
        self.record("AUTHORIZATION_CREATED", Some(id));
    }

    /// Invariant 10: a revoked mandate can never be attested or executed again.
    pub fn revoke_authorization(&mut self, authorization_id: String) {
        self.assert_owner();
        let record = self
            .authorizations
            .get_mut(&authorization_id)
            .unwrap_or_else(|| env::panic_str("AUTHORIZATION_NOT_FOUND"));
        record.authorization.revoked = true;
        self.record("AUTHORIZATION_REVOKED", Some(authorization_id));
    }

    pub fn register_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        require!(
            agent_id != self.owner_id
                && agent_id != self.attestor_id
                && agent_id != env::current_account_id(),
            "PRINCIPALS_MUST_DIFFER"
        );
        self.agent_id = Some(agent_id.clone());
        self.agent_generation = self
            .agent_generation
            .checked_add(1)
            .expect("GENERATION_OVERFLOW");
        self.record("AGENT_REGISTERED", Some(agent_id.to_string()));
    }

    pub fn revoke_agent(&mut self) {
        self.assert_owner();
        self.agent_id = None;
        self.agent_generation = self
            .agent_generation
            .checked_add(1)
            .expect("GENERATION_OVERFLOW");
        self.record("AGENT_REVOKED", None);
    }

    pub fn set_attestor(&mut self, attestor_id: AccountId) {
        self.assert_owner();
        require!(
            attestor_id != self.owner_id
                && self.agent_id.as_ref() != Some(&attestor_id)
                && attestor_id != env::current_account_id(),
            "PRINCIPALS_MUST_DIFFER"
        );
        self.attestor_id = attestor_id.clone();
        self.attestor_generation = self
            .attestor_generation
            .checked_add(1)
            .expect("GENERATION_OVERFLOW");
        self.record("ATTESTOR_CHANGED", Some(attestor_id.to_string()));
    }

    /// Invariants 1 and 11: only the owner changes policy, and every change increments
    /// the version so that nothing approved under the old policy can execute.
    pub fn set_policy(&mut self, policy: Policy) {
        self.assert_owner();
        Self::validate_policy(&policy);
        let next = self
            .policy
            .version
            .0
            .checked_add(1)
            .expect("VERSION_OVERFLOW");
        require!(policy.version.0 == next, "POLICY_MUST_INCREMENT");
        self.policy = policy;
        self.record("POLICY_CHANGED", Some(next.to_string()));
    }

    /// Invariant 16: a paused vault rejects agent submissions, approvals and execution.
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        self.record("PAUSED", None);
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        self.record("UNPAUSED", None);
    }

    /// Owner custody escape hatch. Only while paused with no transfer in flight, and never
    /// below the storage requirement. This is a deliberate trust assumption: the owner
    /// can always recover custody of testnet funds (see docs/THREAT_MODEL.md).
    pub fn emergency_recover(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        require!(
            self.paused && self.pending_transfers == 0,
            "RECOVERY_REQUIRES_PAUSED_IDLE_VAULT"
        );
        require!(
            amount.0 > 0 && amount.0 <= self.available_balance(),
            "INSUFFICIENT_AVAILABLE_BALANCE"
        );
        self.record("OWNER_EMERGENCY_RECOVERY", Some(amount.0.to_string()));
        Promise::new(self.owner_id.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ------------------------------------------------------------------ agent

    /// Invariant 3: only the registered agent proposes. Proposals are recorded even when
    /// they violate the mandate: the attempted action is itself security evidence. A
    /// proposal can never move funds without an attestation that passes every check.
    pub fn submit_intent(&mut self, intent: IntentFields) -> String {
        self.assert_agent();
        require!(!self.paused, "VAULT_PAUSED");
        require!(
            intent.agent_id == env::predecessor_account_id(),
            "WRONG_AGENT"
        );
        require!(
            intent.network_id == NETWORK_ID && intent.vault_id == env::current_account_id(),
            "WRONG_DOMAIN"
        );
        Self::assert_identifier(&intent.authorization_id, 80);
        Self::assert_identifier(&intent.purpose_id, 160);
        Self::assert_bounded(&intent.asset, 16);
        Self::assert_bounded(&intent.action, 32);
        Self::assert_digest(&intent.invoice_fingerprint);
        require!(intent.amount.0 > 0, "INVALID_AMOUNT");
        let last_nonce = self.agent_nonces.get(&intent.agent_id).copied().unwrap_or(0);
        require!(intent.nonce.0 > last_nonce, "NONCE_REPLAY");

        let today = Self::now_ms() / DAY_MS;
        let submitted_today = if self.intent_quota.0 == today {
            self.intent_quota.1
        } else {
            0
        };
        require!(
            submitted_today < MAX_DAILY_INTENTS,
            "DAILY_INTENT_QUOTA"
        );

        let intent_hash = Self::hash_intent(&intent);
        require!(!self.intents.contains_key(&intent_hash), "INTENT_EXISTS");

        self.intent_quota = (today, submitted_today + 1);
        self.agent_nonces
            .insert(intent.agent_id.clone(), intent.nonce.0);
        self.intent_index.push(intent_hash.clone());
        self.intents.insert(
            intent_hash.clone(),
            IntentRecord {
                intent,
                intent_hash: intent_hash.clone(),
                status: IntentStatus::Proposed,
                proposed_at_ms: U64(Self::now_ms()),
                evidence_hash: None,
                attested_by: None,
                attested_at_ms: None,
                agent_generation: U64(self.agent_generation),
                attestor_generation: None,
                reservation_day: None,
                settled_at_ms: None,
            },
        );
        self.record("INTENT_PROPOSED", Some(intent_hash.clone()));
        intent_hash
    }

    /// Invariants 6–20 are re-checked here, immediately before funds move.
    pub fn execute_intent(&mut self, intent_hash: String) -> Promise {
        self.assert_agent();
        require!(!self.paused, "VAULT_PAUSED");
        require!(
            env::prepaid_gas().as_gas() >= MIN_EXECUTE_GAS.as_gas(),
            "INSUFFICIENT_GAS"
        );
        let mut record = self.load_intent(&intent_hash);
        // Invariants 13 and 19: only an ATTESTED intent runs, and execution immediately
        // moves it to EXECUTING, so it can never be dispatched twice.
        require!(
            record.status == IntentStatus::Attested,
            "INTENT_NOT_ATTESTED"
        );
        require!(
            record.attested_by.as_ref() == Some(&self.attestor_id),
            "ATTESTOR_CHANGED"
        );
        require!(
            record.attestor_generation == Some(U64(self.attestor_generation)),
            "ATTESTOR_GENERATION"
        );
        require!(
            record.agent_generation.0 == self.agent_generation,
            "AGENT_GENERATION"
        );
        require!(record.evidence_hash.is_some(), "MISSING_EVIDENCE");
        // Invariants 6–8: the approval is bound to the exact canonical intent hash.
        require!(
            Self::hash_intent(&record.intent) == intent_hash,
            "INTENT_HASH_MISMATCH"
        );
        self.assert_executable(&record.intent);
        let amount = record.intent.amount.0;
        // Invariant 14: never spend balance that backs storage.
        require!(
            amount <= self.available_balance(),
            "INSUFFICIENT_AVAILABLE_BALANCE"
        );

        // Invariant 15: reserve budget synchronously, before the asynchronous transfer.
        let day = Self::now_ms() / DAY_MS;
        let mut day_budget = self.daily_budgets.get(&day).cloned().unwrap_or_default();
        day_budget.reserved.0 = day_budget
            .reserved
            .0
            .checked_add(amount)
            .expect("AMOUNT_OVERFLOW");
        self.daily_budgets.insert(day, day_budget);
        let mandate = self
            .authorizations
            .get_mut(&record.intent.authorization_id)
            .unwrap_or_else(|| env::panic_str("AUTHORIZATION_NOT_FOUND"));
        mandate.budget.reserved.0 = mandate
            .budget
            .reserved
            .0
            .checked_add(amount)
            .expect("AMOUNT_OVERFLOW");
        self.reserved = self.reserved.checked_add(amount).expect("AMOUNT_OVERFLOW");
        self.pending_transfers = self
            .pending_transfers
            .checked_add(1)
            .expect("COUNT_OVERFLOW");

        record.status = IntentStatus::Executing;
        record.reservation_day = Some(U64(day));
        let recipient = record.intent.recipient.clone();
        self.intents.insert(intent_hash.clone(), record);
        self.record("TRANSFER_RESERVED", Some(intent_hash.clone()));

        Promise::new(recipient)
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_execution_complete(intent_hash),
            )
    }

    // --------------------------------------------------------------- attestor

    /// Invariant 4: only the registered attestor reviews, and it reviews exactly one
    /// canonical intent hash, committing to the hash of its off-chain evidence (the
    /// Counterfactual Verification Receipt). Approval re-runs every deterministic
    /// check, so even a deceived attestor cannot approve a mismatched proposal.
    pub fn attest_intent(&mut self, intent_hash: String, evidence_hash: String, approved: bool) {
        require!(
            env::predecessor_account_id() == self.attestor_id,
            "ATTESTOR_ONLY"
        );
        Self::assert_digest(&evidence_hash);
        let mut record = self.load_intent(&intent_hash);
        require!(
            record.status == IntentStatus::Proposed,
            "INVALID_INTENT_STATE"
        );
        require!(
            Self::hash_intent(&record.intent) == intent_hash,
            "INTENT_HASH_MISMATCH"
        );
        let expired = Self::now_ms() >= record.intent.expires_at_ms.0;
        let (status, event) = if approved {
            require!(!self.paused, "VAULT_PAUSED");
            require!(
                record.agent_generation.0 == self.agent_generation,
                "AGENT_GENERATION"
            );
            self.assert_executable(&record.intent);
            (IntentStatus::Attested, "INTENT_ATTESTED")
        } else if expired {
            (IntentStatus::Expired, "INTENT_EXPIRED")
        } else {
            (IntentStatus::Rejected, "INTENT_DENIED")
        };
        record.status = status;
        record.evidence_hash = Some(evidence_hash);
        record.attested_by = Some(self.attestor_id.clone());
        record.attested_at_ms = Some(U64(Self::now_ms()));
        record.attestor_generation = Some(U64(self.attestor_generation));
        self.intents.insert(intent_hash.clone(), record);
        self.record(event, Some(intent_hash));
    }

    // ------------------------------------------------------------ settlement

    /// Invariants 18 and 20: only the vault itself can deliver this callback. A failed
    /// transfer releases its reservation (its nonce stays consumed); a successful one
    /// converts the reservation into spent budget.
    #[private]
    pub fn on_execution_complete(&mut self, intent_hash: String) -> bool {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_CALLBACK"
        );
        require!(
            env::promise_results_count() == 1,
            "CALLBACK_RESULT_REQUIRED"
        );
        let mut record = self.load_intent(&intent_hash);
        require!(
            record.status == IntentStatus::Executing,
            "INVALID_CALLBACK_STATE"
        );
        let successful = match env::promise_result_checked(0, 0) {
            Ok(_) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => env::panic_str("UNEXPECTED_NATIVE_TRANSFER_RESULT"),
        };
        let amount = record.intent.amount.0;
        let day = record
            .reservation_day
            .unwrap_or_else(|| env::panic_str("MISSING_RESERVATION_DAY"))
            .0;

        let mut day_budget = self
            .daily_budgets
            .get(&day)
            .cloned()
            .unwrap_or_else(|| env::panic_str("MISSING_DAY_BUDGET"));
        day_budget.reserved.0 = day_budget
            .reserved
            .0
            .checked_sub(amount)
            .expect("ACCOUNTING_UNDERFLOW");
        if successful {
            day_budget.spent.0 = day_budget
                .spent
                .0
                .checked_add(amount)
                .expect("AMOUNT_OVERFLOW");
        }
        self.daily_budgets.insert(day, day_budget);

        let mandate = self
            .authorizations
            .get_mut(&record.intent.authorization_id)
            .unwrap_or_else(|| env::panic_str("AUTHORIZATION_NOT_FOUND"));
        mandate.budget.reserved.0 = mandate
            .budget
            .reserved
            .0
            .checked_sub(amount)
            .expect("ACCOUNTING_UNDERFLOW");
        if successful {
            mandate.budget.spent.0 = mandate
                .budget
                .spent
                .0
                .checked_add(amount)
                .expect("AMOUNT_OVERFLOW");
        }

        self.reserved = self
            .reserved
            .checked_sub(amount)
            .expect("ACCOUNTING_UNDERFLOW");
        self.pending_transfers = self
            .pending_transfers
            .checked_sub(1)
            .expect("ACCOUNTING_UNDERFLOW");
        record.status = if successful {
            IntentStatus::Executed
        } else {
            IntentStatus::Failed
        };
        record.settled_at_ms = Some(U64(Self::now_ms()));
        self.intents.insert(intent_hash.clone(), record);
        self.record(
            if successful {
                "TRANSFER_EXECUTED"
            } else {
                "TRANSFER_FAILED_QUOTA_RELEASED"
            },
            Some(intent_hash),
        );
        successful
    }

    /// Finalize a provably stale proposal or approval. Anyone may call it: it moves no
    /// value and only applies once the intent's own expiry has passed.
    pub fn expire_intent(&mut self, intent_hash: String) {
        let mut record = self.load_intent(&intent_hash);
        require!(
            matches!(
                record.status,
                IntentStatus::Proposed | IntentStatus::Attested
            ),
            "INVALID_INTENT_STATE"
        );
        require!(
            Self::now_ms() >= record.intent.expires_at_ms.0,
            "INTENT_NOT_EXPIRED"
        );
        record.status = IntentStatus::Expired;
        record.settled_at_ms = Some(U64(Self::now_ms()));
        self.intents.insert(intent_hash.clone(), record);
        self.record("INTENT_EXPIRED", Some(intent_hash));
    }

    // ------------------------------------------------------------------ views

    pub fn get_intent(&self, intent_hash: String) -> Option<IntentRecord> {
        self.intents.get(&intent_hash).cloned()
    }

    /// Intents in submission order, starting at `from_index`.
    pub fn get_intents(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<IntentRecord> {
        let start = from_index.map_or(0, |i| i.0);
        let limit = u64::from(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE));
        let end = start
            .saturating_add(limit)
            .min(u64::from(self.intent_index.len()));
        (start..end)
            .filter_map(|i| self.intent_index.get(i as u32))
            .filter_map(|hash| self.intents.get(hash).cloned())
            .collect()
    }

    /// The newest intents first.
    pub fn get_recent_intents(&self, limit: Option<u32>) -> Vec<IntentRecord> {
        let limit = limit.unwrap_or(20).min(MAX_PAGE);
        let total = self.intent_index.len();
        (0..limit.min(total))
            .filter_map(|offset| self.intent_index.get(total - 1 - offset))
            .filter_map(|hash| self.intents.get(hash).cloned())
            .collect()
    }

    pub fn get_authorization(&self, authorization_id: String) -> Option<Authorization> {
        self.authorizations
            .get(&authorization_id)
            .map(|record| record.authorization.clone())
    }

    pub fn get_authorization_budget(&self, authorization_id: String) -> Option<Budget> {
        self.authorizations
            .get(&authorization_id)
            .map(|record| record.budget.clone())
    }

    pub fn get_authorizations(
        &self,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<AuthorizationRecord> {
        let start = from_index.map_or(0, |i| i.0) as usize;
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.authorizations
            .iter()
            .skip(start)
            .take(limit)
            .map(|(_, record)| record.clone())
            .collect()
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_agent_nonce(&self, agent_id: AccountId) -> U64 {
        U64(self.agent_nonces.get(&agent_id).copied().unwrap_or(0))
    }

    pub fn get_audit_event(&self, event_id: U64) -> Option<AuditEvent> {
        self.audit
            .get(&(event_id.0 % AUDIT_CAPACITY))
            .filter(|event| event.id == event_id)
            .cloned()
    }

    /// The newest audit events first (at most the in-state ring of 128).
    pub fn get_recent_audit(&self, limit: Option<u32>) -> Vec<AuditEvent> {
        let limit = u64::from(limit.unwrap_or(20).min(MAX_PAGE));
        let available = self.audit_count.min(AUDIT_CAPACITY);
        (0..limit.min(available))
            .filter_map(|offset| self.get_audit_event(U64(self.audit_count - 1 - offset)))
            .collect()
    }

    pub fn get_vault_status(&self) -> VaultStatus {
        let today = self
            .daily_budgets
            .get(&(Self::now_ms() / DAY_MS))
            .cloned()
            .unwrap_or_default();
        let intents_today = if self.intent_quota.0 == Self::now_ms() / DAY_MS {
            self.intent_quota.1
        } else {
            0
        };
        VaultStatus {
            contract_version: CONTRACT_VERSION.into(),
            network_id: NETWORK_ID.into(),
            vault_id: env::current_account_id(),
            owner_id: self.owner_id.clone(),
            agent_id: self.agent_id.clone(),
            attestor_id: self.attestor_id.clone(),
            agent_generation: U64(self.agent_generation),
            attestor_generation: U64(self.attestor_generation),
            paused: self.paused,
            balance: U128(env::account_balance().as_yoctonear()),
            storage_usage: U64(env::storage_usage()),
            storage_cost: U128(Self::storage_cost()),
            available: U128(self.available_balance()),
            reserved: U128(self.reserved),
            pending_transfers: U64(self.pending_transfers),
            today,
            daily_limit: self.policy.daily_limit,
            policy_version: self.policy.version,
            authorization_count: U64(u64::from(self.authorizations.len())),
            intent_count: U64(u64::from(self.intent_index.len())),
            intents_today,
            audit_count: U64(self.audit_count),
        }
    }

    pub fn canonical_intent_hash(&self, intent: IntentFields) -> String {
        Self::hash_intent(&intent)
    }

    /// Every invariant the proposal would violate if executed right now. The same
    /// function backs `attest_intent(approved=true)` and `execute_intent`.
    pub fn check_intent(&self, intent: IntentFields) -> IntentCheck {
        let violations: Vec<String> = self
            .violations(&intent)
            .into_iter()
            .map(String::from)
            .collect();
        IntentCheck {
            intent_hash: Self::hash_intent(&intent),
            executable: violations.is_empty(),
            violations,
        }
    }
}

impl Vault {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "OWNER_ONLY");
    }

    fn assert_agent(&self) {
        require!(
            self.agent_id.as_ref() == Some(&env::predecessor_account_id()),
            "AGENT_ONLY"
        );
    }

    fn load_intent(&self, intent_hash: &str) -> IntentRecord {
        self.intents
            .get(intent_hash)
            .cloned()
            .unwrap_or_else(|| env::panic_str("INTENT_NOT_FOUND"))
    }

    fn now_ms() -> u64 {
        env::block_timestamp() / 1_000_000
    }

    fn assert_bounded(value: &str, maximum: usize) {
        require!(
            !value.is_empty() && value.len() <= maximum,
            "INVALID_FIELD_LENGTH"
        );
    }

    /// Mandate and purpose identifiers: `[A-Za-z0-9._:-]{1,max}`. Keeps event logs
    /// well-formed JSON and identifiers unambiguous across languages.
    fn assert_identifier(value: &str, maximum: usize) {
        Self::assert_bounded(value, maximum);
        require!(
            value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-')),
            "INVALID_IDENTIFIER"
        );
    }

    fn assert_digest(value: &str) {
        require!(
            value.len() == 64
                && value
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "INVALID_HASH"
        );
    }

    /// SHA-256 over the Borsh encoding of the intent, as lowercase hex.
    pub fn hash_intent(intent: &IntentFields) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let digest = env::sha256(borsh::to_vec(intent).expect("CANONICAL_ENCODING_FAILED"));
        let mut out = String::with_capacity(64);
        for byte in digest {
            out.push(HEX[usize::from(byte >> 4)] as char);
            out.push(HEX[usize::from(byte & 0x0f)] as char);
        }
        out
    }

    fn validate_policy(policy: &Policy) {
        require!(
            policy.max_transaction.0 > 0 && policy.daily_limit.0 >= policy.max_transaction.0,
            "INVALID_POLICY_LIMITS"
        );
        require!(
            !policy.allowed_recipients.is_empty()
                && policy.allowed_recipients.len() <= MAX_RECIPIENTS,
            "INVALID_RECIPIENTS"
        );
        require!(
            policy.allowed_actions == [ACTION_NATIVE_TRANSFER],
            "UNSUPPORTED_ACTION"
        );
        require!(policy.expires_at_ms.0 > Self::now_ms(), "POLICY_EXPIRED");
    }

    /// The single source of truth for "may this exact proposal move money now?".
    /// Returns every violated invariant so failures are fully explained on-chain.
    fn violations(&self, intent: &IntentFields) -> Vec<&'static str> {
        let now = Self::now_ms();
        let mut found = Vec::new();
        if self.paused {
            found.push("VAULT_PAUSED");
        }
        if intent.network_id != NETWORK_ID || intent.vault_id != env::current_account_id() {
            found.push("WRONG_DOMAIN");
        }
        if self.agent_id.as_ref() != Some(&intent.agent_id) {
            found.push("AGENT_NOT_REGISTERED");
        }
        if intent.asset != ASSET_NEAR
            || intent.action != ACTION_NATIVE_TRANSFER
            || !self.policy.allowed_actions.contains(&intent.action)
        {
            found.push("UNSUPPORTED_ACTION");
        }
        if !self.policy.allowed_recipients.contains(&intent.recipient) {
            found.push("RECIPIENT_NOT_ALLOWED");
        }
        if intent.amount.0 == 0 || intent.amount.0 > self.policy.max_transaction.0 {
            found.push("MAX_TRANSACTION");
        }
        if intent.policy_version != self.policy.version {
            found.push("POLICY_VERSION");
        }
        if now >= intent.expires_at_ms.0 || now >= self.policy.expires_at_ms.0 {
            found.push("INTENT_EXPIRED");
        }
        match self.authorizations.get(&intent.authorization_id) {
            None => found.push("AUTHORIZATION_NOT_FOUND"),
            Some(record) => {
                let auth = &record.authorization;
                if auth.revoked {
                    found.push("AUTHORIZATION_REVOKED");
                }
                if now >= auth.expires_at_ms.0 || intent.expires_at_ms.0 > auth.expires_at_ms.0 {
                    found.push("AUTHORIZATION_EXPIRED");
                }
                if auth.agent_id != intent.agent_id || auth.owner_id != self.owner_id {
                    found.push("AUTHORIZATION_PRINCIPAL");
                }
                if auth.policy_version != self.policy.version {
                    found.push("AUTHORIZATION_POLICY_VERSION");
                }
                if auth.recipient != intent.recipient {
                    found.push("AUTHORIZATION_RECIPIENT");
                }
                if auth.amount != intent.amount {
                    found.push("AUTHORIZATION_AMOUNT");
                }
                if auth.asset != intent.asset || auth.action != intent.action {
                    found.push("AUTHORIZATION_ACTION");
                }
                if auth.invoice_fingerprint != intent.invoice_fingerprint {
                    found.push("INVOICE_MISMATCH");
                }
                if auth.purpose_id != intent.purpose_id {
                    found.push("PURPOSE_MISMATCH");
                }
                let within_mandate = record
                    .budget
                    .spent
                    .0
                    .checked_add(record.budget.reserved.0)
                    .and_then(|n| n.checked_add(intent.amount.0))
                    .is_some_and(|n| n <= auth.max_total.0);
                if !within_mandate {
                    found.push("AUTHORIZATION_BUDGET");
                }
            }
        }
        let day = self
            .daily_budgets
            .get(&(now / DAY_MS))
            .cloned()
            .unwrap_or_default();
        let within_day = day
            .spent
            .0
            .checked_add(day.reserved.0)
            .and_then(|n| n.checked_add(intent.amount.0))
            .is_some_and(|n| n <= self.policy.daily_limit.0);
        if !within_day {
            found.push("DAILY_BUDGET");
        }
        found
    }

    fn assert_executable(&self, intent: &IntentFields) {
        let violations = self.violations(intent);
        if !violations.is_empty() {
            env::panic_str(&format!("POLICY_VIOLATION:{}", violations.join(",")));
        }
    }

    fn storage_cost() -> u128 {
        u128::from(env::storage_usage()).saturating_mul(env::storage_byte_cost().as_yoctonear())
    }

    /// Balance that may leave the vault. A dispatched transfer is deducted from the
    /// account balance immediately, so in-flight amounts are not subtracted twice.
    fn available_balance(&self) -> u128 {
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(Self::storage_cost())
            .saturating_sub(STORAGE_MARGIN)
    }

    fn record(&mut self, event: &str, subject: Option<String>) {
        let id = self.audit_count;
        let entry = AuditEvent {
            id: U64(id),
            timestamp_ms: U64(Self::now_ms()),
            caller: env::predecessor_account_id(),
            event: event.into(),
            subject,
        };
        let subject_json = entry
            .subject
            .as_ref()
            .map_or("null".to_string(), |s| format!("\"{s}\""));
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"aegis\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{{\"id\":\"{}\",\"timestamp_ms\":\"{}\",\"caller\":\"{}\",\"subject\":{}}}]}}",
            entry.event, id, entry.timestamp_ms.0, entry.caller, subject_json
        ));
        self.audit.insert(id % AUDIT_CAPACITY, entry);
        self.audit_count = id.checked_add(1).expect("AUDIT_OVERFLOW");
    }
}

#[cfg(test)]
mod tests;
