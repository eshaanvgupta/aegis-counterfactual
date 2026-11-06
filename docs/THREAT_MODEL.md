# Threat model

Every row of the matrix below maps to a contract unit test, a Python test, a lab scenario or a recorded testnet transaction. See [BENCHMARKS.md](BENCHMARKS.md), [SECURITY_REVIEW.md](SECURITY_REVIEW.md) and `artifacts/testnet-evidence.json`. This is an engineering threat model, not an audit.

## Scoped claim and trusted computing base

Under the implemented and tested native-NEAR vault interface, a compromised registered spending agent must not execute outside an active owner-created mandate and current policy. Security investigators may be wrong or adversarial. Their findings never replace deterministic checks.

Trusted for this claim: correct NEAR execution, deployed vault code, owner authorization/signing context, current on-chain policy state, and the implementation's checked arithmetic/serialization. The independent attestor is trusted to review required evidence; even a malicious attestor must not bypass deterministic recipient/value/purpose/expiry/budget rules in the vault. If the contract does not validate a property itself, a compromised attestor can lie about it.

Owner and vault full-access credentials are privileged. The owner can change policy, revoke roles, pause and recover funds; a vault full-access key may transfer funds or replace contract code. The agent-path claim does not protect against compromised owner/vault authority. Document deployed access-key permissions and upgrade authority rather than describing the system as trustless.

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

## Asynchronous NEAR caveats

NEAR transfer and callback are separate receipts. A successful submission transaction is not proof of successful recipient transfer. Between receipts, public methods can run; reserve and mark execution pending first. A private callback must inspect the real result and finalize once. Do not claim atomic execution across receipts. [Balance safety](https://docs.near.org/smart-contracts/security/cross-contract-calls/reentrancy), [callback safety](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks)

Function-call keys restrict contract/methods and cannot attach tokens. They do not evaluate the recipient encoded inside a method's arguments; the vault does that. A key allowance controls gas consumption, not authorized business spend. Retain a safe owner recovery/admin context rather than leaving an account with only an expiring restricted key. [NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys)

## Local and model limits

Three agents do not create three independent security principals when they share a provider/process. Majority agreement proves nothing about authorization. A separate verifier process on the same machine is not a TEE and does not withstand full host compromise. A malicious or stale RPC can mislead off-chain verification; chain trust/finality and endpoint assumptions must be visible.

Offline fixtures can deliberately reproduce a compromised proposal. They do not prove a real LLM was compromised. Real inference can vary; record model configuration and raw bounded outputs and avoid sending secrets or sensitive personal data. Synthetic attack success/block rates apply only to tested fixtures. No formal verification, production audit, universal prompt-injection detection, arbitrary calldata execution, cross-chain safety, or regulatory compliance is claimed.

## Acceptance boundary

Status on 2026-11-05: the access-control, hash-binding, replay, pending-transfer, quota/concurrency, forged-callback, transfer-failure, stale-policy and receipt-tamper tests run in the 68 contract tests, the 99 Python tests and the 23 lab scenarios. On NEAR testnet we recorded one authorized transfer (`2DhAJUe7…`) and six contract rejections of unauthorized actions, all with genuine transaction IDs from RPC (`artifacts/testnet-evidence.json`). Open residual risks are listed in [LIMITATIONS.md](LIMITATIONS.md).
