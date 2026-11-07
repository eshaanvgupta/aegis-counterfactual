# NEAR testnet deployment

## Current deployment

| Item | Value |
| --- | --- |
| Network | NEAR **testnet** — reproducible competition deployment |
| Vault | [`vault.aegis-cf-mw2gs131-c04639.testnet`](https://testnet.nearblocks.io/address/vault.aegis-cf-mw2gs131-c04639.testnet) |
| Contract | v1.0.0, code hash `AAVfbPT7XAg3FPQMpZyeTX11Zxh7CKH1rPpzkGb8MMuj` |
| WASM SHA-256 | `8827d259dd6f2c520e09a60c468da5752ddad23b15f84795d0a6c591e4be58d2` (`artifacts/aegis_vault.wasm`) |
| Deploy + init (atomic) | [`48ukvVxfSxUbDu5HbfXCshbDiDcKWJ4DogFLGSC1Km48`](https://testnet.nearblocks.io/txns/48ukvVxfSxUbDu5HbfXCshbDiDcKWJ4DogFLGSC1Km48) |
| Upgrade 1 | [`FB6AtsHRJtZKd7NaQXRkhD61yDpLqp5PKg4Li1iDFkk1`](https://testnet.nearblocks.io/txns/FB6AtsHRJtZKd7NaQXRkhD61yDpLqp5PKg4Li1iDFkk1). Enables descriptive on-chain panic codes (`--cfg near`) |
| Upgrade 2 | [`FypzJGy3BjKcZMvMKQ7UeU7FAGmPgzYphZvDWfCjjLmm`](https://testnet.nearblocks.io/txns/FypzJGy3BjKcZMvMKQ7UeU7FAGmPgzYphZvDWfCjjLmm). Bit-for-bit reproducible build (path remapping); current code |
| Evidence matrix | `artifacts/testnet-evidence.json`: 19/19 steps as expected, 15 transactions |
| Live Contract Probe mandate | `INV-2026-003`, written by the OWNER key in [`aUj1V9ZRBHeqhvgSH7kYmMw7sAufzMdGRp7DM7ETKFF`](https://testnet.nearblocks.io/txns/aUj1V9ZRBHeqhvgSH7kYmMw7sAufzMdGRp7DM7ETKFF); authorized invoice bytes in `artifacts/probe-mandate.json` |
| Live viewer | [eshaanvgupta.github.io/aegis-counterfactual](https://eshaanvgupta.github.io/aegis-counterfactual/) |

### Principals

| Role | Account | Key on that account used by AEGIS |
| --- | --- | --- |
| OWNER | `aegis-cf-mw2gs131-c04639.testnet` | full access (owner console process only) |
| VAULT | `vault.aegis-cf-mw2gs131-c04639.testnet` | full access (deploy and upgrade only, never used by the services) |
| AGENT | `agent.aegis-cf-mw2gs131-c04639.testnet` | **function-call key**: receiver = vault, methods `submit_intent, execute_intent`, 0.2 NEAR gas allowance |
| ATTESTOR | `attestor.aegis-cf-mw2gs131-c04639.testnet` | **function-call key**: receiver = vault, method `attest_intent`, 0.2 NEAR gas allowance |
| RECIPIENT | `vendor.aegis-cf-mw2gs131-c04639.testnet` | the only allow-listed payee |

Public keys are recorded in `artifacts/testnet-accounts.json`. Development private keys stay in the git-ignored `runtime/dev-credentials/`; production deployments inject one role-specific key into each service from an operator-managed secret source.

## Verify the deployment yourself

```bash
# 1. The code on-chain is the code in this repo
pnpm build:contract     # reproduces artifacts/aegis_vault.wasm (same sha256)
node -e "const c=require('crypto'),f=require('fs');const h=c.createHash('sha256').update(f.readFileSync('artifacts/aegis_vault.wasm')).digest();const A='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+h.toString('hex')),s='';while(n>0n){s=A[Number(n%58n)]+s;n/=58n}console.log(s)"
#    → AAVfbPT7XAg3FPQMpZyeTX11Zxh7CKH1rPpzkGb8MMuj

# 2. Read live state over public RPC (no keys)
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_code","finality":"final","account_id":"vault.aegis-cf-mw2gs131-c04639.testnet"}}' | grep -o '"hash":"[^"]*"'

# 3. Re-verify the recorded receipts against the chain
pnpm aegis:verify --receipt examples/receipts/testnet-blocked.json --network
pnpm aegis:verify --receipt examples/receipts/testnet-allowed.json --network
```

## Reproduce from scratch with isolated testnet accounts

```bash
pnpm install && pnpm run setup
pnpm testnet:provision   # faucet-funded OWNER, VAULT, AGENT (FC key), ATTESTOR (FC key), RECIPIENT
pnpm build:contract      # pinned Rust toolchain + wasm32 target
pnpm testnet:deploy      # VAULT key only: deploy + init in one transaction
pnpm testnet:e2e         # runs the evidence matrix through the role-isolated services
pnpm dev:testnet         # workstation against your vault
```

* `scripts/testnet-role.mjs <ROLE> <script>` starts a script with exactly one role key; `READONLY` gets none. Every other `NEAR_*_PRIVATE_KEY` is removed from the child environment.
* Scripts refuse anything that is not testnet: the account suffix, `NEAR_NETWORK_ID`, and the RPC `chain_id` are all checked.
* `pnpm testnet:upgrade` redeploys the current `artifacts/aegis_vault.wasm` with the VAULT key. State is preserved, and the upgrade is appended to `artifacts/testnet-deployment.json`.

## Build notes

* `rust-toolchain.toml` pins rustc 1.97.0 and the `wasm32-unknown-unknown` target.
* `scripts/build-contract.mjs` builds with `--cfg near` (host functions such as `panic_utf8` and `sha256`) and remaps path prefixes so the output is reproducible. It then lowers post-MVP opcodes with binaryen 132 (`--llvm-memory-copy-fill-lowering`, `--signext-lowering`, `--llvm-nontrapping-fptoint-lowering`), because the NEAR runtime accepts only WebAssembly MVP. Finally it validates the output, checks the host imports and required exports, and writes `artifacts/contract-build.json`.
* The recorded artifact and GitHub CI build on Ubuntu 24.04, and a fresh Linux checkout reproduces the identical SHA-256.
