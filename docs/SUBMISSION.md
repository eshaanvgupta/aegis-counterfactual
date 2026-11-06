# Submission record

AEGIS // COUNTERFACTUAL was submitted to NEAR Hackathon 2026 by the project owner on November 6, 2026.

## Public deliverables

| Deliverable | Link or identifier |
| --- | --- |
| Project | **AEGIS // COUNTERFACTUAL** |
| Primary track | **AI Security & Defense** |
| Source and reproducibility | [github.com/eshaanvgupta/aegis-counterfactual](https://github.com/eshaanvgupta/aegis-counterfactual) |
| Live console | [eshaanvgupta.github.io/aegis-counterfactual](https://eshaanvgupta.github.io/aegis-counterfactual/) |
| Live Contract Probe | [eshaanvgupta.github.io/aegis-counterfactual/#probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe) |
| Production deployment | [docs/PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) |
| Deployed contract | [`vault.aegis-cf-mw2gs131-c04639.testnet`](https://testnet.nearblocks.io/address/vault.aegis-cf-mw2gs131-c04639.testnet) |
| License | [MIT](../LICENSE) |

## One-line thesis

**The AI can be compromised. The financial authorization boundary cannot.** AEGIS lets AI agents pay invoices on NEAR while a vault contract independently enforces the owner's exact mandate, including when the agent or attestor attempts to redirect the payment.

## What was built

AI agents that pay invoices read untrusted messages, documents and tool output, so a single prompt-injected line can redirect real money. AEGIS treats the agent as untrusted by design: it may propose a payment, but it never authorizes one.

A native Rust vault deployed on NEAR testnet independently enforces an owner-written mandate covering the exact recipient, amount, purpose, authorized-invoice hash, expiry, nonce and daily budget. Restricted NEAR function-call keys isolate the agent and attestor roles, while the vault re-checks policy during attestation and execution. Before an intent reaches the vault, a counterfactual replay engine compares authorized and adversarial inputs, mutates every intent field, and seals the findings into an independently verifiable Counterfactual Verification Receipt whose evidence root is committed on-chain.

The recorded testnet run produced **19/19 expected outcomes across 15 real transactions**: it blocked a prompt-injected payment, rejected a redirected payment even from a deliberately compromised attestor, stopped replay and privilege escalation, and executed the legitimate 0.05 NEAR payment. The 23-scenario attack laboratory matched every expected result; the same agent without AEGIS would have signed eight harmful transfers totaling 1.75 NEAR, while AEGIS authorized none.

The public console is live, not a recording. Its **Live Contract Probe** lets anyone write a prompt injection, poison a tool result or swap the invoice. The deployed contract judges each edit in real time through its `check_intent` view, and the browser independently re-derives the same canonical hash and verdict. For operators, AEGIS ships a production stack: three role-isolated services, a server-rendered console and a hardened gateway in read-only, unprivileged containers, with health and readiness probes and SBOM-attested images.

## How NEAR is used

The native Rust vault (near-sdk 5.30.0) holds and transfers the funds. Restricted function-call access keys separate the agent and attestor roles. The canonical Borsh intent hash is domain-bound to the network and vault account. Budget is reserved before the asynchronous transfer and reconciled in a private callback. NEP-297-style audit events provide an on-chain execution trail. The deployed contract, role separation, rejection cases and successful settlement are all exercised on NEAR testnet.

## Verifiable proof points

* The on-chain code hash matches the reproducible WASM in [`artifacts/aegis_vault.wasm`](../artifacts/aegis_vault.wasm).
* The full 15-transaction ledger is recorded in [`artifacts/testnet-evidence.json`](../artifacts/testnet-evidence.json), with direct explorer links in the README.
* Rust, Python and TypeScript implementations agree on all 31 shared policy vectors and the canonical intent-hash vectors.
* The repository contains 181 automated tests (68 Rust, 100 Python, 13 TypeScript) and 8 browser end-to-end checks.
* The [Live Contract Probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe) lets anyone write an attack and have the deployed contract judge it live, with the verdict independently re-derived in the browser.
* Every example receipt can be independently recomputed, and testnet receipts can be checked against current chain state.

## Development disclosure

All project code was created during the hackathon window in a new workspace. Development used substantial AI assistance under human direction and review. Recorded results use the deterministic offline agent (`model_calls: 0`), so reproducing the evidence does not require a paid model. Test invoices, vendors and attack scenarios are synthetic. Third-party dependencies and exact versions are recorded in the lockfiles and manifests.
