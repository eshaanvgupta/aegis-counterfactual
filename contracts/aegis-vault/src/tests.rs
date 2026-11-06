//! Mocked-runtime tests for every security invariant in docs/THREAT_MODEL.md.
//! Real-network behaviour is exercised separately by `pnpm testnet:e2e`.
use super::*;
use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const PAYMENT: u128 = NEAR / 20; // 0.05 NEAR
const NOW_MS: u64 = 1_000;

fn account(id: &str) -> AccountId {
    id.parse().unwrap()
}

fn context(caller: &str, now_ms: u64) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account("vault.testnet"))
        .predecessor_account_id(account(caller))
        .signer_account_id(account(caller))
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(now_ms * 1_000_000);
    builder
}

fn as_caller(caller: &str) {
    testing_env!(context(caller, NOW_MS).build());
}

fn as_caller_at(caller: &str, now_ms: u64) {
    testing_env!(context(caller, now_ms).build());
}

fn policy() -> Policy {
    Policy {
        version: U64(1),
        allowed_recipients: vec![account("vendor.testnet"), account("other.testnet")],
        max_transaction: U128(PAYMENT),
        daily_limit: U128(2 * PAYMENT),
        allowed_actions: vec![ACTION_NATIVE_TRANSFER.into()],
        expires_at_ms: U64(1_000_000),
    }
}

fn authorization(id: &str) -> Authorization {
    Authorization {
        id: id.into(),
        owner_id: account("owner.testnet"),
        agent_id: account("agent.testnet"),
        recipient: account("vendor.testnet"),
        amount: U128(PAYMENT),
        max_total: U128(PAYMENT),
        asset: ASSET_NEAR.into(),
        purpose_id: "compute-services".into(),
        invoice_fingerprint: "ab".repeat(32),
        expires_at_ms: U64(900_000),
        policy_version: U64(1),
        action: ACTION_NATIVE_TRANSFER.into(),
        revoked: false,
    }
}

fn intent(nonce: u64, authorization_id: &str) -> IntentFields {
    IntentFields {
        network_id: NETWORK_ID.into(),
        vault_id: account("vault.testnet"),
        agent_id: account("agent.testnet"),
        authorization_id: authorization_id.into(),
        recipient: account("vendor.testnet"),
        asset: ASSET_NEAR.into(),
        amount: U128(PAYMENT),
        action: ACTION_NATIVE_TRANSFER.into(),
        nonce: U64(nonce),
        expires_at_ms: U64(800_000),
        policy_version: U64(1),
        invoice_fingerprint: "ab".repeat(32),
        purpose_id: "compute-services".into(),
    }
}

fn new_vault() -> Vault {
    as_caller("vault.testnet");
    Vault::init(
        account("owner.testnet"),
        account("agent.testnet"),
        account("attestor.testnet"),
        policy(),
    )
}

fn vault() -> Vault {
    let mut v = new_vault();
    as_caller("owner.testnet");
    v.create_authorization(authorization("INV-2026-001"));
    v
}

fn propose(v: &mut Vault, fields: IntentFields) -> String {
    as_caller("agent.testnet");
    v.submit_intent(fields)
}

fn attest(v: &mut Vault, hash: &str, approved: bool) {
    as_caller("attestor.testnet");
    v.attest_intent(hash.into(), "cd".repeat(32), approved);
}

fn ready(v: &mut Vault) -> String {
    let hash = propose(v, intent(1, "INV-2026-001"));
    attest(v, &hash, true);
    hash
}

fn execute(v: &mut Vault, hash: &str) {
    as_caller("agent.testnet");
    drop(v.execute_intent(hash.into()));
}

fn callback(v: &mut Vault, hash: &str, success: bool, now_ms: u64) -> bool {
    testing_env!(
        context("vault.testnet", now_ms).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![if success {
            PromiseResult::Successful(vec![])
        } else {
            PromiseResult::Failed
        }]
    );
    v.on_execution_complete(hash.into())
}

fn status(v: &Vault, hash: &str) -> IntentStatus {
    v.get_intent(hash.into()).unwrap().status
}

// ----------------------------------------------------------- initialization

