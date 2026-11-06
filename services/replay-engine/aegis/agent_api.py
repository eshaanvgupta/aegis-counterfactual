"""Agent service (separate process; key: AGENT function-call key only).

Hosts the untrusted transaction agent, the security swarm, the counterfactual replay
engine and the attack lab, and orchestrates the end-to-end pipeline. It can submit and
execute intents; it cannot approve them (only the verifier can) and it cannot change any
mandate or policy (only the owner can).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException
from pydantic import Field

from . import fixtures, lab, store
from .agent import IntentTemplate, ModelUnavailable, make_agent
from .backend import ROOT, get_backend, mode, reference_invoice_for
from .canonical import intent_hash
from .models import AgentContext, Intent, Message, Receipt, Strict, ToolResult
from .receipts import verify_receipt
from .replay import review
from .web import create_app, forbid_foreign_keys

ARTIFACTS = ROOT / "artifacts"


def startup() -> None:
    os.environ.setdefault("AEGIS_ROLE", "AGENT")
    if os.environ["AEGIS_ROLE"] != "AGENT":
        raise RuntimeError("agent-api must run as AGENT")
    forbid_foreign_keys("AGENT")
    store.list_runs(1)  # create schema


app = create_app("AEGIS agent service", "agent-api", startup=startup)


def _artifact(name: str):
    path = ARTIFACTS / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _ledger(limit: int = 25) -> list[dict]:
    path = Path(os.getenv("AEGIS_CHAIN_LEDGER", str(ROOT / "runtime/chain-ledger.jsonl")))
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").strip().splitlines()[-limit:]
    return [json.loads(line) for line in reversed(lines) if line.strip()]


@app.get("/system/health")
def health() -> dict:
    provider = os.getenv("LLM_PROVIDER", "offline")
    return {"service": "agent-api", "status": "ok", "mode": mode(), "principal": "AGENT",
            "inference": "OFFLINE_HEURISTIC" if provider == "offline" else f"MODEL:{provider}/{os.getenv('LLM_MODEL', '')}",
            "brand": os.getenv("AEGIS_BRAND", "AEGIS // COUNTERFACTUAL"), "time_ms": int(time.time() * 1000)}


@app.get("/system/ready")
def ready() -> dict:
    """Readiness probe: the service can reach its authoritative vault backend."""
    try:
        status = get_backend().status()
        store.list_runs(1)
    except Exception as exc:  # noqa: BLE001 - a failed dependency keeps the instance out of rotation
        raise HTTPException(503, f"Vault backend not ready: {str(exc)[:240]}") from None
    return {"service": "agent-api", "status": "ready", "mode": mode(), "vault_id": status.get("vault_id")}


@app.get("/vault/status")
def vault_status() -> dict:
    backend = get_backend()
    runs = store.list_runs(200)
    pipelines = store.list_pipelines(50)
    data: dict[str, Any] = {"mode": mode(), "principals": backend.principals(), "chain": None, "chain_error": None}
    try:
        data["chain"] = backend.status()
        data["policy"] = backend.policy().model_dump()
        data["authorizations"] = backend.authorizations()
        data["recent_intents"] = backend.recent_intents(12)
        data["recent_audit"] = backend.recent_audit(15)
    except Exception as exc:  # noqa: BLE001 - surfaced to the UI, never treated as approval
        data["chain_error"] = str(exc)[:300]
    data["ledger"] = _ledger()
    data["stats"] = {
        "lab_runs": len(runs),
        "lab_blocked": sum(r["decision"] == "BLOCK" for r in runs),
        "pipelines": len(pipelines),
        "pipelines_executed": sum(p.get("final_status") == "EXECUTED" for p in pipelines),
        "pipelines_blocked": sum(p.get("decision") == "BLOCK" for p in pipelines),
    }
    data["deployment"] = _artifact("testnet-deployment.json")
    data["testnet_evidence"] = _artifact("testnet-evidence.json")
    return data


@app.get("/authorizations")
def authorizations() -> list[dict]:
    return get_backend().authorizations()


@app.get("/authorizations/{authorization_id}")
def authorization(authorization_id: str) -> dict:
    found = get_backend().authorization(authorization_id)
    if not found:
        raise HTTPException(404, "Authorization not found")
    return found


@app.get("/policy")
def policy() -> dict:
    return get_backend().policy().model_dump()


@app.get("/intents")
def intents(limit: int = 20) -> list[dict]:
    return get_backend().recent_intents(min(limit, 50))


@app.get("/intents/{h}")
def intent(h: str) -> dict:
    record = get_backend().intent(h)
    if not record:
        raise HTTPException(404, "Intent not found")
    return record | {"evidence": store.get_receipt(h), "observations": store.observations(h)}


class ProposeRequest(Strict):
    authorization_id: str = Field(min_length=1, max_length=80)
    invoice: str = Field(min_length=1, max_length=20000)
    tool_results: list[ToolResult] = Field(default_factory=list, max_length=8)
    messages: list[Message] = Field(default_factory=list, max_length=8)
    use_model: bool = False
    execute: bool = True


def _template(mandate: dict, nonce: int | None = None) -> IntentTemplate:
    backend = get_backend()
    p = backend.principals()
    next_nonce = nonce if nonce is not None else backend.agent_nonce(p["agent"]) + 1
    expires = min(int(mandate["expires_at_ms"]), int(time.time() * 1000) + 3_600_000)
    return IntentTemplate(vault_id=p["vault"], agent_id=p["agent"], authorization_id=mandate["id"], nonce=str(next_nonce),
                          expires_at_ms=str(expires), policy_version=mandate["policy_version"])


def _verifier(path: str, payload: dict) -> tuple[int, dict]:
    url = os.getenv("AEGIS_VERIFIER_URL", "http://127.0.0.1:8001").rstrip("/")
    token = os.getenv("AEGIS_VERIFIER_TOKEN", "")
    try:
        response = httpx.post(url + path, json=payload, headers={"Authorization": f"Bearer {token}"}, timeout=180)
        return response.status_code, response.json()
    except (httpx.HTTPError, ValueError):
        return 503, {"detail": "Independent verifier unavailable; nothing was approved"}


@app.post("/agent/propose")
def propose(body: ProposeRequest) -> dict:
    """The agent reads the inputs and proposes an intent. Nothing is submitted."""
    mandate = authorization(body.authorization_id)
    ctx = AgentContext(authorization_id=body.authorization_id, objective=fixtures.demo()["objective"], invoice=body.invoice,
                       tool_results=body.tool_results, messages=body.messages)
    try:
        proposal = make_agent(body.use_model).propose(ctx, _template(mandate))
    except ModelUnavailable as exc:
        raise HTTPException(503, f"Model unavailable; failing closed: {exc}") from None
    return {"proposal": proposal.model_dump(), "intent_hash": intent_hash(proposal.intent), "context": ctx.model_dump()}


@app.post("/pipeline")
def pipeline(body: ProposeRequest) -> dict:
    """Agent proposal → on-chain proposal → swarm review + counterfactual replay → CVR →
    independent attestation → execution (the agent always insists) → settlement."""
    backend = get_backend()
    pid = uuid.uuid4().hex[:16]
    record: dict = {"id": pid, "created_at_ms": int(time.time() * 1000), "mode": mode(), "authorization_id": body.authorization_id, "steps": []}

    def step(name: str, actor: str, status: str, detail: str, chain: dict | None = None) -> None:
        record["steps"].append({"name": name, "actor": actor, "status": status, "detail": detail, "chain": chain, "at_ms": int(time.time() * 1000)})

    def finish(decision: str, final_status: str) -> dict:
        record["decision"], record["final_status"] = decision, final_status
        store.put_pipeline(pid, record)
        return record

    mandate = authorization(body.authorization_id)
    reference_text = reference_invoice_for(mandate)
    if reference_text is None:
        raise HTTPException(409, "The owner-authorized invoice text for this mandate is not registered; cannot build the reference twin")
    ctx = AgentContext(authorization_id=body.authorization_id, objective=fixtures.demo()["objective"], invoice=body.invoice,
                       tool_results=body.tool_results, messages=body.messages)
    reference_ctx = AgentContext(authorization_id=body.authorization_id, objective=ctx.objective, invoice=reference_text)
    template = _template(mandate)
    agent = make_agent(body.use_model)
    try:
        proposal = agent.propose(ctx, template)
    except (ModelUnavailable, ValueError) as exc:
        step("AGENT_PROPOSAL", "AGENT", "FAILED", f"Agent produced no proposal ({exc}); nothing submitted.")
        return finish("BLOCK", "NO_PROPOSAL")
    h = intent_hash(proposal.intent)
    record.update(intent_hash=h, context=ctx.model_dump(), proposal=proposal.model_dump())
    step("AGENT_PROPOSAL", "AGENT", "PROPOSED", f"{proposal.mode}: pay {proposal.intent.recipient} {proposal.extracted.get('amount_near')} NEAR for {proposal.intent.purpose_id}")
    store.observe("proposal", {"context": ctx.model_dump(), "proposal": proposal.model_dump()}, h)

    snapshot = backend.snapshot(body.authorization_id, proposal.intent.agent_id)
    submitted = backend.submit(proposal.intent, label=f"Agent proposes {proposal.intent.recipient}")
    step("SUBMIT_INTENT", "AGENT", "ACCEPTED" if submitted["succeeded"] else "REJECTED",
         "Recorded on-chain as PROPOSED (evidence of the attempted action)." if submitted["succeeded"] else submitted.get("failure") or "Rejected", submitted)
    if not submitted["succeeded"]:
        return finish("BLOCK", "REJECTED_AT_SUBMISSION")

    result = review(reference_ctx=reference_ctx, adversarial_ctx=ctx, template=template, snapshot=snapshot, agent=agent,
                    attacker=fixtures.demo()["attacker_account"], test_ids=[f"pipeline-{pid}"], adversarial_proposal=proposal,
                    use_model=body.use_model, execution_mode=mode())
    receipt = result.receipt
    verification = verify_receipt(receipt)
    store.put_receipt(h, receipt.model_dump(), verification)
    record.update(events=result.events, findings=[f.model_dump() for f in result.findings],
                  reference=result.reference.model_dump(), adversarial=result.adversarial.model_dump(),
                  variations=[v.model_dump() for v in result.variations])
    step("SWARM_REVIEW", "SWARM", "COMPLETE", f"{len(result.findings)} findings from 3 investigators; {len(result.variations)} counterfactual variations")
    step("RECEIPT", "REPLAY_ENGINE", receipt.final_decision, f"CVR evidence root {receipt.evidence_merkle_root_or_hash[:16]}…")

    status, attested = _verifier("/attest", {"intent_hash": h, "receipt": receipt.model_dump()})
    if status == 200:
        receipt = Receipt.model_validate(attested["receipt"])
        store.put_receipt(h, receipt.model_dump(), attested.get("verification"), attested)
        step("ATTESTATION", "ATTESTOR", "APPROVED" if attested["approved"] else "DENIED", "; ".join(attested["reasons"]), attested["chain"])
    else:
        detail = attested.get("detail", attested)
        step("ATTESTATION", "ATTESTOR", "UNAVAILABLE" if status == 503 else "REFUSED", json.dumps(detail)[:400])
    record["receipt"] = receipt.model_dump()
    record["verification"] = verification

    if body.execute:
        executed = backend.execute(h, label="Agent executes" + (" (insisting after denial)" if status != 200 or not attested.get("approved") else ""))
        step("EXECUTION", "AGENT", "EXECUTED" if executed["succeeded"] else "REJECTED", executed.get("failure") or "Transfer dispatched; settled by the private callback.", executed)
    final = backend.intent(h) or {}
    record["final_intent"] = final
    final_status = final.get("status", "UNKNOWN")
    return finish("ALLOW" if final_status in ("EXECUTED", "ATTESTED") else "BLOCK", final_status)


class SubmitRequest(Strict):
    intent: Intent
    context: AgentContext | None = None


@app.post("/intents")
def submit(body: SubmitRequest) -> dict:
    """Submit an exact intent (the agent's step). Proposals that violate the mandate are
    still recorded on-chain as evidence; they can never execute without attestation."""
    h = intent_hash(body.intent)
    if body.context:
        store.observe("proposal", {"context": body.context.model_dump(), "intent": body.intent.model_dump()}, h)
    outcome = get_backend().submit(body.intent, label=f"Agent proposes {body.intent.recipient}")
    return {"intent_hash": h, "chain": outcome}


class ReviewRequest(Strict):
    context: AgentContext
    use_model: bool = False


@app.post("/intents/{h}/review")
def review_intent(h: str, body: ReviewRequest) -> dict:
    """Run the swarm and counterfactual replay for a submitted intent; returns the CVR."""
    backend = get_backend()
    record = backend.intent(h)
    if not record:
        raise HTTPException(404, "Intent not found on the vault")
    proposed = Intent(**record["intent"])
    mandate = authorization(proposed.authorization_id)
    reference_text = reference_invoice_for(mandate)
    if reference_text is None:
        raise HTTPException(409, "Owner-authorized invoice text is not registered for this mandate")
    agent = make_agent(body.use_model)
    reference_ctx = AgentContext(authorization_id=mandate["id"], objective=body.context.objective, invoice=reference_text)
    adversarial = agent.propose(body.context, _template(mandate, int(proposed.nonce)))
    if adversarial.intent != proposed:
        adversarial = adversarial.model_copy(update={"intent": proposed, "notes": adversarial.notes + ["Submitted intent differs from a fresh replay of the recorded input; the submitted intent is reviewed."]})
    snapshot = backend.snapshot(proposed.authorization_id, proposed.agent_id)
    result = review(reference_ctx=reference_ctx, adversarial_ctx=body.context, template=_template(mandate, int(proposed.nonce)), snapshot=snapshot,
                    agent=agent, attacker=fixtures.demo()["attacker_account"], test_ids=[f"intent-{h[:16]}"], adversarial_proposal=adversarial,
                    use_model=body.use_model, execution_mode=mode())
    verification = verify_receipt(result.receipt)
    store.put_receipt(h, result.receipt.model_dump(), verification)
    return {"receipt": result.receipt.model_dump(), "verification": verification, "events": result.events}


@app.post("/intents/{h}/attest")
def attest_intent(h: str) -> dict:
    """Ask the independent verifier to attest. The agent cannot attest itself."""
    stored = store.get_receipt(h)
    if not stored:
        raise HTTPException(409, "Review the intent first: no receipt recorded")
    status, reply = _verifier("/attest", {"intent_hash": h, "receipt": stored["receipt"]})
    if status != 200:
        raise HTTPException(status, reply.get("detail", reply))
    store.put_receipt(h, reply["receipt"], reply.get("verification"), reply)
    return reply


@app.post("/intents/{h}/execute")
def execute_intent(h: str) -> dict:
    return {"intent_hash": h, "chain": get_backend().execute(h, label=f"Agent executes {h[:12]}")}


@app.get("/pipeline")
def pipelines(limit: int = 20) -> list[dict]:
    return store.list_pipelines(min(limit, 50))


@app.get("/pipeline/{pipeline_id}")
def pipeline_result(pipeline_id: str) -> dict:
    found = store.get_pipeline(pipeline_id)
    if not found:
        raise HTTPException(404, "Pipeline run not found")
    return found


@app.get("/intents/{h}/evidence")
def evidence(h: str) -> dict:
    found = store.get_receipt(h)
    if not found:
        raise HTTPException(404, "No receipt recorded for this intent")
    return found


@app.post("/receipts/verify")
def verify(receipt: dict) -> dict:
    return verify_receipt(receipt)


@app.get("/lab/scenarios")
def scenarios() -> list[dict]:
    return lab.scenario_list()


class RunRequest(Strict):
    request_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    use_model: bool = False


@app.post("/lab/scenarios/{scenario_id}/run")
def run_scenario(scenario_id: str, body: RunRequest) -> dict:
    existing = store.get_run(body.request_id)
    if existing:
        if existing["scenario"]["id"] != scenario_id:
            raise HTTPException(409, "request_id already used for a different scenario")
        return existing
    try:
        result = lab.run_scenario(scenario_id, body.use_model)
    except ModelUnavailable as exc:
        raise HTTPException(503, f"Model unavailable; failing closed: {exc}") from None
    result = {"id": body.request_id, "created_at_ms": int(time.time() * 1000), **result}
    store.put_run(body.request_id, scenario_id, result)
    return result


@app.post("/lab/run-all")
def run_all(body: RunRequest) -> dict:
    runs = [run_scenario(d["id"], RunRequest(request_id=f"{body.request_id[:60]}-{d['id']}")) for d in fixtures.scenarios()]
    return {"mode": "OFFLINE_HEURISTIC", "execution_mode": "LOCAL_SIMULATION", **lab.summarize(runs), "runs": runs}


@app.get("/lab/runs")
def runs(limit: int = 50) -> list[dict]:
    return store.list_runs(min(limit, 200))


@app.get("/lab/runs/{run_id}")
def run_result(run_id: str) -> dict:
    found = store.get_run(run_id)
    if not found:
        raise HTTPException(404, "Run not found")
    return found


@app.get("/evidence/testnet")
def testnet_evidence() -> dict:
    return {"deployment": _artifact("testnet-deployment.json"), "evidence": _artifact("testnet-evidence.json"),
            "accounts": _artifact("testnet-accounts.json"), "ledger": _ledger(50)}


@app.get("/fixtures")
def demo_fixtures() -> dict:
    p = get_backend().principals()
    return {"reference_invoice": fixtures.reference_invoice(p["recipient"]), "attacker": fixtures.demo()["attacker_account"],
            "mandate": fixtures.demo()["mandate"], "principals": p}


_ = Intent  # re-exported for type clients
