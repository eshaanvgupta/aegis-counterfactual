"""Independent attestor service (separate process, separate key: ATTESTOR only).

It never trusts a verdict computed by the spending agent. For each request it:

1. recomputes the canonical intent hash and every receipt hash (integrity),
2. re-evaluates every deterministic check from the receipt's evidence (policy),
3. re-reads the proposal, mandate, budgets and policy from the vault itself,
4. requires the reference input to be the exact invoice the owner authorized on-chain,
5. cross-checks its own evaluation with the contract's `check_intent` view,
6. approves only if all of the above agree and the evidence is complete, then writes
   `attest_intent(intent_hash, evidence_root, approved)` for exactly that intent.

Forged or inconsistent evidence is refused without writing anything on-chain. A
well-formed receipt for a violating proposal is denied on-chain, committing its evidence.
"""
from __future__ import annotations

import os

from fastapi import Header, HTTPException

from . import store
from .backend import get_backend, mode
from .canonical import fingerprint, intent_hash
from .models import Intent, Receipt, RunTrace, Strict
from .receipts import verify_receipt, with_attestation
from .web import create_app, forbid_foreign_keys, require_token

def startup() -> None:
    os.environ.setdefault("AEGIS_ROLE", "ATTESTOR")
    if os.environ["AEGIS_ROLE"] != "ATTESTOR":
        raise RuntimeError("verifier-api must run as ATTESTOR")
    forbid_foreign_keys("ATTESTOR")


app = create_app("AEGIS independent attestor", "verifier-api", rate_per_minute=60, startup=startup)


class AttestRequest(Strict):
    intent_hash: str
    receipt: Receipt


@app.get("/system/health")
def health() -> dict:
    return {"service": "verifier-api", "status": "ok", "mode": mode(), "principal": "ATTESTOR",
            "signing_configured": bool(os.getenv("NEAR_ATTESTOR_PRIVATE_KEY")) if mode() == "TESTNET" else "LOCAL_SIMULATION"}


@app.post("/verify")
def verify(receipt: dict) -> dict:
    return verify_receipt(receipt)


def evaluate(intent_hash_value: str, receipt: Receipt) -> dict:
    """Pure decision step (no chain write). Returns approve/deny/refuse with reasons."""
    backend = get_backend()
    if intent_hash_value != receipt.intent_hash or intent_hash(receipt.intent) != intent_hash_value:
        return {"verdict": "REFUSE", "reasons": ["Intent hash does not bind the supplied receipt"]}
    local = verify_receipt(receipt)
    if local["errors"]:
        return {"verdict": "REFUSE", "reasons": local["errors"], "verification": local}
    record = backend.intent(intent_hash_value)
    if not record:
        return {"verdict": "REFUSE", "reasons": ["The vault has no record of this intent"], "verification": local}
    if record["status"] != "PROPOSED":
        return {"verdict": "REFUSE", "reasons": [f"Intent is {record['status']}, not PROPOSED"], "verification": local}
    if Intent(**record["intent"]) != receipt.intent:
        return {"verdict": "REFUSE", "reasons": ["On-chain proposal differs from the receipt's intent"], "verification": local}
    live = backend.snapshot(receipt.intent.authorization_id, receipt.intent.agent_id)
    authoritative = verify_receipt(receipt, trusted_snapshot=live)
    live_violations = authoritative["authoritative_violations"] or []
    reasons: list[str] = []
    reference = RunTrace.model_validate(receipt.evidence["reference"])
    if live.authorization is not None and fingerprint(reference.context.invoice) != live.authorization.invoice_fingerprint:
        return {"verdict": "REFUSE", "reasons": ["Reference input is not the invoice the owner authorized on-chain"], "verification": authoritative}
    recorded = dict(receipt.evidence["snapshot"]["authorization"] or {})
    current = live.authorization.model_dump() if live.authorization else {}
    recorded.pop("revoked", None)
    current.pop("revoked", None)
    if recorded != current:
        return {"verdict": "REFUSE", "reasons": ["Receipt evidence describes a different mandate than the vault holds (forged or stale evidence)"],
                "verification": authoritative}
    contract = backend.check_intent(receipt.intent)
    if sorted(contract["violations"]) != sorted(live_violations):
        return {"verdict": "REFUSE", "reasons": [f"Off-chain evaluation {live_violations} disagrees with contract check_intent {contract['violations']}"],
                "verification": authoritative, "contract_check": contract}
    complete = bool(receipt.evidence["provenance"].get("complete"))
    if live_violations:
        reasons.append("Live policy violations: " + ", ".join(live_violations))
    if not complete:
        reasons.append("Evidence incomplete (model failure or missing analysis): fail closed")
    if receipt.final_decision != "ALLOW":
        reasons.append("Receipt decision is BLOCK")
    approved = not live_violations and complete and receipt.final_decision == "ALLOW"
    return {"verdict": "APPROVE" if approved else "DENY", "reasons": reasons or ["All deterministic checks pass against live vault state"],
            "verification": authoritative, "contract_check": contract, "live_violations": live_violations}


@app.post("/attest")
def attest(body: AttestRequest, authorization: str | None = Header(default=None)) -> dict:
    require_token("AEGIS_VERIFIER_TOKEN", authorization)
    decision = evaluate(body.intent_hash, body.receipt)
    store.log_event("verifier-api", "ATTESTATION_" + decision["verdict"], {"intent_hash": body.intent_hash, "reasons": decision["reasons"]})
    if decision["verdict"] == "REFUSE":
        raise HTTPException(422, {"verdict": "REFUSE", "reasons": decision["reasons"], "verification": decision.get("verification")})
    approved = decision["verdict"] == "APPROVE"
    backend = get_backend()
    outcome = backend.attest(body.intent_hash, body.receipt.evidence_merkle_root_or_hash, approved,
                             label=("Independent attestor APPROVES" if approved else "Independent attestor DENIES") + f" {body.intent_hash[:12]}")
    if not outcome["succeeded"]:
        raise HTTPException(409, {"verdict": decision["verdict"], "reasons": decision["reasons"], "chain": outcome})
    receipt = with_attestation(body.receipt, outcome.get("transaction_hash"), "TESTNET" if mode() == "TESTNET" else "LOCAL_SIMULATION")
    return {**decision, "approved": approved, "chain": outcome, "receipt": receipt.model_dump()}