#[test]
#[should_panic(expected = "ATOMIC_VAULT_INITIALIZATION_ONLY")]
fn third_party_cannot_initialize() {
    as_caller("attacker.testnet");
    Vault::init(
        account("owner.testnet"),
        account("agent.testnet"),
        account("attestor.testnet"),
        policy(),
    );
}

#[test]
#[should_panic(expected = "PRINCIPALS_MUST_DIFFER")]
fn agent_and_attestor_must_be_distinct() {
    as_caller("vault.testnet");
    Vault::init(
        account("owner.testnet"),
        account("agent.testnet"),
        account("agent.testnet"),
        policy(),
    );
}

#[test]
#[should_panic(expected = "TESTNET_ONLY_PROTOTYPE")]
fn refuses_to_initialize_outside_testnet() {
    let mut ctx = context("vault.near", NOW_MS);
    ctx.current_account_id(account("vault.near"));
    testing_env!(ctx.build());
    Vault::init(
        account("owner.near"),
        account("agent.near"),
        account("attestor.near"),
        policy(),
    );
}

#[test]
fn valid_authorization_accepted_and_recorded() {
    let v = vault();
    let auth = v.get_authorization("INV-2026-001".into()).unwrap();
    assert_eq!(auth.owner_id, account("owner.testnet"));
    assert_eq!(v.get_authorization_budget("INV-2026-001".into()), Some(Budget::default()));
    assert_eq!(v.get_authorizations(None, None).len(), 1);
    assert_eq!(v.get_vault_status().authorization_count, U64(1));
}

// ------------------------------------------------------------ access control

#[test]
#[should_panic(expected = "OWNER_ONLY")]
fn agent_cannot_change_policy() {
    let mut v = vault();
    as_caller("agent.testnet");
    let mut p = policy();
    p.version = U64(2);
    v.set_policy(p);
}

#[test]
#[should_panic(expected = "OWNER_ONLY")]
fn agent_cannot_create_authorization() {
    let mut v = vault();
    as_caller("agent.testnet");
    v.create_authorization(authorization("FORGED-1"));
}

#[test]
#[should_panic(expected = "OWNER_ONLY")]
fn attestor_cannot_pause() {
    let mut v = vault();
    as_caller("attestor.testnet");
    v.pause();
}

#[test]
#[should_panic(expected = "OWNER_ONLY")]
fn agent_cannot_register_itself_as_attestor() {
    let mut v = vault();
    as_caller("agent.testnet");
    v.set_attestor(account("agent.testnet"));
}

#[test]
#[should_panic(expected = "AGENT_ONLY")]
fn unregistered_account_cannot_propose() {
    let mut v = vault();
    as_caller("attacker.testnet");
    v.submit_intent(intent(1, "INV-2026-001"));
}

#[test]
#[should_panic(expected = "ATTESTOR_ONLY")]
fn agent_cannot_attest_its_own_proposal() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    v.attest_intent(h, "cd".repeat(32), true);
}

#[test]
#[should_panic(expected = "ATTESTOR_ONLY")]
fn owner_cannot_attest_either() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    as_caller("owner.testnet");
    v.attest_intent(h, "cd".repeat(32), true);
}

#[test]
#[should_panic(expected = "AGENT_ONLY")]
fn attestor_cannot_execute() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("attestor.testnet");
    drop(v.execute_intent(h));
}

#[test]
#[should_panic(expected = "WRONG_AGENT")]
fn agent_cannot_propose_on_behalf_of_another_agent() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.agent_id = account("other-agent.testnet");
    propose(&mut v, i);
}

#[test]
#[should_panic(expected = "WRONG_DOMAIN")]
fn wrong_network_rejected_at_submission() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.network_id = "mainnet".into();
    propose(&mut v, i);
}

#[test]
#[should_panic(expected = "INVALID_IDENTIFIER")]
fn identifiers_are_restricted_to_a_safe_charset() {
    let mut v = new_vault();
    as_caller("owner.testnet");
    v.create_authorization(authorization("INV\"},{\"evil"));
}

// ------------------------------------------------- mandate binding (6–11)

