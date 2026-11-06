# Competitive analysis and originality boundaries

Reviewed November 4, 2026. This is a comparison of published primary-source descriptions, not an audit or hands-on certification of other products. “Published” means a vendor or author documents the capability; it does not mean this team independently reproduced it. Search results and page timestamps sometimes disagree, so dates are not used to prove priority.

## Existing approaches and verified overlap

| System | Published approach | Overlap with this project | Difference to investigate, without asserting absence |
| --- | --- | --- | --- |
| OneSource Project Aegis | Isolated agent signer, ERC-4337 account, on-chain permission enforcer, bounded tokens/actions/protocols/time/spend, declared-purpose checking, exported audit events. | A compromised agent should not bypass deterministic policy; purpose checks and an audit trail already exist. | Our proposed demonstrator centers on paired reference/adversarial inputs, reproducible mutations, independently held invoice mandate, and exact native-NEAR intent evidence. The inspected pages do not establish whether OneSource also offers this complete experiment workflow. |
| OutLayer | NEAR MPC-derived keys inside Intel TDX, on-chain owner policy read by enclave, limits/allowlists, approvals, freeze, fixed connectors, execution attestation. | Independent custody boundary, owner policy, restricted agent operation, review before signing. | This MVP uses a Rust vault and a separately credentialed local verifier. It has no hardware isolation or TEE claim, and is less hardened than the published enclave design. Replay evidence is the proposed focus. |
| Turnkey agent wallets | Secure-enclave signing, agent-specific scope, policy conditions and consensus, withdrawal of agent access. Policy docs describe implicit denial, explicit denial precedence and root-quorum override. | Signing governed outside a model; separate agent authority; transaction restrictions. | Our intended experiment binds an immutable business mandate to paired replay traces and a NEAR vault outcome. We do not claim to improve Turnkey custody or signing infrastructure. |
| Sardis | Agent payment platform with wallet policy checks, mandate context, spending/vendor constraints, receipts and audit trail, sandbox and payment rails. | Structured purpose, authorized counterparties, spend budgets, pre-execution evaluation, evidence. | The proposed contribution is an inspectable counterfactual laboratory and transaction-bound evidence tied to the native NEAR implementation. Mandates and cryptographic receipts alone are not new. |
| AEGIS pre-execution firewall research | Tool-call interception, content scanning, composable policy validation, approval holds and signed/hash-chained audit records. | Pre-action security mediation, policy checking, tamper-evident evidence and similar name. | This project narrows enforcement to finance authorized independently by an owner and tests recipient/value/objective substitutions against an on-chain vault. It does not claim universal tool protection. |
| PurpleCrew and Microsoft PyRIT | PurpleCrew describes coordinated red/blue/operations agents and security tools. PyRIT provides automated adversarial assessment of generative systems. | Specialized investigators, attack generation, replay/evaluation, structured reports. | Roles and adversarial testing are established techniques. The proposed integration adds a financially authoritative mandate and exact transaction evidence; a multi-agent diagram is not an originality argument. |

Sources for this table:

- [OneSource Aegis product](https://onesource.io/solutions/aegis), [engineering announcement](https://onesource.io/blog/project-aegis-ai-agent-guardrails-onesource), [Project Aegis](https://projectaegis.ai/).
- [OutLayer product](https://outlayer.ai/), [agent custody documentation](https://app.outlayer.ai/docs/agent-custody).
- [Turnkey agent wallets](https://www.turnkey.com/solutions/ai-agents), [policy semantics](https://docs.turnkey.com/features/policies/overview).
- [Sardis product](https://www.sardis.sh/), [wallet documentation](https://docs.sardis.sh/docs/wallets), [FAQ](https://docs.sardis.sh/docs/faq).
- [AEGIS paper](https://arxiv.org/abs/2603.12621), [author repository](https://github.com/Justin0504/Aegis).
- [PurpleCrew author repository](https://github.com/Vjeroen/PurpleCrew), [Microsoft PyRIT](https://github.com/microsoft/PyRIT), [Microsoft red-teaming integration](https://devblogs.microsoft.com/foundry/assess-agentic-risks-with-the-ai-red-teaming-agent-in-microsoft-foundry/).

## Proposed contribution

AEGIS // Counterfactual is intended as a reproducible integration of five components:

1. The owner sets a business authorization independently of invoice text and the spending agent.
2. The same authorization is held constant while reference and attacker-modified inputs are replayed.
3. Specialist findings explain attempted trust-boundary crossings; deterministic checks decide eligibility.
4. Evidence hashes bind the exact proposed transaction and replay bundle, and a separately credentialed verifier recomputes them.
5. A native NEAR vault rechecks authorization at execution and reconciles asynchronous transfer outcomes.

This is an integration claim to be supported by executable evidence, not a claim of first invention. The intended result is a small demonstration a reviewer can rerun, alter, and falsify. None of these components individually is asserted to be novel.

## Claims we can and cannot make

Acceptable after the corresponding test has actually passed: “In fixture X, attacker-controlled invoice text changed the proposal; the implemented contract rejected the altered recipient/value against mandate Y. The legitimate payment and its evidence were verified separately.”

Unjustified: “first AI wallet firewall,” “unhackable,” “mathematical proof of safe AI,” “no competitor has counterfactual verification,” “decentralized verifier,” or “TEE-secured.” A locally separate process is an operational separation on one host, not an independent security domain against host compromise.

The working brand is deliberately configurable. Other unrelated Aegis-named security and wallet systems exist; the shared name does not imply affiliation, compatibility, endorsement, or ownership of their work.

## Evidence and comparison limitations

- No competitor deployment was exercised and no unpublished capability was inferred absent.
- The AEGIS arXiv abstract inspected in this review still shows its March 2026 version. Its author repository says initial metrics were withdrawn and describes an October revision. We therefore omit those performance figures and make no comparative benchmark claim until a versioned, reproducible artifact is reviewed.
- Sardis pages differ in chain-availability descriptions and characterize custody using vendor terminology. We report their published policy/payment approach without relying on chain counts or independently endorsing the cryptographic implementation.
- A claim that our receipt is meaningful requires independent recomputation, not a JSON schema check. A chain-approved receipt establishes the recorded contract decision, not truth of an AI investigator's prose.
- Synthetic fixtures measure behavior for their own cases. They do not establish field detection rates, universal injection resistance, or comparative production security.
- Revisit this analysis before any public originality claim. Cite versions/commits when used in a submission, and disclose borrowed libraries and templates.
