# AEGIS // COUNTERFACTUAL

**The AI can be compromised. The financial authorization boundary cannot.**

[**Live console**](https://eshaanvgupta.github.io/aegis-counterfactual/) · [**Live Contract Probe**](https://eshaanvgupta.github.io/aegis-counterfactual/#probe) · [**Vault on NEAR testnet**](https://testnet.nearblocks.io/address/vault.aegis-cf-mw2gs131-c04639.testnet) · [**Production deployment**](docs/PRODUCTION_DEPLOYMENT.md) · [**Submission**](docs/SUBMISSION.md)

AEGIS is a security layer for AI agents that move money on NEAR. An AI payment agent reads untrusted invoices, tool results and messages, then *proposes* a payment. It never decides. A NEAR smart-contract vault re-checks every proposal against a business mandate that the owner wrote independently, and pays only on an exact match.

Before anything reaches the vault, a **counterfactual replay engine** runs the same agent and the same mandate on two inputs, the authorized invoice and the attacker-controlled one. It then mutates every field to show which invariant catches each attack. Three specialist investigators explain what happened, and the evidence is sealed into a **Counterfactual Verification Receipt** (CVR). The CVR is bound to the exact intent hash, and its Merkle root is committed on-chain. Anyone can verify a CVR independently, from the command line or in the browser.

> Primary track: **AI Security & Defense**. Live on native NEAR testnet. Fully reproducible with deterministic inference and no paid API.

## Try it in 60 seconds, with no install

1. Open the **[Live Contract Probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe)**. It starts with a prompt-injected invoice. The in-browser agent falls for it and proposes paying `attacker.testnet` 0.5 NEAR. The **deployed Rust contract** answers *BLOCKED by 7 invariants* at a live block height.
2. Click **Authorized invoice**. The same contract answers *policy-clear* for the owner's exact mandate.
3. Type anything into the invoice, or try *Invisible directive*, *Poisoned tool output*, *Spoofed finance email*, *Swapped invoice* or *Wrong purpose*. Every edit goes to the contract's `check_intent` view on NEAR testnet. Your browser independently re-derives the canonical intent hash and every policy check, and shows that it agrees with the chain. A ready-made `curl` command reproduces each verdict from a terminal.
4. Click **Demo** for the 8-step story of the recorded testnet run: injection, compromise, replay, verdict, on-chain block, and legitimate settlement.
5. In **Evidence Explorer**, click *Tamper* and watch the independent verifier reject a forged receipt, even after its hash is recomputed.

## What is proven, and where

| Claim | Evidence you can check |
| --- | --- |
| The vault is live on NEAR testnet and its code is this repository | `vault.aegis-cf-mw2gs131-c04639.testnet`, code hash `AAVfbPT7XAg3FPQMpZyeTX11Zxh7CKH1rPpzkGb8MMuj` = base58(sha256(`artifacts/aegis_vault.wasm`)). The build reproduces bit-for-bit (`pnpm build:contract`). |
| A prompt-injected payment was stopped **on-chain** | Attestor deny [`8K6AnS8k…`](https://testnet.nearblocks.io/txns/8K6AnS8k8kVYHmSVmfihYMgE8UA1msErdjK1oyycQmMe). The agent's forced execute was rejected with `INTENT_NOT_ATTESTED` in [`HwExgE5M…`](https://testnet.nearblocks.io/txns/HwExgE5Mkq4NLEozQbadZJW7J6pckeX5bpbTxq2FuZtK). |
| Even a **compromised attestor key** cannot approve a redirected payment | Rejected with `POLICY_VIOLATION:RECIPIENT_NOT_ALLOWED,AUTHORIZATION_RECIPIENT` in [`BZPz2JdH…`](https://testnet.nearblocks.io/txns/BZPz2JdHZDEHNFmvNRLKuQS8hXjqVcV7JNYsi8FnzPcR). |
| The legitimate payment executes and settles | 0.05 NEAR transferred and reconciled in the private callback, in [`2DhAJUe7…`](https://testnet.nearblocks.io/txns/2DhAJUe7C3EAXsA2fZzwhNiVPYaMDeQTEzGqa5MsTweK). |
| Replays, double spends and privilege escalation fail | `NONCE_REPLAY`, `AUTHORIZATION_BUDGET`, `INTENT_NOT_ATTESTED`, and an access-key rejection when the agent's function-call key calls an owner method (`artifacts/testnet-evidence.json`). |
| The full on-chain matrix | **19/19 steps as expected across 15 real testnet transactions**: 9 succeeded, and 6 unauthorized actions were rejected by the contract. |
| The contract judges arbitrary input live | The [Live Contract Probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe) evaluates visitor-written attacks against standing mandate `INV-2026-003` (written by the owner in [`aUj1V9ZR…`](https://testnet.nearblocks.io/txns/aUj1V9ZRBHeqhvgSH7kYmMw7sAufzMdGRp7DM7ETKFF)). |
| The attack laboratory | 23/23 scenarios across 18 threat categories match their declared outcomes. The same compromised agent without AEGIS would have signed **8 harmful transfers worth 1.75 NEAR**; with AEGIS, **0**. See [docs/BENCHMARKS.md](docs/BENCHMARKS.md). |
| One policy, three independent implementations | Rust (contract), Python (verifier) and TypeScript (browser) agree on all 31 shared policy vectors and the canonical intent-hash vectors. The Live Contract Probe re-checks browser-versus-contract agreement on every edit. |
| Engineering quality | **181 automated tests** (68 Rust, 100 Python, 13 TypeScript) plus 8 browser end-to-end checks on desktop and mobile, all green in [CI](https://github.com/eshaanvgupta/aegis-counterfactual/actions). |

## What makes AEGIS different

1. **An independent mandate.** The owner authorizes the exact vendor, amount, purpose and source-document hash, outside the agent's context. Text the agent reads can never create or widen authority.
2. **A counterfactual twin.** Authorized and attacker-controlled inputs run through the same agent and the same immutable mandate, followed by 20 single-field mutations, so every attack is explained by the specific invariant that stops it.
3. **Authority separated from explanation.** Three specialist investigators (prompt injection, financial fraud, red team) explain the attack. Deterministic invariants alone decide. There is no majority vote.
4. **Resilience to a compromised reviewer.** The vault re-checks the mandate during attestation *and* execution. A forced approval from the attestor key itself was rejected on-chain.
5. **A transaction-bound receipt.** The CVR binds the exact intent, policy snapshot, paired traces, variations and findings under a Merkle root that is committed with the on-chain decision.
6. **Proof anyone can re-run.** The repository ships the reproducible WASM, the build manifest, the public transaction ledger, receipts, the scenario corpus, and a browser verifier that recomputes everything independently.

## How it works

```
 untrusted invoice / tool output / message
                │
        ┌───────▼────────┐  proposes an intent (never authorizes)
        │ Transaction    │──────────────────────────────┐
        │ agent  (AGENT) │                              │ submit_intent (function-call key, 0 deposit)
        └───────┬────────┘                              ▼
                │                         ┌─────────────────────────┐
   ┌────────────▼─────────────┐           │  NEAR vault (Rust)       │
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
 Owner console (OWNER key) writes policy and mandates in its own service.
```

* **The agent is untrusted by design.** It holds only a function-call key restricted to `submit_intent` and `execute_intent`, with zero deposit. It has no ability to move funds, write mandates or attest.
* **Mandates come from the owner, never from invoices.** A mandate binds the recipient, the exact amount, the purpose and the SHA-256 of the authorized invoice.
* **The vault decides.** `attest_intent(approve=true)` and `execute_intent` both re-run every invariant against current state, so a compromised attestor, a revoked mandate, a policy change and a replay all fail.
* **Budget safety across async NEAR receipts.** Funds are reserved before the transfer promise and reconciled in a `#[private]` callback. A failed transfer releases the budget while the nonce stays consumed.
* **Role isolation.** The agent, verifier and owner run as separate services, and each receives exactly one NEAR key. A service refuses to start if it sees another role's key, and the browser never holds a key.

Details: [Architecture](docs/ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Contract API](docs/CONTRACT_API.md) · [Security review](docs/SECURITY_REVIEW.md)

## Run it locally

Requirements: Node 22.12+, pnpm 11, and Python 3.12+. The Rust toolchain, pinned to 1.97.0 by `rust-toolchain.toml`, is used to rebuild and test the contract.

```bash
pnpm install
pnpm run setup                # creates .venv and installs pinned Python dependencies
pnpm dev                      # full workstation on a local vault → http://127.0.0.1:3000
```

| Do this | See this |
| --- | --- |
| `pnpm dev`, then **Agent Command → Injected invoice** | The agent proposes paying `attacker.testnet`. The vault blocks it with `RECIPIENT_NOT_ALLOWED`, `AUTHORIZATION_RECIPIENT` and more, and the run produces a signed receipt. |
| **Attack Laboratory → Run all scenarios** | 23 scenarios across 18 threat categories, every outcome as declared. |
| `pnpm demo:offline` | Writes raw results for all 23 scenarios to `artifacts/benchmark-offline.json`. |
| `pnpm verify:receipts` | Re-verifies every receipt in `examples/receipts/`. |
| `pnpm aegis:verify --receipt examples/receipts/testnet-blocked.json --network` | Recomputes the receipt and confirms on NEAR testnet that the vault recorded the denial for that exact intent hash. |
| `pnpm test` | The 181 automated tests across Rust, Python and TypeScript, including cross-language policy vectors. |
| `pnpm build:static && pnpm test:e2e` | Builds the public console and runs the 8 browser end-to-end checks, including live probes against the deployed contract. |

## Deploy it as a product

AEGIS ships a production stack: a server-rendered Next.js console, three role-isolated FastAPI services (agent, independent verifier, owner) and a hardened nginx gateway. The containers are read-only and run unprivileged with all capabilities dropped. Service-to-service traffic stays on an internal backend network, with a separate egress path for NEAR RPC, and every container exposes health and readiness probes. CI builds SBOM- and provenance-attested images on every change.

```bash
node scripts/validate-production.mjs /secure/aegis.production.env   # validates config without printing secrets
docker compose --env-file /secure/aegis.production.env -f compose.production.yml up -d --build
curl --fail http://127.0.0.1:8080/api/system/ready
```

Each signing service receives exactly one role key, and the vault key is never present in any runtime container. The console detects the service stack automatically and switches from chain-reading mode to the full interactive workflow: create mandates, run pipelines, attest, execute, pause. See [docs/PRODUCTION_DEPLOYMENT.md](docs/PRODUCTION_DEPLOYMENT.md) and [docs/PRODUCTION_CONTROLS.md](docs/PRODUCTION_CONTROLS.md).

The public console at [eshaanvgupta.github.io/aegis-counterfactual](https://eshaanvgupta.github.io/aegis-counterfactual/) holds no keys. It reads the vault's state live from NEAR RPC, with endpoint failover and auto-sync every 15 seconds, and sends Live Probe evaluations to the contract in real time.

## Reproduce the testnet deployment

```bash
pnpm testnet:provision    # fresh faucet-funded OWNER, VAULT, AGENT, ATTESTOR and RECIPIENT accounts (git-ignored)
pnpm testnet:deploy       # deploy + initialize the vault atomically (VAULT key only)
pnpm testnet:e2e          # full evidence matrix through the role-isolated services
pnpm dev:testnet          # workstation against your vault
```

The evidence matrix writes `artifacts/testnet-evidence.json` and `examples/receipts/testnet-*.json`, then verifies both receipts against the chain. Every hash comes from RPC responses, and a step whose outcome differs from its expectation fails the run. See [docs/NEAR_DEPLOYMENT.md](docs/NEAR_DEPLOYMENT.md).

## Any model, same guarantee

The reference agent is deterministic and susceptible to attack by design: it obeys any instruction it finds, including invisible Unicode text. That makes it a reproducible worst-case agent. If the boundary holds against an agent that falls for every attack, it holds against any model. Production deployments can plug in a model with `LLM_PROVIDER=ollama|openai|openrouter|nearai`. Model output is schema-validated and fails closed, and paid providers require an explicit operator opt-in (`AEGIS_ALLOW_PAID_LLM=true`).

## Repository map

```
contracts/aegis-vault/        Rust vault (near-sdk 5.30.0) + 68 unit tests
services/replay-engine/aegis/ agent, replay engine, swarm, receipts, lab, 3 FastAPI services, CLI
services/{agent,verifier,owner}-api/  service entrypoints (one principal each)
packages/near-client/         TypeScript NEAR client, canonical encoding, role bridge
packages/receipt-verifier/    independent TypeScript CVR verifier and policy engine (browser + Node)
packages/shared-types/        canonical + policy vectors, fixtures shared by all three languages
apps/web/                     Next.js console: 8 views, Live Contract Probe, guided demo
deploy/, compose.production.yml  production containers, gateway, environment template
scenarios/                    23 attack and control scenarios (JSON)
scripts/                      build, deploy, role runner, testnet e2e, production validation
artifacts/                    wasm, build manifest, deployment record, testnet evidence, benchmark
examples/receipts/            example CVRs (local and testnet)
docs/                         architecture, threat model, security review, production, demo script
```

## Security posture

* **Domain-bound.** Every intent is bound to the network and the vault account, and the release contract initializes only on `.testnet` accounts.
* **No secrets in the repository.** Credentials live in the git-ignored `runtime/` folder or a managed secret store. `.env.example` contains no values.
* **Bounded storage and gas.** A daily proposal quota (64), an audit ring (128), and caps on mandates and recipients. The storage-backing balance is never spendable.
* **Adversarially reviewed.** All six findings from the internal adversarial review are closed with regression tests and testnet evidence ([Security review](docs/SECURITY_REVIEW.md)).
* **Clear authority model.** Governance of the owner and upgrade authority, with a mainnet promotion path, is defined in [Security boundaries and production controls](docs/PRODUCTION_CONTROLS.md).

## Development notes

Built during NEAR Hackathon 2026 in a new workspace, using AI-assisted development under human direction and review. Third-party libraries and exact versions are listed in `package.json`, `requirements.txt`, `contracts/aegis-vault/Cargo.toml` and the lockfiles.

License: MIT.
