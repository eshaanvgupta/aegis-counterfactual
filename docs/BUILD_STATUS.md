# Verified build status

Last updated November 7, 2026. Release **1.0.0**.

| Area | Verified result | Evidence |
| --- | --- | --- |
| Vault contract | Hardened Rust contract with 68 passing tests | `contracts/aegis-vault`, `artifacts/contract-build.json` |
| NEAR deployment | Live on testnet; on-chain code hash matches the committed WASM | [`docs/NEAR_DEPLOYMENT.md`](NEAR_DEPLOYMENT.md) |
| Testnet evidence matrix | 19/19 expected steps across 15 real transactions | `artifacts/testnet-evidence.json` |
| Agent security pipeline | Agent, counterfactual replay, investigators and receipts pass 100 Python tests | `tests/` |
| Role-isolated services | Owner, agent and verifier services enforce credential, token, origin, CSRF and receipt boundaries | `tests/test_services.py` |
| Attack laboratory | 23/23 scenarios produce the expected outcome | `artifacts/benchmark-offline.json` |
| Cross-language parity | 31 policy vectors and canonical vectors agree in Rust, Python and TypeScript | `packages/shared-types/` |
| Independent receipt verifier | Browser and Node verifier passes five dedicated tests | `packages/receipt-verifier/` |
| Web workstation | Next.js build, type checks and 8 browser end-to-end checks (desktop + mobile) pass, including live probes of the deployed contract | `apps/web`, `tests/e2e/` |
| Public deployment | Live console served by GitHub Pages, auto-syncing vault state from NEAR RPC | [Live site](https://eshaanvgupta.github.io/aegis-counterfactual/) |
| Live Contract Probe | Visitor-written attacks judged by the deployed contract's `check_intent` in real time, with browser-side parity | [Probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe) |
| Production stack | Role-isolated containers, hardened gateway, readiness probes, configuration validator and attested image builds | [`docs/PRODUCTION_DEPLOYMENT.md`](PRODUCTION_DEPLOYMENT.md) |
| Documentation | Architecture, threat model, API, deployment, security review, benchmarks and demo guide are complete | `docs/` |
| Continuous integration | Python, TypeScript, Rust, web build and browser checks pass on GitHub Actions | [Actions](https://github.com/eshaanvgupta/aegis-counterfactual/actions) |
| Submission | Public repository, live demo and competition form delivered | [Repository](https://github.com/eshaanvgupta/aegis-counterfactual) |

## Reproduce the verification

```bash
pnpm install && pnpm run setup
pnpm test                         # Python + TypeScript + Rust
pnpm demo:offline                 # 23 scenarios -> artifacts/benchmark-offline.json
pnpm verify:receipts              # independently recompute every example receipt
pnpm build:static && pnpm test:e2e
```

## Inspect the live proof

1. Open the [Live Contract Probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe), write an attack, and watch the deployed contract judge it; then start the eight-step guided demo.
2. Follow any displayed transaction hash to NEAR testnet explorer.
3. Compare the deployed code hash with `artifacts/aegis_vault.wasm.sha256` and `artifacts/contract-build.json`.
4. Run `pnpm aegis:verify --receipt examples/receipts/testnet-blocked.json --network` to bind the recorded denial to current chain state.
