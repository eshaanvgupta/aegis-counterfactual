# Vault contract API (v1.0.0)

`contracts/aegis-vault/src/lib.rs`, using near-sdk 5.30.0. Deployed at `vault.aegis-cf-mw2gs131-c04639.testnet`. Amounts are yoctoNEAR decimal strings (`U128`); timestamps are milliseconds (`U64`). The network domain is pinned to `testnet`.

## Initialization

| Method | Caller | Notes |
| --- | --- | --- |
| `init(owner_id, agent_id, attestor_id, policy)` | the vault account itself | Deployed and initialized in **one transaction**, so nobody can front-run it. Requires a `.testnet` account (`TESTNET_ONLY_PROTOTYPE`), four distinct principals (`PRINCIPALS_MUST_DIFFER`, `VAULT_MUST_DIFFER`), and `policy.version == 1`. |

## Owner methods

| Method | Effect |
| --- | --- |
| `create_authorization(authorization)` | Adds a mandate: `id, owner_id, agent_id, recipient, amount, max_total, asset, purpose_id, invoice_fingerprint, expires_at_ms, policy_version, action, revoked`. Capped at 256 mandates, with identifier charset `[A-Za-z0-9._:-]`. The recipient must be on the allowlist. |
| `revoke_authorization(authorization_id)` | Revokes immediately. Existing attestations stop executing. |
| `register_agent(agent_id)` / `revoke_agent()` | Rotates the agent. The generation counter invalidates old proposals. |
| `set_attestor(attestor_id)` | Rotates the attestor. The generation counter invalidates old approvals, even when the same account is rotated back. |
| `set_policy(policy)` | Must be exactly `version + 1`. Older mandates and attestations stop executing. |
| `pause()` / `unpause()` | Blocks proposals, approvals and execution. Denials still work. |
| `emergency_recover(amount)` | Only when paused with no pending transfers. Never touches the storage-backing balance. |

## Agent methods (function-call key, zero deposit)

| Method | Effect |
| --- | --- |
| `submit_intent(intent) -> intent_hash` | Records a `PROPOSED` intent, consuming the next per-agent nonce (`NONCE_REPLAY` otherwise). A violating intent is still recorded as evidence and can never be approved. Limited to 64 proposals per day. |
| `execute_intent(intent_hash) -> Promise` | Requires `ATTESTED` status and at least 60 Tgas. Re-checks all invariants, reserves the amount against the mandate and daily budget, transfers, and schedules the settlement callback (30 Tgas). |

## Attestor method (function-call key)

| Method | Effect |
| --- | --- |
| `attest_intent(intent_hash, evidence_hash, approved)` | Binds the evidence root to the intent. `approved=true` re-runs every invariant and panics with `POLICY_VIOLATION:<codes>` if any fails. Each intent can be attested only once. |

## Internal and public

| Method | Notes |
| --- | --- |
| `on_execution_complete(intent_hash) -> bool` | `#[private]` settlement callback. On success it moves reserved to spent; on failure it releases the reservation (the nonce stays consumed). |
| `expire_intent(intent_hash)` | Anyone may expire a stale intent after its expiry. |
| `fund()` | `#[payable]`. Accepts testnet deposits, emits a log, allocates no state. |

## Views

`get_vault_status`, `get_policy`, `get_authorization(id)`, `get_authorizations(from_index?, limit?)`, `get_authorization_budget(id)`, `get_intent(hash)`, `get_intents(from_index?, limit?)`, `get_recent_intents(limit?)`, `get_agent_nonce(agent_id)`, `get_audit_event(id)`, `get_recent_audit(limit?)`, `canonical_intent_hash(intent)`, `check_intent(intent) -> { intent_hash, executable, violations }`. Page size is capped at 50.

## Intent statuses

`PROPOSED → ATTESTED → EXECUTING → EXECUTED | FAILED`, or `PROPOSED → REJECTED`, or `PROPOSED/ATTESTED → EXPIRED`.

## Error codes

Policy violations, reported all at once as `POLICY_VIOLATION:A,B,...`: see the order in [ARCHITECTURE.md](ARCHITECTURE.md#policy-parity).

Other panics include: `OWNER_ONLY`, `AGENT_ONLY`, `ATTESTOR_ONLY`, `PRIVATE_CALLBACK`, `INTENT_NOT_FOUND`, `INTENT_EXISTS`, `INTENT_NOT_ATTESTED`, `INVALID_INTENT_STATE`, `INTENT_HASH_MISMATCH`, `NONCE_REPLAY`, `AGENT_GENERATION`, `ATTESTOR_GENERATION`, `ATTESTOR_CHANGED`, `POLICY_CHANGED`, `POLICY_EXPIRED`, `POLICY_MUST_INCREMENT`, `INSUFFICIENT_GAS`, `INSUFFICIENT_AVAILABLE_BALANCE`, `DAILY_INTENT_QUOTA`, `MISSING_EVIDENCE`, `INVALID_HASH`, `INVALID_IDENTIFIER`, `INVALID_FIELD_LENGTH`, `INVALID_AMOUNT`, `AUTHORIZATION_EXISTS`, `AUTHORIZATION_CAPACITY`, `RECOVERY_REQUIRES_PAUSED_IDLE_VAULT`, `DEPOSIT_REQUIRED`, and the initialization codes above. Arithmetic uses checked operations (`AMOUNT_OVERFLOW`, `ACCOUNTING_UNDERFLOW`, ...).

## Accounting

`available = balance − storage_cost − 0.05 NEAR margin − reserved`. Reservations are made before the transfer promise is dispatched and are reconciled only in the private callback. Mandate budgets (`spent + reserved ≤ max_total`) and the daily budget are checked and reserved together.

## Events

NEP-297 style `EVENT_JSON` logs (`standard: "aegis"`), including `VAULT_INITIALIZED, AUTHORIZATION_CREATED, AUTHORIZATION_REVOKED, AGENT_REGISTERED, AGENT_REVOKED, ATTESTOR_CHANGED, POLICY_CHANGED, PAUSED, UNPAUSED, INTENT_PROPOSED, INTENT_ATTESTED, INTENT_DENIED, TRANSFER_RESERVED, TRANSFER_EXECUTED, TRANSFER_FAILED_QUOTA_RELEASED, OWNER_EMERGENCY_RECOVERY`. The newest 128 are also kept in an on-chain audit ring (`get_recent_audit`).
