"""Receipts must fail loudly when tampered with, and every lab scenario must match."""
import copy
import json

import pytest

from aegis import fixtures, lab
from aegis.canonical import verify_merkle_proof
from aegis.receipts import get_evidence, hash_receipt, verify_receipt


@pytest.fixture(scope="module")
def blocked_run():
    return lab.run_scenario("02")


def rehash(receipt: dict) -> dict:
    receipt["receipt_hash"] = hash_receipt(receipt)
    return receipt


def test_generated_receipt_verifies_with_separate_verdicts(blocked_run):
    result = verify_receipt(blocked_run["receipt"])
    assert result["errors"] == []
    assert result["integrity"] == "INTEGRITY VERIFIED"
    assert result["policy"] == "POLICY VERIFIED"
    assert result["on_chain"] == "NOT CHECKED"
    assert result["ai_analysis"] == "ANALYSIS ADVISORY"
    assert result["decision"] == "BLOCK"


@pytest.mark.parametrize("field,value", [
    ("final_decision", "ALLOW"),
    ("intent_hash", "00" * 32),
    ("attestor_id", "agent.aegis-demo.testnet"),
    ("policy_version", "2"),
])
def test_tampered_top_level_fields_are_rejected(blocked_run, field, value):
    receipt = copy.deepcopy(blocked_run["receipt"])
    receipt[field] = value
    assert verify_receipt(rehash(receipt))["errors"]


def test_tampered_intent_amount_is_rejected(blocked_run):
    receipt = copy.deepcopy(blocked_run["receipt"])
    receipt["intent"]["amount"] = "50000000000000000000000"
    assert any("intent hash" in e for e in verify_receipt(rehash(receipt))["errors"])


def test_tampered_evidence_breaks_the_merkle_root(blocked_run):
    receipt = copy.deepcopy(blocked_run["receipt"])
    receipt["evidence"]["findings"][0]["severity"] = "info"
    errors = verify_receipt(rehash(receipt))["errors"]
    assert any("Merkle" in e for e in errors)


def test_unrehashed_tampering_breaks_the_receipt_hash(blocked_run):
    receipt = copy.deepcopy(blocked_run["receipt"])
    receipt["expiration"] = "1"
    assert any("receipt hash" in e for e in verify_receipt(receipt)["errors"])


def test_malformed_receipt_fails_closed():
    assert verify_receipt({"receipt_version": "aegis.cvr/1"})["decision"] == "BLOCK"
    assert verify_receipt(json.loads("{}"))["integrity"] == "INTEGRITY FAILED"


def test_evidence_sections_can_be_disclosed_with_merkle_proofs(blocked_run):
    section = get_evidence(blocked_run["receipt"], "snapshot")
    assert verify_merkle_proof(section["leaf"], section["proof"], section["root"])


def test_self_consistent_forgery_is_caught_only_by_authoritative_state():
    run = lab.run_scenario("20")
    naive, sophisticated = run["extras"]["tamper_checks"]
    assert naive["policy"] == "POLICY FAILED"
    assert sophisticated["integrity"] == "INTEGRITY VERIFIED" and sophisticated["policy"] == "POLICY VERIFIED"
    assert "AUTHORIZATION_RECIPIENT" in sophisticated["authoritative_violations"]


@pytest.mark.parametrize("scenario", [d["id"] for d in fixtures.scenarios()])
def test_every_scenario_matches_its_expected_outcome(scenario):
    run = lab.run_scenario(scenario)
    assert run["matches_expected"], (run["decision"], run["outcome"], run["missing_key_invariants"])
    assert run["verification"]["errors"] == []
    assert run["baseline"]["funds_moved"] is False


def test_benchmark_reports_no_unexpected_outcomes():
    summary = lab.summarize([lab.run_scenario(d["id"]) for d in fixtures.scenarios()])
    assert summary["total"] == 23
    assert summary["unexpected_approvals"] == 0 and summary["unexpected_rejections"] == 0
    assert summary["baseline_comparison"]["aegis_harmful_transfers"] == 0
    assert summary["baseline_comparison"]["unprotected_agent_harmful_transfers"] > 0


def test_shipped_example_receipts_verify():
    root = fixtures.ROOT / "examples/receipts"
    files = sorted(root.glob("*.json"))
    assert files
    for file in files:
        assert verify_receipt(json.loads(file.read_text(encoding="utf-8")))["errors"] == [], file.name
