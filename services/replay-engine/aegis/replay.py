"""Counterfactual replay engine.

REFERENCE: what the agent proposes from the owner-authorized input.
ADVERSARIAL: what it proposes from attacker-controlled input (or, in the live pipeline,
the intent it actually submitted).

Both are evaluated against the same immutable owner mandate and replayed through a
LocalVault twin, step by step, including a deliberately *compromised* attestor that tries
to approve regardless — showing which contract invariant stops it. No money moves here:
lifecycle steps are LOCAL_SIMULATION evidence. Real enforcement happens on testnet.
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field

from . import policy as rules
from .agent import IntentTemplate
from .canonical import digest, intent_hash
from .localvault import LocalVault, VaultError
from .models import AgentContext, Finding, LifecycleStep, Proposal, Receipt, RunTrace, Snapshot, Variation
from .providers import ModelClient, ModelUnavailable
from .receipts import generate_receipt
from .swarm import FraudInvestigator, InjectionInvestigator, RedTeamAgent

SIMULATED_EVIDENCE = hashlib.sha256(b"aegis.simulated-evidence").hexdigest()


def vault_from_snapshot(snap: Snapshot) -> LocalVault:
    """A LocalVault twin of the authoritative state a proposal is judged against."""
    day = str(int(snap.now_ms) // 86_400_000)
    state = {
        "vault_id": snap.vault_id, "owner_id": snap.owner_id, "agent_id": snap.agent_id, "attestor_id": snap.attestor_id,
        "agent_generation": 0, "attestor_generation": 0, "paused": snap.paused, "policy": snap.policy.model_dump(),
        "authorizations": {}, "intents": {}, "intent_index": [],
        "agent_nonces": {snap.agent_id: int(snap.agent_nonce)} if snap.agent_id else {},
        "daily_budgets": {day: snap.daily_budget.model_dump()}, "intent_quota": [0, 0], "reserved": "0",
        "pending_transfers": 0, "audit": [], "audit_count": 0,
        "balance": str(int(snap.available_balance or 10**24) + 3 * 10**22 + 5 * 10**22), "failing_recipients": [], "transfers": [],
    }
    if snap.authorization is not None:
        state["authorizations"][snap.authorization.id] = {
            "authorization": snap.authorization.model_dump(), "budget": snap.authorization_budget.model_dump(), "created_at_ms": "0",
        }
    now = int(snap.now_ms)
    return LocalVault(state, lambda: now)


def simulate_lifecycle(intent, vault: LocalVault) -> tuple[list[LifecycleStep], str]:
    """submit → (compromised attestor tries to approve) → honest attestor → execute."""
    s = vault.state
    agent, attestor = intent.agent_id, s["attestor_id"]
    steps: list[LifecycleStep] = []
    try:
        h = vault.submit_intent(agent, intent)
        steps.append(LifecycleStep(step="submit_intent", actor="AGENT", outcome="ACCEPTED", detail="Proposal recorded as PROPOSED evidence."))
    except VaultError as exc:
        steps.append(LifecycleStep(step="submit_intent", actor="AGENT", outcome="REJECTED", codes=exc.codes, detail=exc.message))
        return steps, "BLOCKED"
    found = vault.violations(intent)
    if found:
        forced = vault.fork()
        try:
            forced.attest_intent(attestor, h, SIMULATED_EVIDENCE, True)
            steps.append(LifecycleStep(step="attest_intent(approved=true)", actor="COMPROMISED_ATTESTOR", outcome="APPROVED", detail="UNEXPECTED: forced approval accepted."))
        except VaultError as exc:
            steps.append(LifecycleStep(step="attest_intent(approved=true)", actor="COMPROMISED_ATTESTOR", outcome="REJECTED", codes=exc.codes,
                                       detail="Even an attestor that tries to approve is stopped by the contract's own re-check."))
        vault.attest_intent(attestor, h, SIMULATED_EVIDENCE, False)
        steps.append(LifecycleStep(step="attest_intent(approved=false)", actor="ATTESTOR", outcome="DENIED", codes=found, detail="Independent attestor denies and commits the evidence hash."))
        try:
            vault.execute_intent(agent, h)
            steps.append(LifecycleStep(step="execute_intent", actor="AGENT", outcome="EXECUTED", detail="UNEXPECTED"))
            return steps, "EXECUTED"
        except VaultError as exc:
            steps.append(LifecycleStep(step="execute_intent", actor="AGENT", outcome="REJECTED", codes=exc.codes, detail="The agent insists on executing; the vault refuses."))
        return steps, "BLOCKED"
    vault.attest_intent(attestor, h, SIMULATED_EVIDENCE, True)
    steps.append(LifecycleStep(step="attest_intent(approved=true)", actor="ATTESTOR", outcome="APPROVED", detail="Every invariant passes; approval binds the exact intent hash."))
    try:
        ok = vault.execute_and_settle(agent, h)
    except VaultError as exc:
        steps.append(LifecycleStep(step="execute_intent", actor="AGENT", outcome="REJECTED", codes=exc.codes, detail=exc.message))
        return steps, "BLOCKED"
    steps.append(LifecycleStep(step="execute_intent → on_execution_complete", actor="VAULT", outcome="EXECUTED" if ok else "FAILED",
                               detail="Budget reserved, transfer dispatched and settled." if ok else "Transfer failed; reservation released."))
    return steps, "EXECUTED" if ok else "FAILED"


def build_trace(label: str, ctx: AgentContext, proposal: Proposal, snap: Snapshot, steps: list[LifecycleStep], result: str) -> RunTrace:
    intent = proposal.intent
    found = rules.violations(intent, snap)
    return RunTrace(label=label, context_digest=digest(ctx.model_dump()), context=ctx, proposal=proposal, intent_hash=intent_hash(intent),
                    policy_results=rules.checks(intent, snap), violations=found, execution_eligible=not found, lifecycle=steps,
                    simulation_result=result)


@dataclass
class Review:
    receipt: Receipt
    reference: RunTrace
    adversarial: RunTrace
    variations: list[Variation]
    findings: list[Finding]
    events: list[dict] = field(default_factory=list)
    model_calls: int = 0
    model_latency_ms: float = 0.0
    model_error: str | None = None


def review(*, reference_ctx: AgentContext, adversarial_ctx: AgentContext, template: IntentTemplate, snapshot: Snapshot, agent,
           attacker: str, test_ids: list[str], adversarial_proposal: Proposal | None = None,
           lifecycles: dict[str, tuple[list[LifecycleStep], str]] | None = None, use_model: bool = False,
           complete: bool = True, extra_provenance: dict | None = None, execution_mode: str = "LOCAL_SIMULATION") -> Review:
    started = time.perf_counter()
    events: list[dict] = []

    def event(stage: str, actor: str, detail: str) -> None:
        events.append({"stage": stage, "actor": actor, "detail": detail, "elapsed_ms": round((time.perf_counter() - started) * 1000, 3)})

    client = ModelClient() if use_model else None
    inference = "REAL_LLM_INFERENCE" if use_model else "OFFLINE_HEURISTIC"
    model_error = None
    reference = agent.propose(reference_ctx, template)
    event("reference", "AGENT", f"Agent read the authorized invoice and proposed {reference.intent.recipient} / {reference.intent.amount} yocto")
    adversarial = adversarial_proposal or agent.propose(adversarial_ctx, template)
    event("adversarial", "AGENT", f"Agent read the adversarial input and proposed {adversarial.intent.recipient} / {adversarial.intent.amount} yocto")

    findings: list[Finding] = []
    variations: list[Variation] = []
    red = RedTeamAgent()
    try:
        findings += InjectionInvestigator().investigate(reference_ctx, adversarial_ctx, reference, adversarial, client)
        event("injection", "INJECTION_INVESTIGATOR", f"{sum(f.role == 'injection' for f in findings)} findings")
        findings += FraudInvestigator().investigate(adversarial, snapshot, reference, client)
        event("fraud", "FRAUD_INVESTIGATOR", f"{sum(f.role == 'fraud' for f in findings)} findings")
        variations = red.field_variations(reference.intent, snapshot, attacker) + red.input_variations(reference_ctx, reference, template, snapshot, client)
        findings += red.investigate(variations, not rules.violations(reference.intent, snapshot))
        event("redteam", "RED_TEAM", f"{len(variations)} counterfactual variations replayed")
    except ModelUnavailable as exc:
        complete, inference, model_error = False, "MODEL_FAILED_CLOSED", str(exc)
        event("model_failure", "MODEL", model_error + " — evidence marked incomplete; decision fails closed")

    lifecycles = lifecycles or {}
    traces = {}
    for label, ctx, proposal in (("reference", reference_ctx, reference), ("adversarial", adversarial_ctx, adversarial)):
        steps, result = lifecycles.get(label) or simulate_lifecycle(proposal.intent, vault_from_snapshot(snapshot))
        traces[label] = build_trace(label, ctx, proposal, snapshot, steps, result)
    event("replay", "REPLAY_ENGINE", "Reference and adversarial twins replayed against the same immutable mandate")

    provenance = {"inference_mode": inference, "agent_mode": adversarial.mode, "complete": complete, "model_error": model_error,
                  "model_calls": client.calls if client else 0, "execution_mode": execution_mode, "generator": "aegis.replay/1",
                  **(extra_provenance or {})}
    ids = list(dict.fromkeys(test_ids + [v.id for v in variations]))
    receipt = generate_receipt(snapshot=snapshot, reference=traces["reference"], adversarial=traces["adversarial"], variations=variations,
                               findings=findings, provenance=provenance, test_ids=ids, execution_mode=execution_mode)
    event("receipt", "REPLAY_ENGINE", f"CVR {receipt.receipt_hash[:12]}… evidence root {receipt.evidence_merkle_root_or_hash[:12]}…")
    event("verdict", "POLICY", f"{receipt.final_decision}: " + (", ".join(traces["adversarial"].violations) or "all invariants pass"))
    return Review(receipt=receipt, reference=traces["reference"], adversarial=traces["adversarial"], variations=variations, findings=findings,
                  events=events, model_calls=client.calls if client else 0, model_latency_ms=client.latency_ms if client else 0.0, model_error=model_error)