#[test]
#[should_panic(expected = "AUTHORIZATION_RECIPIENT")]
fn attestor_cannot_approve_redirected_recipient_even_if_policy_allows_it() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.recipient = account("other.testnet");
    let h = propose(&mut v, i);
    attest(&mut v, &h, true);
}

#[test]
#[should_panic(expected = "AUTHORIZATION_AMOUNT")]
fn attestor_cannot_approve_changed_amount_even_under_policy_cap() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.amount = U128(PAYMENT / 2);
    let h = propose(&mut v, i);
    attest(&mut v, &h, true);
}

#[test]
fn malicious_proposal_reports_every_violated_invariant() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.recipient = account("attacker.testnet");
    i.amount = U128(PAYMENT * 10);
    let check = v.check_intent(i.clone());
    assert!(!check.executable);
    for expected in [
        "RECIPIENT_NOT_ALLOWED",
        "MAX_TRANSACTION",
        "AUTHORIZATION_RECIPIENT",
        "AUTHORIZATION_AMOUNT",
        "AUTHORIZATION_BUDGET",
        "DAILY_BUDGET",
    ] {
        assert!(
            check.violations.iter().any(|v| v == expected),
            "missing {expected}: {:?}",
            check.violations
        );
    }
    // The proposal itself is still recorded as evidence of the attempted action.
    let h = propose(&mut v, i);
    assert_eq!(status(&v, &h), IntentStatus::Proposed);
}

#[test]
fn legitimate_proposal_has_no_violations() {
    let v = vault();
    let check = v.check_intent(intent(1, "INV-2026-001"));
    assert!(check.executable, "{:?}", check.violations);
    assert_eq!(check.intent_hash, Vault::hash_intent(&intent(1, "INV-2026-001")));
}

#[test]
#[should_panic(expected = "AUTHORIZATION_EXPIRED")]
fn expired_mandate_rejected() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    v.authorizations
        .get_mut("INV-2026-001")
        .unwrap()
        .authorization
        .expires_at_ms = U64(500);
    attest(&mut v, &h, true);
}

#[test]
#[should_panic(expected = "INTENT_EXPIRED")]
fn expired_intent_cannot_execute() {
    let mut v = vault();
    let h = ready(&mut v);
    let mut ctx = context("agent.testnet", 850_000);
    ctx.prepaid_gas(Gas::from_tgas(300));
    testing_env!(ctx.build());
    drop(v.execute_intent(h));
}

#[test]
#[should_panic(expected = "AUTHORIZATION_REVOKED")]
fn revocation_after_attestation_blocks_execution() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    v.revoke_authorization("INV-2026-001".into());
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "POLICY_VERSION")]
fn policy_change_invalidates_existing_attestation() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    let mut p = policy();
    p.version = U64(2);
    v.set_policy(p);
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "POLICY_MUST_INCREMENT")]
fn policy_version_cannot_be_reused() {
    let mut v = vault();
    as_caller("owner.testnet");
    v.set_policy(policy());
}

#[test]
#[should_panic(expected = "PURPOSE_MISMATCH")]
fn valid_recipient_with_unauthorized_objective_rejected() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.purpose_id = "unapproved-gift".into();
    let h = propose(&mut v, i);
    attest(&mut v, &h, true);
}

#[test]
#[should_panic(expected = "INVOICE_MISMATCH")]
fn substituted_invoice_rejected() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.invoice_fingerprint = "ef".repeat(32);
    let h = propose(&mut v, i);
    attest(&mut v, &h, true);
}

#[test]
#[should_panic(expected = "AUTHORIZATION_NOT_FOUND")]
fn unknown_mandate_rejected() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-9999"));
    attest(&mut v, &h, true);
}

#[test]
#[should_panic(expected = "INTENT_HASH_MISMATCH")]
fn tampered_stored_intent_rejected() {
    let mut v = vault();
    let h = ready(&mut v);
    let mut record = v.intents.get(&h).unwrap().clone();
    record.intent.amount = U128(1);
    v.intents.insert(h.clone(), record);
    execute(&mut v, &h);
}

// ------------------------------------------------------- replay (12, 13, 19)

#[test]
#[should_panic(expected = "NONCE_REPLAY")]
fn nonce_cannot_be_reused() {
    let mut v = vault();
    propose(&mut v, intent(1, "INV-2026-001"));
    propose(&mut v, intent(1, "INV-2026-001"));
}

