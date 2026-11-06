# Security boundaries and production controls

AEGIS makes a precise security promise: a spending agent cannot move vault funds outside an independently written business mandate through the supported payment path. The testnet release demonstrates that promise with executable policy checks, restricted keys, counterfactual evidence and recorded on-chain outcomes. This document defines the surrounding trust boundaries and the controls for a commercial rollout.

## Authority model

* **The vault is the financial authority.** Agent and attestor function-call keys cannot transfer NEAR or change policy. Every approval and execution re-runs the recipient, amount, purpose, document, expiry, nonce, policy-version and budget checks.
* **The owner is the policy authority.** The owner can create or revoke mandates, rotate roles, change policy, pause the vault and recover idle funds. Commercial deployments should place this authority behind an organization-controlled multisig or DAO.
* **The deployment key is an upgrade authority.** The testnet vault retains the full-access key used for reproducible upgrades, with every deployed version recorded in `artifacts/testnet-deployment.json`. A mainnet release should use governed upgrades or remove that key after an audited immutable deployment.
* **The attestor supplies evidence review, not spending policy.** A compromised attestor still cannot approve a mandate-violating payment, as demonstrated on-chain. Production operators can add an attestor quorum or availability failover without weakening the contract's deterministic checks.

## Runtime isolation

The owner, agent and verifier run as separate services, and each process receives exactly one role credential. The launcher strips every foreign private-key variable, services refuse mixed credentials, and the browser receives no keys. The production stack (`compose.production.yml`) already runs each role in its own read-only, unprivileged container, with service-to-service traffic on an internal network and the vault key absent from every runtime. The same separation extends to separate hosts or confidential-compute environments, with host hardening, secret management and remote attestation chosen by the operator.

Owner and verifier writes require bearer authentication; state-changing browser requests also require an allowed origin and `X-AEGIS-Client` header. Production deployments should terminate TLS at a trusted gateway, source tokens from a managed secret store, rotate them regularly and restrict the owner API to the operator network.

## Evidence semantics

AEGIS separates four statements so reviewers and operators can see exactly what has been established:

1. **Integrity verified** — receipt hashes and the six-section Merkle root recompute.
2. **Policy verified** — the recorded decision follows from the bound intent, policy and mandate.
3. **On-chain verified** — a network query finds the same decision and evidence root for the exact intent hash.
4. **Analysis** — investigator findings explain the attack indicators; deterministic invariants remain the authorization mechanism.

Offline verification is useful for portable evidence, while `--network` adds authoritative chain binding. Scenario 20 demonstrates that a self-consistent forged receipt is rejected when checked against the vault.

## Demonstrated coverage

* The 23-scenario laboratory is a reproducible regression suite spanning 18 threat categories. All 23 results match their declared expectations.
* The counterfactual baseline quantifies the same fixtures without AEGIS: eight harmful proposals totaling 1.75 NEAR, all prevented. No attacker received funds.
* The testnet ledger covers 19 expected steps across 15 real transactions, including successful settlement and contract-level rejection paths.
* The Live Contract Probe exposes the deployed contract's `check_intent` view to any visitor-written attack, with the verdict re-derived independently in the browser.
* Contract bounds — 64 proposals per day, 128 audit events, 256 mandates and 16 recipients — make storage and gas exposure explicit and testable.

These are executable acceptance results for the declared threat model. Commercial operators can extend the scenario corpus and operating limits for their own payment volumes while preserving the same invariants.

## Supported settlement surface

Release 1.0.0 authorizes native NEAR transfers through `native_transfer`. The exact-amount mandate, allowlist, purpose/document binding, daily budget, pause and revocation controls are complete for that action. Fungible-token adapters, NEAR Intents, swaps and arbitrary contract calls can be added as separately typed actions with action-specific policy checks and tests.

## Mainnet release gates

The committed contract deliberately refuses initialization outside `.testnet`, preventing accidental mainnet use of the competition build. A commercial mainnet release should be a separately reviewed artifact with:

* an independent smart-contract audit and mainnet-specific deployment review;
* governed upgrade and owner authorities;
* production secret management, TLS, monitoring and backup RPC providers;
* load, fuzz and property testing against operator-selected bounds; and
* a staged funding limit with observable rollback and incident procedures.

This separation keeps the hackathon evidence reproducible while giving a commercial deployment an explicit, reviewable promotion path.
