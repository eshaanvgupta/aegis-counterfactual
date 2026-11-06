# AEGIS // COUNTERFACTUAL

**The AI can be compromised. The financial authorization boundary cannot.**

AEGIS is a security layer for AI agents that move money on NEAR. An AI payment agent reads untrusted invoices, tool results and messages, then *proposes* a payment. It never decides. A NEAR smart-contract vault re-checks every proposal against a business mandate that the owner wrote independently, and pays only if the proposal matches exactly.

Before anything reaches the vault, a **counterfactual replay engine** runs the same agent and the same mandate on two inputs, the authorized invoice and the attacker-controlled one. It then mutates every field to show which invariant catches each attack. Three specialist investigators explain what happened, and the evidence is sealed into a **Counterfactual Verification Receipt** (CVR) bound to the exact intent hash. Anyone can verify a CVR independently, from the command line or in the browser.

> Primary track: **AI Security & Defense**. Native NEAR testnet. No mainnet funds. No paid inference required.

## What is proven, and where

| Claim | Evidence you can check |
| --- | --- |
| The vault is deployed on NEAR testnet and its code matches this repo | `vault.aegis-cf-mw2gs131-c04639.testnet`, code hash `AAVfbPT7XAg3FPQMpZyeTX11Zxh7CKH1rPpzkGb8MMuj` = base58(sha256(`artifacts/aegis_vault.wasm`)). The build is reproducible (`pnpm build:contract`). |
| A prompt-injected payment was stopped **on-chain** | Attestor deny [`8K6AnS8k…`](https://testnet.nearblocks.io/txns/8K6AnS8k8kVYHmSVmfihYMgE8UA1msErdjK1oyycQmMe). The agent's forced execute was rejected with `INTENT_NOT_ATTESTED` in [`HwExgE5M…`](https://testnet.nearblocks.io/txns/HwExgE5Mkq4NLEozQbadZJW7J6pckeX5bpbTxq2FuZtK). |
| Even a **compromised attestor** cannot approve a redirected payment | Rejected with `POLICY_VIOLATION:RECIPIENT_NOT_ALLOWED,AUTHORIZATION_RECIPIENT` in [`BZPz2JdH…`](https://testnet.nearblocks.io/txns/BZPz2JdHZDEHNFmvNRLKuQS8hXjqVcV7JNYsi8FnzPcR). |
| The legitimate payment executes | 0.05 NEAR transferred and settled in [`2DhAJUe7…`](https://testnet.nearblocks.io/txns/2DhAJUe7C3EAXsA2fZzwhNiVPYaMDeQTEzGqa5MsTweK). |
| Replays, double spends and privilege escalation fail | `NONCE_REPLAY`, `INTENT_NOT_ATTESTED`, and `AccessKeyMethodNameMismatch` for the agent's function-call key (all in `artifacts/testnet-evidence.json`). |
| The whole matrix | **19/19 steps as expected across 15 real testnet transactions** (9 succeeded, 6 rejected by the contract). See `artifacts/testnet-evidence.json`. |
| The attack lab | 23/23 synthetic scenarios match expectations. An unprotected agent would have signed **8 harmful transfers (1.75 NEAR, simulated)**; AEGIS allowed **0**. See [docs/BENCHMARKS.md](docs/BENCHMARKS.md). |
| One policy, three implementations | Rust (contract), Python (verifier) and TypeScript (browser verifier) agree on all 31 shared policy vectors and the canonical intent-hash vectors. |

Scope matters: these results show that the deployed contract enforced the mandate **for these recorded flows**. They do not prove the AI analysis correct, and they are not a production audit. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## How it works

```
 untrusted invoice / tool output / message
                │
        ┌───────▼────────┐  proposes an intent (never authorizes)
        │ Transaction    │──────────────────────────────┐
        │ agent  (AGENT) │                              │ submit_intent (function-call key, 0 deposit)
        └───────┬────────┘                              ▼
                │                         ┌─────────────────────────┐
   ┌────────────▼─────────────┐           │  NEAR vault (Rust)      │
   │ Counterfactual replay    │           │  • owner policy + mandate│
   │  reference vs adversarial│           │  • canonical intent hash │
   │  + 20 field mutations    │           │  • nonce, expiry, budget │
   ├──────────────────────────┤           │  • re-checks on attest   │
   │ Security swarm           │           │    AND on execute        │
   │  injection · fraud · red │           │  • reserve → transfer →  │
   ├──────────────────────────┤           │    private callback      │
   │ CVR: evidence Merkle root│           └─────────▲───────────────┘
   └────────────┬─────────────┘                     │ attest_intent(hash, evidence_root, approve)
                │                                   │
        ┌───────▼────────┐  recomputes everything,  │
        │ Independent    │  reads the mandate from──┘
        │ verifier (ATTESTOR) the chain, never from the agent
        └────────────────┘
 Owner console (OWNER key) writes policy and mandates in its own process.
```

* **The agent is untrusted by design.** It holds only a function-call key that can call `submit_intent` and `execute_intent` with zero deposit. It cannot move funds, write mandates or attest.
* **Mandates are written by the owner, not parsed from invoices.** A mandate binds the recipient, the exact amount, the purpose and the SHA-256 of the authorized invoice.
* **The vault decides.** `attest_intent(approve=true)` and `execute_intent` both re-run every invariant against current state, so a compromised attestor, a revoked mandate, a policy change or a replay still fails.
* **AI explains; invariants authorize.** The investigators produce schema-validated findings that go into the receipt. There is no majority vote.
* **Role isolation.** The agent, verifier and owner run as separate processes, and each receives exactly one NEAR key (`scripts/testnet-role.mjs`). Each service refuses to start if it sees another role's key. The browser holds no keys.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) · [docs/CONTRACT_API.md](docs/CONTRACT_API.md)

## Quick start

Requirements: Node 22.12+, pnpm 11, and Python 3.12+. The Rust toolchain (pinned to 1.97.0 by `rust-toolchain.toml`) is needed only to rebuild or test the contract.

```bash
pnpm install
pnpm run setup                # creates .venv, installs pinned Python deps
pnpm dev                  # local simulation: no keys, no network → http://127.0.0.1:3000
```

| Do this | See this |
| --- | --- |
| `pnpm dev`, then open **Agent Command** and run the injected-invoice preset | The agent is fooled and proposes paying `attacker.testnet`; the vault blocks it with `RECIPIENT_NOT_ALLOWED`, `AUTHORIZATION_RECIPIENT` and others, and you get a signed receipt. |
| Click **Demo** in the top bar (or open `/#demo`) | An 8-step guided story built from the **real testnet transactions**. |
| **Attack Laboratory → Run all scenarios** | 23 scenarios across 18 threat categories; every outcome matches expectations. |
| **Evidence Explorer → Tamper: flip the verdict & re-hash** | The in-browser verifier rejects the forged receipt even though its hash was recomputed. |
| `pnpm demo:offline` | Writes `artifacts/benchmark-offline.json` (raw results for all 23 scenarios). |
| `pnpm verify:receipts` | Re-verifies every receipt in `examples/receipts/`. |
| `pnpm aegis:verify --receipt examples/receipts/testnet-blocked.json --network` | Recomputes the receipt and confirms on NEAR testnet that the vault recorded the **denial** for that exact intent hash. |
| `pnpm test` | Python (99), TypeScript (13) and Rust contract (68) tests, including the cross-language policy vectors. |
| `pnpm build:static && pnpm test:e2e` | Builds the key-less public viewer and runs the Playwright smoke tests (desktop and mobile). |

### Real NEAR testnet (optional)

```bash
pnpm testnet:provision    # creates disposable faucet-funded accounts in runtime/ (git-ignored)
pnpm testnet:deploy       # deploy + initialize the vault atomically (VAULT key only)
pnpm testnet:e2e          # full evidence matrix through the role-isolated services
pnpm dev:testnet          # workstation against the live vault; owner token in runtime/owner-token.txt
```

The evidence matrix writes `artifacts/testnet-evidence.json` and `examples/receipts/testnet-*.json`, then verifies both receipts against the chain. Every hash comes from RPC responses. If a step's outcome differs from its expectation, the run is reported as failed. See [docs/NEAR_DEPLOYMENT.md](docs/NEAR_DEPLOYMENT.md).

### Public viewer

`pnpm build:static` produces `apps/web/out`, a static, key-less evidence viewer. It shows the recorded testnet evidence and reads the vault's **current** state from public testnet RPC. It cannot sign anything. Set `AEGIS_BASE_PATH=/<repo>` for GitHub Pages; the included workflow does this for you.

## Optional LLM

The default agent is an offline, deterministic heuristic that is deliberately gullible, so the attack is reproducible. An LLM can be plugged in (`LLM_PROVIDER=ollama|openai|openrouter|nearai`). Its output is schema-validated, and it fails closed. Paid providers are refused unless a human sets `AEGIS_ALLOW_PAID_LLM=true`. The model's quality does not affect safety: whatever it proposes, the vault enforces the mandate.

## Repository map

```
contracts/aegis-vault/        Rust vault (near-sdk 5.30.0) + 68 unit tests
services/replay-engine/aegis/ agent, replay engine, swarm, receipts, lab, 3 FastAPI services, CLI
services/{agent,verifier,owner}-api/  service entrypoints (one principal each)
packages/near-client/         TypeScript NEAR client, canonical encoding, role bridge
packages/receipt-verifier/    independent TypeScript CVR verifier (browser + Node)
packages/shared-types/        canonical + policy vectors, demo fixtures (shared by all three languages)
apps/web/                     Next.js workstation (7 views + guided demo)
scenarios/                    23 attack/control scenarios (JSON)
scripts/                      build, deploy, role runner, testnet e2e, dev launcher
artifacts/                    wasm, build manifest, deployment record, testnet evidence, benchmark
examples/receipts/            example CVRs (local and testnet)
docs/                         architecture, threat model, security review, limitations, demo script
```

## Security posture

* Testnet only. The contract refuses to initialize on any account that does not end in `.testnet`, and every intent is domain-bound to `testnet` and to the vault account.
* No secrets in the repo. Credentials live in the git-ignored `runtime/` folder. `.env` is ignored, and `.env.example` contains no values.
* Bounded storage: a daily proposal quota (64), an audit ring (128), and caps on mandates and recipients. Storage-backing balance is never spendable.
* Known limitations, including that **the vault account keeps a full-access key for upgrades**, are listed in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). A summary of the review findings and their fixes is in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).

## Disclosure

This project was built during NEAR Hackathon 2026 (no pre-existing baseline code) with substantial AI assistance (Claude Code). Third-party libraries are listed in `package.json`, `requirements.txt` and `contracts/aegis-vault/Cargo.toml`. See [docs/SUBMISSION.md](docs/SUBMISSION.md).

License: MIT.