#[test]
#[should_panic(expected = "NONCE_REPLAY")]
fn nonces_must_strictly_increase() {
    let mut v = vault();
    propose(&mut v, intent(5, "INV-2026-001"));
    propose(&mut v, intent(4, "INV-2026-001"));
}

#[test]
fn nonce_high_water_mark_is_visible() {
    let mut v = vault();
    propose(&mut v, intent(7, "INV-2026-001"));
    assert_eq!(v.get_agent_nonce(account("agent.testnet")), U64(7));
}

#[test]
#[should_panic(expected = "INTENT_NOT_ATTESTED")]
fn pending_transfer_cannot_execute_twice() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "INTENT_NOT_ATTESTED")]
fn settled_transfer_cannot_execute_twice() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    assert!(callback(&mut v, &h, true, NOW_MS));
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "INVALID_INTENT_STATE")]
fn intent_cannot_be_attested_twice() {
    let mut v = vault();
    let h = ready(&mut v);
    attest(&mut v, &h, true);
}

#[test]
#[should_panic(expected = "INTENT_NOT_ATTESTED")]
fn missing_attestation_fails_closed() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "INTENT_NOT_ATTESTED")]
fn denied_intent_cannot_execute() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    attest(&mut v, &h, false);
    execute(&mut v, &h);
}

// ------------------------------------------------ budgets & concurrency (14, 15)

#[test]
#[should_panic(expected = "AUTHORIZATION_BUDGET")]
fn concurrent_intents_cannot_exceed_mandate_total() {
    let mut v = vault();
    let h1 = ready(&mut v);
    let h2 = propose(&mut v, intent(2, "INV-2026-001"));
    // Both are approvable while nothing is reserved...
    attest(&mut v, &h2, true);
    execute(&mut v, &h1);
    // ...but the first reservation now exhausts the mandate.
    execute(&mut v, &h2);
}

#[test]
#[should_panic(expected = "DAILY_BUDGET")]
fn concurrent_mandates_cannot_exceed_daily_limit() {
    let mut v = vault();
    v.policy.daily_limit = v.policy.max_transaction;
    as_caller("owner.testnet");
    v.create_authorization(authorization("INV-2026-002"));
    let h1 = ready(&mut v);
    let h2 = propose(&mut v, intent(2, "INV-2026-002"));
    attest(&mut v, &h2, true);
    execute(&mut v, &h1);
    execute(&mut v, &h2);
}

#[test]
#[should_panic(expected = "INSUFFICIENT_AVAILABLE_BALANCE")]
fn storage_backing_balance_is_never_spent() {
    let mut v = vault();
    let h = ready(&mut v);
    let mut ctx = context("agent.testnet", NOW_MS);
    // 0.06 NEAR minus storage and the 0.05 NEAR margin cannot cover a 0.05 payment.
    ctx.account_balance(NearToken::from_millinear(60));
    testing_env!(ctx.build());
    drop(v.execute_intent(h));
}

#[test]
#[should_panic(expected = "INSUFFICIENT_GAS")]
fn execution_requires_gas_for_the_settlement_callback() {
    let mut v = vault();
    let h = ready(&mut v);
    let mut ctx = context("agent.testnet", NOW_MS);
    ctx.prepaid_gas(Gas::from_tgas(20));
    testing_env!(ctx.build());
    drop(v.execute_intent(h));
}

// --------------------------------------------------------------- pause (16)

#[test]
#[should_panic(expected = "VAULT_PAUSED")]
fn paused_vault_rejects_execution() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    v.pause();
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "VAULT_PAUSED")]
fn paused_vault_rejects_submission() {
    let mut v = vault();
    as_caller("owner.testnet");
    v.pause();
    propose(&mut v, intent(1, "INV-2026-001"));
}

#[test]
fn paused_vault_still_records_denials_but_not_approvals() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    as_caller("owner.testnet");
    v.pause();
    attest(&mut v, &h, false);
    assert_eq!(status(&v, &h), IntentStatus::Rejected);
}

