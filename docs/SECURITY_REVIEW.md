# Security review and remediation record

AEGIS underwent an adversarial engineering review during development. Six findings raised against the initial v0.1 design were remediated before the v1.0.0 release and preserved as regression tests. The result is a substantially stronger contract, service boundary and receipt format whose critical paths have also been exercised on NEAR testnet.

## Closed findings

| ID | Reviewed risk | Resolution in v1.0.0 | Verification evidence |
| --- | --- | --- | --- |
| S-01 | Whole-state callback cost could exceed prepaid gas | State moved to per-key `near_sdk::store` collections; callback touches only required records; callback allocation is 30 Tgas and execution requires 60 Tgas | `execution_requires_gas_for_the_settlement_callback`, `authorized_transfer_reserves_then_settles`; real settlement in [`2DhAJUe7…`](https://testnet.nearblocks.io/txns/2DhAJUe7C3EAXsA2fZzwhNiVPYaMDeQTEzGqa5MsTweK) |
| S-02 | Tiny deposits could consume vault-backed audit storage | `fund()` allocates no state; the persistent audit trail is a fixed 128-entry ring | `audit_ring_keeps_newest_events_and_never_returns_stale_ids`, `storage_backing_balance_is_never_spent` |
| S-03 | A compromised agent could consume lifetime proposal capacity | A daily quota limits proposals to 64 and resets by day; owner rotation increments the agent generation | `daily_proposal_quota_bounds_vault_paid_storage`, `daily_proposal_quota_resets_the_next_day` |
| S-04 | Snapshot verification omitted owner and full principal separation | Initialization requires four distinct principals and the vault's signature; verifier loads the mandate from the authoritative vault | `agent_and_attestor_must_be_distinct`, `refuses_to_initialize_outside_testnet`, forged-receipt rejection test |
| S-05 | Weak structural checks could accept incomplete replay evidence | Typed receipt models require all six Merkle sections; missing or altered evidence breaks verification | `test_merkle_proofs_verify_each_section_and_reject_tampering`, `test_tampered_evidence_breaks_the_merkle_root` |
| S-06 | Malformed trace input could raise an uncaught exception | Typed bounded input validation returns a structured fail-closed `BLOCK` result | `test_malformed_receipt_fails_closed` |

## Additional hardening verified

* **Role rotation is generation-bound.** Rotating an agent or attestor away and back cannot revive an old approval (`attestor_rotation_invalidates_old_approval`, `rotating_attestor_away_and_back_cannot_revive_approval`).
* **Settlement is accounting-safe across UTC boundaries.** Reservations retain their original budget day (`callback_settles_the_reservation_day_after_midnight`).
* **Transfer failure releases budget without reopening replay.** Failed transfers release the reservation while the nonce remains consumed (`failed_transfer_releases_budget_but_keeps_nonce_consumed`).
* **Approvals are not authority overrides.** `attest_intent(approve=true)` re-runs every invariant. A deliberately compromised attestor was rejected on-chain with `POLICY_VIOLATION:RECIPIENT_NOT_ALLOWED,AUTHORIZATION_RECIPIENT` in [`BZPz2JdH…`](https://testnet.nearblocks.io/txns/BZPz2JdHZDEHNFmvNRLKuQS8hXjqVcV7JNYsi8FnzPcR).
* **Storage backing is protected.** Spendable balance excludes storage requirements and outstanding reservations.
* **Callbacks are private and result-count checked.** Only the vault can reconcile the promise result, and unexpected callback shapes fail closed.

## Verification layers

| Layer | Result |
| --- | --- |
| Contract unit and security tests | 68 passing Rust tests |
| Policy and service tests | 100 passing Python tests |
| Canonical and receipt verification | 13 passing TypeScript tests |
| Cross-language policy agreement | 31/31 shared vectors agree in Rust, Python and TypeScript |
| Browser workflow | 8 end-to-end checks pass on desktop and mobile |
| Live contract parity | The Live Contract Probe confirms browser-versus-contract agreement on every evaluation |
| Adversarial regression matrix | 23/23 declared outcomes match across 18 threat categories |
| Live NEAR testnet matrix | 19/19 expected steps across 15 real transactions |
| Reproducible contract identity | On-chain code hash equals base58(sha256(committed WASM)) |

## Review conclusion

The reviewed release enforces its declared authorization boundary at multiple independent layers: restricted NEAR keys, current-state contract checks, role-isolated services, typed evidence, cross-language verification and chain-bound receipts. Each original finding now has a concrete code change and executable regression evidence.

The operational trust model and mainnet promotion controls are documented in [Security boundaries and production controls](PRODUCTION_CONTROLS.md). That separation makes it possible to evaluate the implemented testnet guarantee precisely while preserving a clear path to governed commercial deployment.
