# Build status

Last updated 2026-11-06. Version **1.0.0**.

| Area | Status | Evidence |
| --- | --- | --- |
| Vault contract | Done | 68 Rust tests pass; reproducible MVP wasm (`artifacts/contract-build.json`) |
| Testnet deployment | Done | `vault.aegis-cf-mw2gs131-c04639.testnet`; on-chain code hash equals the local wasm hash |
| Testnet evidence matrix | Done | 19/19 steps as expected, 15 real transactions (`artifacts/testnet-evidence.json`) |
| Agent, replay engine, swarm, receipts | Done | 99 Python tests pass |
| Three role-isolated services | Done | `test_services.py` (tokens, CSRF, foreign-key refusal, forged receipts) |
| Attack laboratory | Done | 23/23 scenarios as expected (`artifacts/benchmark-offline.json`) |
| Cross-language parity | Done | 31 policy vectors + canonical vectors: Rust = Python = TypeScript |
| Independent TS receipt verifier | Done | 5 tests; runs in the browser |
| Web workstation + guided demo | Done | `next build` passes; Playwright smoke 6/6 (desktop + mobile) on the static build |
| Static public viewer | Done | `pnpm build:static` → `apps/web/out`; GitHub Pages workflow included |
| Docs | Done | README, architecture, threat model, security review, limitations, benchmarks, demo script, submission pack |
| CI | Done | `.github/workflows/ci.yml` (Python, TypeScript, Rust, web build, e2e) |

## Human-only steps (not done by the assistant)

1. Create the public GitHub repository and push.
2. Enable GitHub Pages (Actions source).
3. Record the demo video.
4. Post on X (@NEARProtocol #NEARHackathon).
5. Submit the form with your NEAR payout account before 2026-11-14 23:59 UTC.

## Reproduce the checks

```bash
pnpm install && pnpm run setup
pnpm test                         # Python + TypeScript + Rust
pnpm demo:offline                 # 23 scenarios → artifacts/benchmark-offline.json
pnpm verify:receipts              # all example receipts
pnpm build:static && pnpm test:e2e   # PW_CHANNEL=msedge to use an installed Edge
```
