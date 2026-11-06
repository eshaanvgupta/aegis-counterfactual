# Security review and remediation record

A focused adversarial engineering review of the prototype. This is **not** a production audit or formal verification. The findings below (S-01 to S-06) were raised against the v0.1 design on 2026-11-04. The contract and services were then rewritten as v1.0.0, which closes them as shown. The original finding text is kept below for traceability.

## Closure status (v1.0.0, 2026-11-05)

| ID | Finding | Resolution in v1.0.0 | Evidence |
| --- | --- | --- | --- |
| S-01 | Whole-state callback can exceed prepaid gas | State moved to per-key `near_sdk::store` collections (`LookupMap`, `IterableMap`, `Vector`), so the callback touches only the records it needs. Callback gas is 30 Tgas, and `execute_intent` requires 60 Tgas | `execution_requires_gas_for_the_settlement_callback`, `authorized_transfer_reserves_then_settles`; real testnet transfer settled in `2DhAJUe7…` |
| S-02 | Tiny deposits subsidize persistent audit storage | `fund()` allocates no state (log only). The audit trail is a fixed 128-entry ring | `audit_ring_keeps_newest_events_and_never_returns_stale_ids`, `storage_backing_balance_is_never_spent` |
| S-03 | Compromised agent consumes lifetime proposal capacity | Per-day proposal quota (64), with a daily reset. The owner can revoke and rotate the agent (generation counter) | `daily_proposal_quota_bounds_vault_paid_storage`, `daily_proposal_quota_resets_the_next_day` |
| S-04 | Snapshot policy omitted owner / principal separation | `init` requires four distinct principals and the vault's own signature. The verifier loads the mandate from the chain, never from the agent | `agent_and_attestor_must_be_distinct`, `refuses_to_initialize_outside_testnet`, `test_verifier_refuses_a_forged_receipt_without_writing_anything` |
| S-05 | Incomplete replay evidence accepted | Receipts and evidence are Pydantic models. All six Merkle sections are required, and any missing or altered section breaks the root | `test_merkle_proofs_verify_each_section_and_reject_tampering`, `test_tampered_evidence_breaks_the_merkle_root` |
| S-06 | Malformed trace input raises uncaught exception | Malformed receipts and evidence fail closed with a `BLOCK` decision and an error, never an exception | `test_malformed_receipt_fails_closed` |

Additional observations from the original review, now addressed:

* **Rotation away and back**: agent and attestor generation counters make old approvals permanently invalid (`attestor_rotation_invalidates_old_approval`, `rotating_attestor_away_and_back_cannot_revive_approval`).
* **Midnight settlement**: reservations record their day (`callback_settles_the_reservation_day_after_midnight`).
* **Failed transfer**: releases the budget but keeps the nonce consumed (`failed_transfer_releases_budget_but_keeps_nonce_consumed`).
* **Compromised attestor**: approval re-runs every invariant in the contract. Proven on testnet in `BZPz2JdH…`, rejected with `POLICY_VIOLATION:RECIPIENT_NOT_ALLOWED,AUTHORIZATION_RECIPIENT`.

Residual risks that remain open (custody, single attestor, host-level isolation, no audit) are listed in [LIMITATIONS.md](LIMITATIONS.md).

## Original findings (v0.1, for traceability)

## Scope and evidence

Reviewed `contracts/aegis-vault/src/lib.rs`, `src/tests.rs`, Python policy/receipt core and models, and canonical vectors. Read-only testnet RPC supplied actual runtime storage gas costs. No deployment, transaction signing, native sandbox or mainnet operation was performed by this reviewer.

Parent reported 16 passing Python policy/canonical tests at review start. Rust dependency compilation subsequently encountered Windows Application Control rejecting a generated DLL. This review does not mark Rust compilation, cargo tests, WASM execution, sandbox behavior or testnet transfer as passed. Re-run the corresponding checks in an environment where the required toolchain can execute.

## Findings

### S-01 — Whole-state callback can exceed its prepaid gas

**Severity:** High availability/accounting risk. **Initial status:** Confirmed by serialization/gas lower-bound calculation; runtime reproduction pending. **Remediation:** Contract maintainer is reducing bounds, increasing callback gas and adding a full-state read/write test. Do not mark fixed until executed evidence is recorded.