#[test]
#[should_panic(expected = "VAULT_PAUSED")]
fn paused_vault_rejects_approval() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    as_caller("owner.testnet");
    v.pause();
    attest(&mut v, &h, true);
}

// --------------------------------------------------- settlement (18, 20)

#[test]
#[should_panic(expected = "PRIVATE_CALLBACK")]
fn forged_callback_rejected() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    as_caller("attacker.testnet");
    v.on_execution_complete(h);
}

#[test]
#[should_panic(expected = "INVALID_CALLBACK_STATE")]
fn callback_cannot_settle_an_intent_that_is_not_executing() {
    let mut v = vault();
    let h = ready(&mut v);
    callback(&mut v, &h, true, NOW_MS);
}

#[test]
fn authorized_transfer_reserves_then_settles() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    assert_eq!(status(&v, &h), IntentStatus::Executing);
    assert_eq!(v.get_vault_status().pending_transfers, U64(1));
    assert_eq!(v.get_vault_status().reserved, U128(PAYMENT));
    assert_eq!(v.get_authorization_budget("INV-2026-001".into()).unwrap().reserved, U128(PAYMENT));
    assert!(callback(&mut v, &h, true, NOW_MS));
    assert_eq!(status(&v, &h), IntentStatus::Executed);
    let s = v.get_vault_status();
    assert_eq!(s.today.spent, U128(PAYMENT));
    assert_eq!(s.today.reserved, U128(0));
    assert_eq!(s.reserved, U128(0));
    assert_eq!(s.pending_transfers, U64(0));
    let budget = v.get_authorization_budget("INV-2026-001".into()).unwrap();
    assert_eq!(budget.spent, U128(PAYMENT));
    assert_eq!(budget.reserved, U128(0));
}

#[test]
fn failed_transfer_releases_budget_but_keeps_nonce_consumed() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    assert!(!callback(&mut v, &h, false, NOW_MS));
    assert_eq!(status(&v, &h), IntentStatus::Failed);
    let s = v.get_vault_status();
    assert_eq!(s.reserved, U128(0));
    assert_eq!(s.pending_transfers, U64(0));
    assert_eq!(s.today, Budget::default());
    assert_eq!(v.get_authorization_budget("INV-2026-001".into()).unwrap(), Budget::default());
    assert_eq!(v.get_agent_nonce(account("agent.testnet")), U64(1));
    // The released quota can be used by a fresh, separately attested intent.
    let h2 = propose(&mut v, intent(2, "INV-2026-001"));
    attest(&mut v, &h2, true);
    execute(&mut v, &h2);
    assert!(callback(&mut v, &h2, true, NOW_MS));
}

#[test]
fn callback_settles_the_reservation_day_after_midnight() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    assert!(callback(&mut v, &h, true, DAY_MS + 1));
    assert_eq!(v.daily_budgets.get(&0).unwrap().spent, U128(PAYMENT));
    assert_eq!(v.daily_budgets.get(&0).unwrap().reserved, U128(0));
    assert_eq!(v.get_vault_status().today.spent, U128(0));
}

// ------------------------------------------------- principal rotation (4, 5)

#[test]
#[should_panic(expected = "ATTESTOR_CHANGED")]
fn attestor_rotation_invalidates_old_approval() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    v.set_attestor(account("new-attestor.testnet"));
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "ATTESTOR_GENERATION")]
fn rotating_attestor_away_and_back_cannot_revive_approval() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    v.set_attestor(account("new-attestor.testnet"));
    v.set_attestor(account("attestor.testnet"));
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "AGENT_ONLY")]
fn revoked_agent_cannot_execute() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    v.revoke_agent();
    execute(&mut v, &h);
}

#[test]
#[should_panic(expected = "AGENT_GENERATION")]
fn re_registering_agent_cannot_revive_old_proposal() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("owner.testnet");
    v.revoke_agent();
    v.register_agent(account("agent.testnet"));
    execute(&mut v, &h);
}

// -------------------------------------------------------------- lifecycle

