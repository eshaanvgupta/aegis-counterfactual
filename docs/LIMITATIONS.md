# Limitations and honest scope

This is a hackathon prototype on NEAR **testnet**. What follows is what it does **not** prove or protect against.

## Custody and trust

* **The vault account keeps a full-access key.** It was used to deploy, and to upgrade twice. Upgrades are recorded in `artifacts/testnet-deployment.json`. Whoever holds that key can replace the contract code or move funds directly. A production deployment should remove the key after deployment or put upgrades behind a DAO or multisig. The agent-path security claim does not cover a compromised vault key.
* **The owner is trusted.** The owner can change the policy, revoke roles, pause, and recover funds while idle. AEGIS protects the owner from a compromised agent, not from themselves.
* **The attestor is a single key.** The contract re-checks every deterministic invariant on approval, so a compromised attestor cannot approve a payment that violates the mandate (shown on-chain). It *can* still deny legitimate payments (liveness), and it could approve a mandate-conforming payment without real review. There is no attestor quorum.

## Isolation

* The agent, verifier and owner run as separate local processes, each with one key. That prevents accidental key sharing. It is **not** a TEE and gives no protection against a malicious host, a debugger, or shared-filesystem access. There is no remote attestation.
* The owner console authenticates with a local bearer token (`runtime/owner-token.txt`). It is designed for `127.0.0.1` only and is not a hosted multi-user service.

## AI components

* The default transaction agent is an **offline heuristic** that deliberately follows injected instructions, so the attack is reproducible. It is not an LLM. The LLM adapters exist and are tested with mocked outputs. No paid model was used to produce any recorded result (`model_calls: 0` in the benchmark).
* The three investigators (prompt injection, financial fraud, red team) are deterministic, rule-based analyzers. Their findings are explanations bound into the receipt. They are labeled `AI ANALYSIS UNVERIFIED` everywhere, and they never authorize anything.
* "Verified" on a receipt means the decision follows deterministically from the bound evidence and, with `--network`, that the vault recorded that decision for that intent hash. It does not mean the analysis is correct.

## Evidence and benchmarks

* The 23 lab scenarios are **synthetic** fixtures written for this project. 23/23 matching expectations shows the invariants work on these cases. It is not a detection-accuracy measurement and says nothing about unseen attacks.
* The "unprotected baseline" (8 harmful transfers, 1.75 NEAR) is **simulated**. No funds were sent to any attacker account.
* Testnet evidence covers the recorded flows only (19 steps, 15 transactions), not every possible input.
* Receipts embed the full mandate snapshot. A forged but self-consistent receipt passes offline integrity checks, and only an authoritative chain read (`--network`) catches it. Scenario 20 shows this.

## Scope of the contract

* Only native NEAR transfers (`native_transfer`). No fungible tokens, NEAR Intents, swaps or arbitrary calls.
* There are no time-locks or multi-party approval for large payments beyond the exact-amount mandate and the policy caps.
* Gas and storage bounds were chosen for the demo (64 proposals per day, 128 audit events, 256 mandates, 16 recipients). They have unit tests but no fuzzing or formal verification.
* No third-party audit has been performed.