**Root cause:** Initial contract kept BTreeMaps/Sets in the root serialized state, allowed 1,024 intents and allocated 20 Tgas to the transfer callback. Every generated method wrapper must deserialize and rewrite the entire state; direct unit calls bypass that wrapper cost.

**Prerequisites/reproduction:** Fill allowed proposal records using the registered agent and funded vault, then execute an attested transfer. The callback must rewrite the populated root state. A Python calculation using the committed canonical fixture measured 224 bytes per intent, 364 bytes per proposed record including map key, and 25 bytes per nonce. At 1,024 records, intents/nonces alone require **398,336 bytes**, excluding every other state field.

The testnet `EXPERIMENTAL_protocol_config` response supplied storage read value cost 5,611,004, storage write value cost 31,018,539 and evicted value cost 32,117,307 gas per byte. Their combined lower bound is **27.384 Tgas** for those bytes, already exceeding 20 Tgas without Wasm execution, audit state or other host operations. This is a quantified execution-budget defect, not a claim of an observed testnet failure. [RPC reference](https://docs.near.org/api/rpc/protocol), [runtime cost source](https://github.com/near/nearcore/tree/master/runtime/near-vm-runner)

**Impact:** Transfer may succeed while callback fails out of gas, leaving intent EXECUTING and quotas/pending funds reserved indefinitely. Failed transfers can similarly retain reservations. Recovery requires paused/idle state, so an unreconciled callback can also block recovery.

**Fix/retest:** Use persistent storage collections or tightly bound worst-case full state plus sufficient callback gas. Measure maximum-length records, not just default fixture sizes. Exercise wrapper `state_read`/`state_write` under the actual callback gas budget; run a WASM sandbox/testnet maximum-state transfer when feasible. The maintainer proposed 64 intents, 16 mandates, 64 audit records and 40 Tgas callback; these settings require actual test evidence.

### S-02 — Tiny public deposits can subsidize persistent audit storage

**Severity:** Medium availability/economic risk. **Status:** Initial source confirmed; remediation/retest pending maintainer.

**Root cause:** Initial public `fund()` accepted any positive deposit, including one yoctoNEAR, then inserted a persistent audit event without charging its storage growth or checking backing.

**Prerequisites/reproduction:** Any account repeatedly funds one yoctoNEAR with changing caller/event records until the audit bound is populated. Gas is paid by the sender, but the vault backs newly stored records. This path requires no owner or spending-agent authority.

**Impact:** A bounded amount of vault liquidity becomes storage-locked and can deny otherwise affordable payments. Runtime storage enforcement prevents arbitrary unbacked state, so this is not a demonstrated theft or an unbounded drain.

**Fix/retest:** Emit a log-only deposit event, charge the actual incremental storage, or otherwise restrict stored growth. With a populated audit and low liquid balance, repeat tiny external deposits and verify they cannot reduce protected payment capacity for less than their storage cost.

### S-03 — Compromised agent can consume lifetime proposal capacity

**Severity:** Medium availability limitation. **Status:** Residual design limit unless a safe admission/retirement mechanism is implemented.

**Root cause:** Every submitted proposal consumes a permanent nonce and one global intent slot. No retirement path was present, and even invalid mandate proposals could be stored. Reducing the record cap for gas safety also reduces lifetime operation count.

**Prerequisites/reproduction:** Registered agent submits distinct nonces until `INTENT_CAPACITY`; use mismatched authorization/recipient fields so no financial approval is needed.

**Impact:** Further proposals fail even after pause, key revocation or agent replacement. Storage bounds protect contract execution cost but do not provide availability against a malicious authorized proposer.

**Fix/retest:** Consider deterministic admission checks, owner-governed bounded retirement with a separate permanent replay strategy, or a documented vault replacement/migration procedure. Any pruning design must preserve replay protection and pending transfer records. For a bounded hackathon MVP, disclose the finite lifetime rather than claim unlimited operation or agent-DoS resistance.

### S-04 — Snapshot policy omitted owner and full principal separation

**Severity:** Medium off-chain verification consistency defect. **Status:** Remediation observed; independent negative retest passed.

**Root cause:** Initial `evaluate()` compared agent/attestor fields but omitted mandate-owner equality and full owner/agent/attestor/vault separation.

**Reproduction:** Replace the otherwise matching authorization owner with `attacker.testnet`, or set policy owner equal to agent. The initial deterministic predicates had no failing condition for these changes.

**Impact:** An inconsistent self-contained snapshot could be reported policy-consistent. This did not demonstrate bypass of the Rust owner check or an independently authoritative mandate store.

**Fix/retest:** `owner` and `principal_separation` predicates were added by the parent. Independent Python probes now return `allowed: false` for both mutations. Preserve regression tests in the maintained suite.

### S-05 — Incomplete replay evidence accepted by weak structural checks

**Severity:** Medium evidence-assurance defect. **Status:** Remediation observed; malformed evidence test now blocks. Full schema/regression coverage remains required.

**Root cause:** Initial receipt verification allowed any non-null `reference_blocked_reason` to substitute for an authorized reference, and required only non-null adversarial `tool_calls`. A fabricated dictionary qualified as a tool trace.

**Reproduction:** Use an unauthorized reference recipient, arbitrary reason string, a legitimate reviewed proposal and `tool_calls: {}`; recompute all self-contained hashes. Hash equality alone cannot establish valid reference execution.

**Impact:** A receipt could appear to contain a complete adversarial experiment without valid reference evidence. This did not permit a transaction outside a trusted mandate by itself.

**Fix/retest:** Current source checks exact computed reference failures, reference mandate fields, authorized invoice bytes, bounded trace arrays and matching tool arguments. The malformed sample now yields `INTEGRITY FAILED`/BLOCK. A properly constructed matching sample independently returns integrity/policy consistency verified with `on_chain: NOT CHECKED` and AI analysis unverified.

### S-06 — Malformed trace input raises an uncaught exception

**Severity:** Low service availability/error-handling defect. **Status:** Independently reproduced; parent notified, fix/retest pending.

**Root cause:** Receipt verification appends a failed type check for reference input but still calls `fingerprint()` on it. `None.encode()` raises AttributeError outside the handled exception classes.

**Reproduction:** Start with a valid complete receipt, replace `evidence.reference.input` with JSON null, and regenerate its hashes. `verifyReceipt()` raises `AttributeError: 'NoneType' object has no attribute 'encode'` instead of returning a structured BLOCK result.

**Impact:** Malformed API input can cause an internal error. No financial fail-open was observed.

**Fix/retest:** Validate a typed bounded evidence schema before hashing or guard the fingerprint operation. Require a structured integrity failure for null, numeric, object, oversized and missing input fields.

## Additional review observations

- The initial contract checks owner/agent/attestor by immediate predecessor, rechecks policy/mandate state before execution, marks EXECUTING before transfer, reserves mandate/day budget, and uses a private result-count-checked callback. These are source observations; actual runtime assurance still requires tests.
- Callback reservations use the original day, avoiding a refund credited to a new UTC day. Add an actual failed-transfer-after-midnight test as well as success.
- Agent/attestor rotation away and back can restore a matching account identity. The maintainer is considering generation binding so revocation invalidates old approvals permanently. Record exact intended semantics and tests.
- `available_balance` subtracts reservations while NEAR account balance on later receipts can already exclude dispatched outgoing funds. This appears conservatively restrictive for concurrency, not a spending bypass; test and document actual behavior.
- A local receipt's self-contained hashes cannot authenticate its own attestor or mandate snapshot. Current verifier output explicitly says so. Independent local authoritative lookup and real on-chain checks are separate layers.
- A separately credentialed process on the same host does not withstand host compromise. Owner/vault full-access keys retain custody/upgrade authority.

## Required closure evidence

Before “ready” is claimed: record actual Rust compilation/WASM build, executed contract security tests, populated-state callback budget test, receipt malformed-input regression tests, and real testnet success/rejection outcomes. For every confirmed critical/high finding, record fix and retest result. Current external/toolchain blockers must remain visible; offline simulation cannot substitute for missing on-chain evidence.