#[test]
fn denial_is_bound_to_the_exact_intent_and_evidence() {
    let mut v = vault();
    let mut i = intent(1, "INV-2026-001");
    i.recipient = account("attacker.testnet");
    let h = propose(&mut v, i);
    attest(&mut v, &h, false);
    let record = v.get_intent(h).unwrap();
    assert_eq!(record.status, IntentStatus::Rejected);
    assert_eq!(record.evidence_hash.as_deref(), Some("cd".repeat(32).as_str()));
    assert_eq!(record.attested_by, Some(account("attestor.testnet")));
}

#[test]
fn stale_intent_can_be_expired_by_anyone_after_its_deadline() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller_at("anyone.testnet", 800_000);
    v.expire_intent(h.clone());
    assert_eq!(status(&v, &h), IntentStatus::Expired);
}

#[test]
#[should_panic(expected = "INTENT_NOT_EXPIRED")]
fn live_intent_cannot_be_expired() {
    let mut v = vault();
    let h = ready(&mut v);
    as_caller("anyone.testnet");
    v.expire_intent(h);
}

#[test]
fn denial_after_deadline_is_recorded_as_expired() {
    let mut v = vault();
    let h = propose(&mut v, intent(1, "INV-2026-001"));
    as_caller_at("attestor.testnet", 800_000);
    v.attest_intent(h.clone(), "cd".repeat(32), false);
    assert_eq!(status(&v, &h), IntentStatus::Expired);
}

#[test]
#[should_panic(expected = "DAILY_INTENT_QUOTA")]
fn daily_proposal_quota_bounds_vault_paid_storage() {
    let mut v = vault();
    for nonce in 1..=u64::from(MAX_DAILY_INTENTS) + 1 {
        propose(&mut v, intent(nonce, "INV-2026-001"));
    }
}

#[test]
fn daily_proposal_quota_resets_the_next_day() {
    let mut v = vault();
    for nonce in 1..=u64::from(MAX_DAILY_INTENTS) {
        propose(&mut v, intent(nonce, "INV-2026-001"));
    }
    as_caller_at("agent.testnet", DAY_MS + 1);
    let mut next = intent(1_000, "INV-2026-001");
    next.expires_at_ms = U64(DAY_MS + 500_000);
    v.submit_intent(next);
    assert_eq!(v.get_vault_status().intents_today, 1);
}

#[test]
fn intents_are_listed_in_order_and_newest_first() {
    let mut v = vault();
    let hashes: Vec<String> = (1..=3)
        .map(|n| propose(&mut v, intent(n, "INV-2026-001")))
        .collect();
    let listed: Vec<String> = v
        .get_intents(None, None)
        .into_iter()
        .map(|r| r.intent_hash)
        .collect();
    assert_eq!(listed, hashes);
    let recent: Vec<String> = v
        .get_recent_intents(Some(2))
        .into_iter()
        .map(|r| r.intent_hash)
        .collect();
    assert_eq!(recent, vec![hashes[2].clone(), hashes[1].clone()]);
    assert_eq!(v.get_intents(Some(U64(2)), Some(10)).len(), 1);
    assert_eq!(v.get_vault_status().intent_count, U64(3));
}

#[test]
fn audit_ring_keeps_newest_events_and_never_returns_stale_ids() {
    let mut v = vault();
    for _ in 0..AUDIT_CAPACITY {
        // One transaction per pause, as on chain (the runtime caps logs per call).
        as_caller("owner.testnet");
        v.pause();
    }
    let newest = v.get_vault_status().audit_count.0 - 1;
    assert!(v.get_audit_event(U64(0)).is_none(), "event 0 must be evicted");
    assert_eq!(v.get_audit_event(U64(newest)).unwrap().event, "PAUSED");
    let recent = v.get_recent_audit(Some(3));
    assert_eq!(recent.len(), 3);
    assert_eq!(recent[0].id, U64(newest));
}

#[test]
fn audit_trail_records_full_lifecycle() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    callback(&mut v, &h, true, NOW_MS);
    let events: Vec<String> = v
        .get_recent_audit(Some(10))
        .into_iter()
        .rev()
        .map(|e| e.event)
        .collect();
    assert_eq!(
        events,
        vec![
            "VAULT_INITIALIZED",
            "AUTHORIZATION_CREATED",
            "INTENT_PROPOSED",
            "INTENT_ATTESTED",
            "TRANSFER_RESERVED",
            "TRANSFER_EXECUTED",
        ]
    );
}

