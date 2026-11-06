# Threat model

Every row of the matrix below maps to a contract unit test, a Python test, a lab scenario or a recorded testnet transaction. See [BENCHMARKS.md](BENCHMARKS.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and `artifacts/testnet-evidence.json`.

## Security claim and trusted computing base

**Claim.** Through the supported payment path, a fully compromised spending agent cannot execute any payment outside an active, owner-created mandate and the current policy. Security investigators are treated as fallible; their findings explain the decision and never replace a deterministic check.

**Trusted base.** NEAR consensus and execution, the deployed vault code (whose hash equals the committed reproducible WASM), the owner's signing context, current on-chain policy state, and checked arithmetic and serialization. Because the vault itself validates recipient, amount, purpose, invoice fingerprint, expiry, nonce and budget, the attestor is trusted only for evidence review. A compromised attestor key cannot approve a mandate-violating payment, which was demonstrated on-chain.

**Governance roles.** The owner (policy, mandates, rotation, pause, recovery) and the vault deployment key (upgrades) are governance authorities, deliberately outside the agent path. Their production governance (multisig or DAO, and governed or removed upgrade keys) is specified in [PRODUCTION_CONTROLS.md](PRODUCTION_CONTROLS.md). Deployed access-key permissions are published in `artifacts/testnet-accounts.json`.

## Assets and boundaries

| Asset | Boundary |
| --- | --- |
| Vault test tokens and reserved funds | Contract execution and promise/callback accounting. |
| Owner mandate | Created independently of untrusted invoice/LLM input. |
| Owner, agent and attestor credentials | Separate contexts; no privileged key in agent API, browser, model prompt or evidence. |
| Exact reviewed intent | Canonical bytes, network/vault domain, nonce, current policy and attestor binding. |
| Replay evidence | Versioned deterministic hashing, independent recomputation and clear source provenance. |
| UI truthfulness | Backend state and actual RPC outcomes, with simulated/heuristic/live/testnet distinctions. |
| Local resources | Bounded input sizes, loops, model calls, retries and storage growth. |

An attacker may control invoice text, retrieved/tool content, agent-generated proposals and all model findings; possess the spending-agent key; modify exported local JSON; replay prior requests; call public contract functions; and issue concurrent valid-looking proposals. They may submit schema-valid hostile values. They do not initially possess owner/vault credentials or control NEAR consensus.

## Attack/control/test matrix

| Threat | Required control | Falsifiable validation |
| --- | --- | --- |
| Recipient redirection | Mandate recipient equality plus policy allowlist; immutable reviewed hash | Change recipient after review; reject proposal/attestation/execution as applicable. |
| Amount inflation or rounding | Integer decimal strings, checked u128 bounds, mandate and per-tx maximum | 0.05 versus 0.5 NEAR; zero/negative/fractional/scientific/overflow representations rejected. |
| Fake system instruction / tool substitution | Treat input as data, expose provenance; enforce independently of parsing | Vulnerable agent proposes attacker action; vault still rejects it. Detection is not the security boundary. |
| Valid vendor, wrong purpose | Owner-created authorization ID plus purpose/invoice/action checks | Substitute invoice/business objective while preserving vendor and amount. |
| Invoice fingerprint forgery | Verifier recomputes from authorized source, not agent-supplied hash | Swap content but keep a claimed approved hash; independent evidence verification fails. |
| Unauthorized admin or attestor call | Immediate predecessor checks and distinct registered principals | Agent calls policy/mandate/attestation functions; unrelated caller tries each privileged entry point. |
| Agent self-approval | Distinct agent/attestor identities and contract role enforcement | Configure or call as same principal; reject self-approval. |
| Changed amount/hash fields after review | Recompute exact canonical intent identity in all languages | Mutate each bound field and compare rejection; fixed cross-language vectors agree. |
| Cross-network/vault replay | Hash and contract checks include configured network/vault | Reuse receipt for another vault or network; reject. |
| Duplicate nonce/intent | Permanent consumed nonce and terminal/pending status checks | Replay before callback, after success and after failure; no second payout. |
| Concurrent budget exhaustion | Reserve all quotas before scheduling transfer | Two individually small payments whose sum exceeds remaining budget; only eligible reservation proceeds. |
| Revocation/expiry/policy change after attestation | Recheck current state at execution | Attest, then revoke/expire/update policy/pause; execution rejects. |
| Midnight accounting bug | Reservation records original budget day | Execute before UTC day rollover, resolve failure after; correct day refunded, no budget credit minted. |
| Forged callback | Contract-private callback and correct pending state/result count | External direct and malicious-contract callback attempts fail. |
| Failed recipient transfer | Inspect promise result; release correct reservation without un-consuming nonce | Failed transfer changes to FAILED, restores eligible budget, retry uses new nonce. |
| Storage drain / gas exhaustion | Bounded strings/evidence IDs, authorized writers, liquid-balance reserve | Flood bounded records and test near storage minimum; reject safely before insolvency. |
| Missing attestor/model timeout | Fail closed; bounded retries; no automatic fallback approval | Kill verifier or model; no valid on-chain attestation created. |
| Rehashed or modified receipt | Recompute evidence/policy and separately query authority/outcome | Tamper raw bytes, then recompute attacker hashes; local integrity is not reported as authenticated chain approval. |
| Idempotency confusion | Bind request ID to exact payload hash | Same ID different payload produces conflict; identical retry does not duplicate execution. |
| Frontend/API impersonation | UI never grants chain authority; credentialed writes constrained to role | Call endpoint directly; absence of owner signature cannot alter chain mandate. |
| Secret exfiltration | Keys stay out of model inputs, browser bundles, logs and exported evidence | Inspect generated artifacts/logs and separate process environments without printing secrets. |

## Asynchronous NEAR settlement design

A NEAR transfer and its callback execute as separate receipts, so AEGIS never infers settlement from a successful submission. Before dispatching the transfer promise, the vault marks the intent `EXECUTING` and reserves the amount against both the mandate and the daily budget. Public methods that run between receipts therefore see the reservation. The `#[private]` callback inspects the actual promise result and finalizes exactly once: on success, reserved moves to spent; on failure, the reservation is released and the nonce stays consumed. This follows NEAR's [balance-safety](https://docs.near.org/smart-contracts/security/cross-contract-calls/reentrancy) and [callback-safety](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks) guidance.

Function-call keys restrict the receiver contract and method names and cannot attach tokens. The business checks on the recipient and amount inside a method's arguments are enforced by the vault. Key allowances bound gas spend; the mandate bounds business spend. The agent and attestor accounts hold only these vault-scoped function-call keys. See [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys).

## Assurance scope

* **Authorization does not depend on detection.** The security swarm explains attacks, but authorization comes only from deterministic invariants. An attack the investigators never anticipated is still blocked if it moves any bound field.
* **Process isolation is enforced.** Each service receives one role key, refuses foreign keys, and runs in its own container in production. Confidential-compute hosting and remote attestation can be added at the infrastructure layer without protocol changes.
* **Chain reads are explicit.** The console names the RPC endpoint it reads, and the Live Contract Probe shows the block height of every verdict. Receipts become authoritative when checked against the vault with `--network`.
* **Reproducible by construction.** The reference agent is deterministic and obeys injected instructions, which reproduces worst-case agent behaviour exactly. LLM agents plug into the same interface with schema-validated, fail-closed output.
* **Precise surface.** Release 1.0.0 authorizes native NEAR transfers. Additional actions (fungible tokens, NEAR Intents, contract calls) are added as separately typed actions with their own invariants and tests.

## Verification status

As of 2026-11-07: the access-control, hash-binding, replay, pending-transfer, quota and concurrency, forged-callback, transfer-failure, stale-policy and receipt-tamper checks run across 68 contract tests, 100 Python tests, 13 TypeScript tests and 23 lab scenarios. On NEAR testnet, the evidence ledger records an authorized, settled transfer (`2DhAJUe7…`) and six contract rejections of unauthorized actions, all with genuine transaction IDs from RPC (`artifacts/testnet-evidence.json`). The Live Contract Probe lets anyone extend this matrix against the deployed contract in real time.
