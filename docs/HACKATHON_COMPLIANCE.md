# Hackathon compliance and research record

Requirements recorded from the [organizer rules](https://nearhackathon.com/HACKATHON.md) on 2026-11-04 and evidence status updated on 2026-11-06. Re-read the live rules before submitting.

## Event facts

The build/submission deadline is **November 14, 2026, 23:59 UTC**, or **November 15, 2026, 05:29 IST**. Judging begins November 16; results are due November 18, 23:59 UTC. Eligible new work starts October 19. Existing code must be identified as baseline; libraries and AI assistance are allowed and should be disclosed. Testnet projects qualify, and named ecosystem integrations are optional. [Rules, Q-001–005, Q-010–011](https://nearhackathon.com/HACKATHON.md)

A submission needs a public repository, working prototype, reproducible instructions, NEAR payout account, and public X demo post mentioning the event with @NEARProtocol and #NEARHackathon. A local-only demonstration needs a video. Keep source public through judging and include a license. There is one submission per project; submissions cannot be edited. One person may enter two independent, cross-disclosed projects. AI screening informs human judges; it does not decide awards. [Submission and eligibility rules](https://nearhackathon.com/HACKATHON.md)

The pool is $250,000: $55,000 overall, and $10,000/$3,000/$2,000 per track, paid in NEAR. [Prize schedule](https://nearhackathon.com/HACKATHON.md)

## Track fit

| Track | Proposed fit and evidence needed |
| --- | --- |
| `security` — primary | Compromised payment proposal, independent mandate, restricted agent identity, contract rejection, replay evidence. |
| `swarms` — conditional | Three specialist roles with distinct, inspectable outputs. The track emphasizes agent economies; a security ensemble alone is weaker evidence of fit. Claim only if coordination is substantive. |
| `business` — conditional | Procurement objective and treasury control; requires a demonstrated business workflow. |
| `agents` — conditional | An agent proposes and completes authorized payments; no claim of an open agent marketplace. |
| `open` — optional | Integrated counterfactual experiment and evidence workflow, if reviewers find it useful beyond the primary track. |

The [security starter](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md) illustrates allow/warn/block checking, a scoped function-call key, and a stopped injection attack. The [swarm starter](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/05-swarms.md) illustrates a group-buying market, agent subaccounts, deterministic simulation, and visible coordination. These are examples, not universal requirements. Their example approval checkpoints do not replace the user's authorized local build instructions.

## Submission evidence gates

| Gate | Evidence | Status |
| --- | --- | --- |
| Fresh contribution | New, empty workspace started 2026-11-04 (inside the window); no baseline code; AI assistance disclosed in [SUBMISSION.md](SUBMISSION.md) | Ready |
| Reproducible prototype | `pnpm install && pnpm run setup && pnpm dev`; `pnpm test`; README "do X → see Y" table | Ready |
| Native NEAR enforcement | Deployed vault, matching code hash, 9 successful + 6 rejected real transactions | Ready |
| Identity separation | Distinct OWNER / VAULT / AGENT / ATTESTOR / RECIPIENT accounts; agent and attestor hold function-call keys (`artifacts/testnet-accounts.json`, public keys only) | Ready |
| Receipt verification | `pnpm verify:receipts`, `aegis:verify --network`, in-browser tamper demo, tamper tests | Ready |
| License | MIT (`LICENSE`) | Ready |
| Public repo, X post, video | Drafts in [SUBMISSION.md](SUBMISSION.md) and [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | **Human action required** |
| Honest claims | Mode, agent type and evidence-source badges in the UI; [LIMITATIONS.md](LIMITATIONS.md) | Ready |
| Final application | Payout account, links, explicit human submission | **Human action required** |

Publishing, posting, pushing and submitting are deliberately left to the human.

## Verified NEAR interfaces and infrastructure

| Item | Observation on November 4, 2026 | Primary source |
| --- | --- | --- |
| Rust contract SDK | Current documentation identifies `near-sdk` **5.30.0**; pin the implementation and lockfile rather than floating on `latest`. | [Rust API](https://docs.rs/near-sdk/5.30.0/near_sdk/) |
| JavaScript client | Official releases identify `near-api-js` **7.4.0** as latest. Its API differs from legacy `connect` tutorials. | [Release](https://github.com/near/near-api-js/releases/tag/near-api-js%407.4.0), [current examples](https://docs.near.org/tools/near-api) |
| Restricted keys | Function-call permissions constrain receiver/methods and gas allowance; they cannot attach NEAR. Agent calls must use zero deposit, with transfers initiated by the vault. | [Access keys](https://docs.near.org/protocol/accounts-contracts/access-keys) |
| Async safety | Reserve before dispatch; use a private callback and reconcile outcomes. | [Balance deduction](https://docs.near.org/smart-contracts/security/cross-contract-calls/reentrancy), [callbacks](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks) |
| Storage safety | State consumes storage-backed balance. Bounded identifiers, authorized writers, and a storage reserve are required. | [Storage attacks](https://docs.near.org/smart-contracts/security/storage) |
| Account setup | Official CLI documents faucet-sponsored testnet account creation; account creation was not executed during research. | [CLI account creation](https://docs.near.org/tools/cli#account) |
| Public RPC | FASTNEAR testnet and NEAR archival testnet appear in current provider documentation. | [Providers](https://docs.near.org/api/rpc/providers) |

Read-only JSON-RPC `status` requests returned `chain_id: testnet`, `syncing: false`:

| Endpoint | Observed height | Reported latest-block UTC time |
| --- | --- | --- |
| `https://rpc.testnet.near.org` | 276145710 | 2026-11-04T04:25:25.568307831Z |
| `https://test.rpc.fastnear.com` | 276145711 | 2026-11-04T04:25:26.225643522Z |
| `https://archival-rpc.testnet.near.org` | 276145717 | 2026-11-04T04:25:29.774692518Z |

These observations establish endpoint reachability at review time, not future availability, account funding, contract compatibility, or deployment. Never substitute a block hash for a project transaction hash.

NEAR Intents testnet settlement is outside the native MVP. No swap, TEE attestation, confidential execution, or mainnet outcome may be implied by the local demonstration.
