"""Counterfactual Verification Receipts (CVR): generate, hash, verify, export.

A CVR binds one exact intent (by canonical Borsh hash) to the evidence that was reviewed:
the authoritative snapshot, the reference and adversarial run traces, the counterfactual
variations, the swarm findings, and provenance. The evidence is committed with a Merkle
root; that root is what the attestor writes on-chain next to its approve/deny decision.

Verification recomputes everything that is deterministic and reports four separate
verdicts. Well-formed JSON alone is never reported as verified.

* INTEGRITY — every hash, the Merkle root and every field binding recompute.
* POLICY — the recorded checks, trace verdicts, variations and final decision equal a
  fresh evaluation against the recorded snapshot (and, if supplied, a live one).
* ON-CHAIN — only checked by `chain.verify_onchain` / `aegis verify --network`.
* AI ANALYSIS — always UNVERIFIED: findings are explanations, not proofs.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from . import policy as rules
from .canonical import digest, fingerprint, intent_hash, leaf_hash, merkle_proof, merkle_root
from .models import Check, Finding, Intent, Receipt, RunTrace, Snapshot, Variation

SECTIONS = ("snapshot", "reference", "adversarial", "variations", "findings", "provenance")


def evidence_leaves(evidence: dict) -> list[str]:
    return [leaf_hash(name, evidence[name]) for name in SECTIONS]


def decide(intent: Intent, snapshot: Snapshot, complete: bool) -> str:
    return "ALLOW" if complete and rules.allowed(intent, snapshot) else "BLOCK"


def hash_receipt(receipt: Receipt | dict) -> str:
    data = receipt.model_dump() if isinstance(receipt, Receipt) else dict(receipt)
    data.pop("receipt_hash", None)
    return digest(data)


def generate_receipt(*, snapshot: Snapshot, reference: RunTrace, adversarial: RunTrace, variations: list[Variation],
                     findings: list[Finding], provenance: dict, test_ids: list[str],
                     execution_mode: str = "LOCAL_SIMULATION") -> Receipt:
    intent = adversarial.proposal.intent
    complete = bool(provenance.get("complete"))
    evidence = {
        "snapshot": snapshot.model_dump(),
        "reference": reference.model_dump(),
        "adversarial": adversarial.model_dump(),
        "variations": [v.model_dump() for v in variations],
        "findings": [f.model_dump() for f in findings],
        "provenance": provenance,
    }
    body = {
        "receipt_version": "aegis.cvr/1",
        "intent_hash": intent_hash(intent),
        "intent": intent.model_dump(),
        "authorization_id": intent.authorization_id,
        "policy_version": intent.policy_version,
        "invoice_fingerprint": intent.invoice_fingerprint,
        "agent_id": intent.agent_id,
        "evaluation_timestamp": snapshot.now_ms,
        "expiration": intent.expires_at_ms,
        "adversarial_test_ids": test_ids,
        "reference_run_hash": digest(evidence["reference"]),
        "adversarial_run_hash": digest(evidence["adversarial"]),
        "security_findings": evidence["findings"],
        "deterministic_policy_results": [c.model_dump() for c in rules.checks(intent, snapshot)],
        "attestor_id": snapshot.attestor_id,
        "evidence_merkle_root_or_hash": merkle_root(evidence_leaves(evidence)),
        "final_decision": decide(intent, snapshot, complete),
        "attestation_transaction_hash": None,
        "execution_mode": execution_mode,
        "inference_mode": provenance.get("inference_mode", "OFFLINE_HEURISTIC"),
        "evidence": evidence,
    }
    body["receipt_hash"] = digest(body)
    return Receipt.model_validate(body)


def with_attestation(receipt: Receipt, transaction_hash: str | None, execution_mode: str) -> Receipt:
    data = receipt.model_dump() | {"attestation_transaction_hash": transaction_hash, "execution_mode": execution_mode}
    data["receipt_hash"] = hash_receipt(data)
    return Receipt.model_validate(data)


def _trace_errors(name: str, trace: RunTrace, snapshot: Snapshot) -> list[str]:
    errors = []
    intent = trace.proposal.intent
    found = rules.violations(intent, snapshot)
    if trace.violations != found:
        errors.append(f"{name}: recorded violations do not match a fresh evaluation")
    if [c.model_dump() for c in trace.policy_results] != [c.model_dump() for c in rules.checks(intent, snapshot)]:
        errors.append(f"{name}: recorded policy results do not recompute")
    if trace.execution_eligible is not (not found):
        errors.append(f"{name}: eligibility does not follow from the violations")
    if found and trace.simulation_result == "EXECUTED":
        errors.append(f"{name}: a violating proposal is recorded as executed")
    if trace.intent_hash != intent_hash(intent):
        errors.append(f"{name}: trace intent hash does not recompute")
    if trace.context_digest != digest(trace.context.model_dump()):
        errors.append(f"{name}: input context digest does not recompute")
    if intent.invoice_fingerprint != fingerprint(trace.context.invoice):
        errors.append(f"{name}: proposal fingerprint is not the fingerprint of the invoice the agent read")
    return errors


def verify_receipt(data: dict | Receipt, trusted_snapshot: Snapshot | None = None) -> dict[str, Any]:
    integrity: list[str] = []
    policy_errors: list[str] = []
    try:
        r = data if isinstance(data, Receipt) else Receipt.model_validate(data)
        e = r.evidence
        missing = [s for s in SECTIONS if s not in e]
        if missing:
            raise ValueError("Evidence is missing sections: " + ", ".join(missing))
        snapshot = Snapshot.model_validate(e["snapshot"])
        reference = RunTrace.model_validate(e["reference"])
        adversarial = RunTrace.model_validate(e["adversarial"])
        variations = [Variation.model_validate(v) for v in e["variations"]]
        findings = [Finding.model_validate(f) for f in e["findings"]]
        provenance = e["provenance"]
        if not isinstance(provenance, dict):
            raise ValueError("Provenance must be an object")

        def bind(ok: bool, label: str) -> None:
            if not ok:
                integrity.append(label)

        bind(r.receipt_hash == hash_receipt(r), "receipt hash does not recompute")
        bind(r.intent_hash == intent_hash(r.intent), "canonical intent hash does not recompute")
        bind(r.evidence_merkle_root_or_hash == merkle_root(evidence_leaves(e)), "evidence Merkle root does not recompute")
        bind(r.reference_run_hash == digest(e["reference"]), "reference run hash does not recompute")
        bind(r.adversarial_run_hash == digest(e["adversarial"]), "adversarial run hash does not recompute")
        bind(adversarial.proposal.intent == r.intent, "reviewed intent is not the adversarial trace's proposal")
        bind(r.authorization_id == r.intent.authorization_id, "authorization binding")
        bind(r.policy_version == r.intent.policy_version, "policy version binding")
        bind(r.invoice_fingerprint == r.intent.invoice_fingerprint, "invoice fingerprint binding")
        bind(r.agent_id == r.intent.agent_id, "agent binding")
        bind(r.expiration == r.intent.expires_at_ms, "expiration binding")
        bind(r.evaluation_timestamp == snapshot.now_ms, "evaluation timestamp binding")
        bind(r.attestor_id == snapshot.attestor_id, "attestor binding")
        bind([f.model_dump() for f in r.security_findings] == e["findings"], "findings binding")
        bind(r.inference_mode == provenance.get("inference_mode"), "inference mode binding")
        bind(all(v.id in r.adversarial_test_ids for v in variations), "every variation must be listed in adversarial_test_ids")
        if snapshot.authorization is not None:
            bind(fingerprint(reference.context.invoice) == snapshot.authorization.invoice_fingerprint,
                 "reference input is not the owner-authorized invoice")

        policy_errors += _trace_errors("reference", reference, snapshot)
        policy_errors += _trace_errors("adversarial", adversarial, snapshot)
        recomputed = [c.model_dump() for c in rules.checks(r.intent, snapshot)]
        if [c.model_dump() for c in r.deterministic_policy_results] != recomputed:
            policy_errors.append("deterministic policy results do not recompute")
        for v in variations:
            found = rules.violations(v.proposal, snapshot)
            if v.violations != found or v.eligible is not (not found):
                policy_errors.append(f"variation {v.id} does not recompute")
        expected = decide(r.intent, snapshot, bool(provenance.get("complete")))
        if r.final_decision != expected:
            policy_errors.append(f"final decision {r.final_decision} does not follow from the evidence (expected {expected})")

        authoritative = None
        if trusted_snapshot is not None:
            authoritative = rules.violations(r.intent, trusted_snapshot)
        errors = integrity + policy_errors
        return {
            "integrity": "INTEGRITY VERIFIED" if not integrity else "INTEGRITY FAILED",
            "policy": "POLICY VERIFIED" if not policy_errors else "POLICY FAILED",
            "on_chain": "NOT CHECKED",
            "ai_analysis": "AI ANALYSIS UNVERIFIED",
            "decision": expected if not errors else "BLOCK",
            "recorded_decision": r.final_decision,
            "intent_hash": r.intent_hash,
            "authoritative_violations": authoritative,
            "authoritative_policy_allowed": None if authoritative is None else (not authoritative and not errors and bool(provenance.get("complete"))),
            "scope": "Recomputed from the receipt's recorded snapshot. Hashes do not authenticate the snapshot itself; use --network to compare against live chain state.",
            "errors": errors,
        }
    except (ValidationError, ValueError, KeyError, TypeError) as exc:
        message = str(exc).splitlines()[0][:300]
        return {"integrity": "INTEGRITY FAILED", "policy": "POLICY FAILED", "on_chain": "NOT CHECKED",
                "ai_analysis": "AI ANALYSIS UNVERIFIED", "decision": "BLOCK", "errors": [f"malformed receipt: {message}"]}


def get_evidence(receipt: dict | Receipt, section: str | None = None) -> Any:
    r = receipt if isinstance(receipt, Receipt) else Receipt.model_validate(receipt)
    if section is None:
        return r.evidence
    if section not in SECTIONS:
        raise KeyError(section)
    leaves = evidence_leaves(r.evidence)
    index = SECTIONS.index(section)
    return {"section": section, "value": r.evidence[section], "leaf": leaves[index],
            "proof": merkle_proof(leaves, index), "root": r.evidence_merkle_root_or_hash}


def export_evidence(receipt: dict | Receipt, path: str | Path) -> Path:
    data = receipt.model_dump() if isinstance(receipt, Receipt) else receipt
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target


# Spec-compatible aliases.
generateReceipt = generate_receipt
verifyReceipt = verify_receipt
hashReceipt = hash_receipt
getEvidence = get_evidence
exportEvidence = export_evidence
__all__ = ["generate_receipt", "verify_receipt", "hash_receipt", "get_evidence", "export_evidence", "with_attestation", "Check"]
