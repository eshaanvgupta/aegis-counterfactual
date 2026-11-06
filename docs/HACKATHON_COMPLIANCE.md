# Hackathon compliance and evidence record

AEGIS // COUNTERFACTUAL was created in a new workspace during the NEAR Hackathon 2026 build window and submitted by the project owner on November 6, 2026. This document maps the delivered project to the organizer requirements and its strongest track fit.

## Delivery record

| Requirement | Delivered evidence |
| --- | --- |
| New work during the event | New project workspace and root commit created during the 2026 build window; development disclosure in [SUBMISSION.md](SUBMISSION.md) |
| Working prototype | Full local workstation, three role-isolated services, native NEAR contract and live public evidence viewer |
| Public source | [github.com/eshaanvgupta/aegis-counterfactual](https://github.com/eshaanvgupta/aegis-counterfactual) |
| Reproducible instructions | README quick start, exact lockfiles, pinned Rust toolchain, reproducible contract build and `do X -> see Y` verification table |
| Native NEAR integration | Deployed Rust vault with matching code hash, restricted function-call keys and 15 recorded testnet transactions |
| Demonstrable result | [Live Contract Probe](https://eshaanvgupta.github.io/aegis-counterfactual/#probe) judged by the deployed contract in real time, the guided demo, and explorer-linked on-chain evidence |
| Automated verification | 181 tests across Rust, Python and TypeScript, plus 8 browser end-to-end checks |
| License | MIT (`LICENSE`) |
| AI assistance disclosure | Human-directed AI-assisted development and deterministic recorded runtime disclosed in [SUBMISSION.md](SUBMISSION.md) |
| Submission | Project owner confirmed final form delivery on November 6, 2026 |

## Track fit

### AI Security & Defense — primary

AEGIS directly implements the track's core challenge: give an AI agent financial capability without giving it unrestricted authority. The project combines a scoped function-call key, owner-defined spending policy, exact business mandates, an attack replay laboratory and deterministic on-chain rejection. The central demonstration shows a prompt-injected agent and a deliberately compromised attestor failing to redirect funds.

### Autonomous Business

The owner creates an invoice-specific procurement mandate, while the agent proposes and completes only the authorized payment. Policy versions, pause controls, revocation, exact-purpose binding, per-transaction limits and daily budgets turn a business rule into enforceable treasury control.

### Agent Economy

The agent participates in an end-to-end payment workflow using its own restricted NEAR identity. It can submit and execute approved intents, while the vault retains custody and authority.

### Real-World Money

The demonstrated workflow protects invoice payment: exact vendor, amount, purpose and source-document fingerprint are independently authorized before settlement. This is a concrete control plane for business payment automation.

## Organizer-aligned security design

| Organizer theme | AEGIS implementation |
| --- | --- |
| Scoped agent authority | Function-call key restricted to the vault and `submit_intent,execute_intent`, with zero attached deposit |
| Independent policy | Owner policy and invoice mandate are written outside the agent process |
| Safe asynchronous settlement | Budget reserved before transfer and reconciled in a private callback |
| Storage safety | Bounded identifiers, proposal quota, mandate/recipient caps, fixed audit ring and protected storage balance |
| Reproducible attack demo | Authorized and attacker-controlled inputs replayed under the same mandate, plus 20 field mutations |
| Inspectable evidence | CVR Merkle root committed on-chain and independently recomputed in Python and TypeScript |

## Evidence anchors

* Contract account: [`vault.aegis-cf-mw2gs131-c04639.testnet`](https://testnet.nearblocks.io/address/vault.aegis-cf-mw2gs131-c04639.testnet)
* Prompt-injection denial: [`8K6AnS8k8kVYHmSVmfihYMgE8UA1msErdjK1oyycQmMe`](https://testnet.nearblocks.io/txns/8K6AnS8k8kVYHmSVmfihYMgE8UA1msErdjK1oyycQmMe)
* Compromised-attestor rejection: [`BZPz2JdHZDEHNFmvNRLKuQS8hXjqVcV7JNYsi8FnzPcR`](https://testnet.nearblocks.io/txns/BZPz2JdHZDEHNFmvNRLKuQS8hXjqVcV7JNYsi8FnzPcR)
* Authorized 0.05 NEAR settlement: [`2DhAJUe7C3EAXsA2fZzwhNiVPYaMDeQTEzGqa5MsTweK`](https://testnet.nearblocks.io/txns/2DhAJUe7C3EAXsA2fZzwhNiVPYaMDeQTEzGqa5MsTweK)
* Full evidence ledger: [`artifacts/testnet-evidence.json`](../artifacts/testnet-evidence.json)

The implementation uses near-sdk 5.30.0 and near-api-js 7.4.0 with versions pinned in the repository. The design follows NEAR guidance for [access keys](https://docs.near.org/protocol/accounts-contracts/access-keys), [private callbacks](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks) and [storage safety](https://docs.near.org/smart-contracts/security/storage).
