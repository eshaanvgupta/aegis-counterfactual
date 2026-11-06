# Submission pack (drafts: nothing here has been submitted or posted)

Fill in the `<…>` placeholders, review, then submit yourself. Submissions cannot be edited afterwards.

## Form fields

* **Project name:** AEGIS // COUNTERFACTUAL
* **Primary track:** AI Security & Defense
* **Repository:** `<https://github.com/<you>/aegis-counterfactual>` (must be public through judging)
* **Live demo:** `<GitHub Pages URL from the "Pages" workflow>` (key-less evidence viewer)
* **Demo video:** `<link>`
* **X post:** `<link>`
* **NEAR payout account:** `<your-account.near>` (do **not** use the disposable testnet accounts)
* **Contract (testnet):** `vault.aegis-cf-mw2gs131-c04639.testnet`

### One-liner

The AI can be compromised. The financial authorization boundary cannot. AEGIS lets AI agents pay invoices on NEAR while a vault contract enforces the owner's mandate, even when the agent and its attestor are compromised.

### Description (about 200 words)

AI agents that pay invoices read untrusted text, and a single injected line can redirect a payment. AEGIS treats the agent as untrusted by design. The agent can only *propose* a payment through a restricted function-call key. A Rust vault on NEAR testnet re-checks every proposal against a mandate the owner wrote independently (exact recipient, exact amount, purpose, the SHA-256 of the authorized invoice, expiry, nonce, daily budget) and pays only on an exact match.

Before anything reaches the vault, a counterfactual replay engine runs the same agent and mandate on the authorized and the attacked input, then tries 20 mutations of every field. Three specialist investigators explain the result, and everything is sealed into a Counterfactual Verification Receipt whose Merkle root is committed on-chain. Independent verifiers in Python and TypeScript re-check it, and the Rust, Python and TypeScript policy implementations agree on 31 shared vectors.

On testnet we recorded 19/19 expected outcomes across 15 real transactions. A prompt-injected payment was blocked. A deliberately **compromised attestor** was rejected with `POLICY_VIOLATION:RECIPIENT_NOT_ALLOWED`. Replay and double spend failed. The legitimate 0.05 NEAR payment executed. Across 23 synthetic attacks, an unprotected agent would have sent 8 harmful payments; AEGIS sent 0.

### How NEAR is used

The native Rust vault (near-sdk 5.30.0) holds the funds. Restricted function-call access keys separate the agent and attestor roles. The canonical Borsh intent hash is domain-bound to the network and the vault. Budget is reserved before the async transfer and settled in a private callback. Audit events are emitted on-chain. Deployed and exercised on testnet.

## X post draft (do not post without your approval)

> AI agents will get prompt-injected. The question is whether they can still move your money.
>
> AEGIS // COUNTERFACTUAL: the agent only *proposes*; a NEAR vault enforces the owner's mandate. We even compromised the attestor key. The contract still said no. 19/19 on testnet.
>
> Demo 👇 `<video/link>`
> `<repo>`
>
> @NEARProtocol #NEARHackathon

## AI-assistance and originality disclosure

* All code was written during the hackathon window (Nov 2026) in a new, empty workspace. There is no pre-existing baseline code.
* Built with substantial AI assistance: Anthropic Claude (Claude Code) generated most code, tests and documentation under human direction and review.
* No LLM is used at runtime by default. The recorded results use a deterministic offline agent (`model_calls: 0`).
* Third-party libraries: near-sdk, near-api-js, @noble/hashes, FastAPI, Pydantic, uvicorn, httpx, Next.js, React, Tailwind CSS, motion, @xyflow/react, lucide-react, binaryen and Playwright (see the lockfiles for versions).
* Test fixtures (invoices, vendors, scenarios) are synthetic.

## Pre-submission checklist (human)

- [ ] Create the public GitHub repository and push (Claude has not pushed anything).
- [ ] Enable GitHub Pages (Settings → Pages → GitHub Actions) and confirm the viewer loads.
- [ ] Record the demo video ([DEMO_SCRIPT.md](DEMO_SCRIPT.md)).
- [ ] Post on X with @NEARProtocol and #NEARHackathon.
- [ ] Fill in the payout account and links above, then submit before **2026-11-14 23:59 UTC**.