// ------------------------------------------------------- custody & storage

#[test]
#[should_panic(expected = "RECOVERY_REQUIRES_PAUSED_IDLE_VAULT")]
fn owner_cannot_recover_while_transfer_in_flight() {
    let mut v = vault();
    let h = ready(&mut v);
    execute(&mut v, &h);
    as_caller("owner.testnet");
    v.pause();
    drop(v.emergency_recover(U128(1)));
}

#[test]
#[should_panic(expected = "RECOVERY_REQUIRES_PAUSED_IDLE_VAULT")]
fn owner_cannot_recover_from_unpaused_vault() {
    let mut v = vault();
    as_caller("owner.testnet");
    drop(v.emergency_recover(U128(1)));
}

#[test]
fn owner_can_recover_from_paused_idle_vault() {
    let mut v = vault();
    as_caller("owner.testnet");
    v.pause();
    drop(v.emergency_recover(U128(NEAR)));
}

#[test]
fn public_donations_allocate_no_state() {
    let mut v = vault();
    let audit_before = v.get_vault_status().audit_count;
    let mut ctx = context("attacker.testnet", NOW_MS);
    ctx.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(ctx.build());
    for _ in 0..100 {
        v.fund();
    }
    assert_eq!(v.get_vault_status().audit_count, audit_before);
}

// --------------------------------------------------- cross-language identity

#[test]
fn canonical_hash_vectors_match_typescript_and_python() {
    as_caller("owner.testnet");
    let fixture: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(include_str!(
        "../../../packages/shared-types/canonical-vectors.json"
    ))
    .unwrap();
    for vector in fixture["vectors"].as_array().unwrap() {
        let fields: IntentFields =
            near_sdk::serde_json::from_value(vector["intent"].clone()).unwrap();
        let encoded: String = borsh::to_vec(&fields)
            .unwrap()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(encoded, vector["borsh_hex"].as_str().unwrap());
        assert_eq!(Vault::hash_intent(&fields), vector["sha256"].as_str().unwrap());
    }
}

// ---------------------------------------------- cross-implementation policy parity

fn merge(base: &mut near_sdk::serde_json::Value, patch: &near_sdk::serde_json::Value) {
    use near_sdk::serde_json::Value;
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (key, value) in p {
                merge(b.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
        (slot, value) => *slot = value.clone(),
    }
}

/// The same vectors are asserted by the Python mirror and the TypeScript verifier, so
/// all three implementations provably agree on every invariant in the fixture.
#[test]
fn policy_vectors_match_contract_violations() {
    use near_sdk::serde_json::{Value, from_str, from_value};
    let fixture: Value = from_str(include_str!("../../../packages/shared-types/policy-vectors.json")).unwrap();
    for vector in fixture["vectors"].as_array().unwrap() {
        let mut state = fixture["base"].clone();
        merge(&mut state, &vector["patch"]);
        let now: u64 = state["now_ms"].as_str().unwrap().parse().unwrap();
        let mut v = new_vault();
        v.policy = from_value(state["policy"].clone()).unwrap();
        v.paused = state["paused"].as_bool().unwrap();
        v.agent_id = state["agent_id"].as_str().map(account);
        let authorization: Authorization = from_value(state["authorization"].clone()).unwrap();
        v.authorizations.insert(
            authorization.id.clone(),
            AuthorizationRecord {
                authorization,
                budget: from_value(state["authorization_budget"].clone()).unwrap(),
                created_at_ms: U64(0),
            },
        );
        v.daily_budgets
            .insert(now / DAY_MS, from_value(state["daily_budget"].clone()).unwrap());
        as_caller_at("anyone.testnet", now);
        let intent: IntentFields = from_value(state["intent"].clone()).unwrap();
        let expected: Vec<String> = from_value(vector["violations"].clone()).unwrap();
        let actual: Vec<String> = v.violations(&intent).into_iter().map(String::from).collect();
        assert_eq!(actual, expected, "vector {}", vector["name"]);
        let order: Vec<String> = from_value(fixture["order"].clone()).unwrap();
        assert!(actual.iter().all(|code| order.contains(code)), "unknown code in {}", vector["name"]);
    }
}
