"""Cross-implementation identity: the Python mirror must agree byte-for-byte with Rust."""
import pytest

from aegis import policy
from aegis.canonical import (canonical_json, encode_intent, fingerprint, intent_hash, leaf_hash, merkle_proof, merkle_root,
                             near_to_yocto, verify_merkle_proof, yocto_to_near)
from aegis.models import Intent, Snapshot

from .conftest import load, merge


@pytest.mark.parametrize("vector", load("canonical-vectors.json")["vectors"], ids=lambda v: v["name"])
def test_borsh_encoding_and_hash_match_rust_vectors(vector):
    assert encode_intent(vector["intent"]).hex() == vector["borsh_hex"]
    assert intent_hash(vector["intent"]) == vector["sha256"]


VECTORS = load("policy-vectors.json")


@pytest.mark.parametrize("vector", VECTORS["vectors"], ids=lambda v: v["name"])
def test_policy_mirror_matches_contract_vectors(vector):
    state = merge(VECTORS["base"], vector["patch"])
    intent = Intent(**state.pop("intent"))
    assert policy.violations(intent, Snapshot(**state)) == vector["violations"]


def test_policy_order_matches_contract():
    assert policy.ORDER == VECTORS["order"]
    assert set(policy.DESCRIPTIONS) == set(policy.ORDER)


def test_every_identity_field_changes_the_hash():
    base = VECTORS["base"]["intent"]
    for key, value in base.items():
        changed = dict(base, **{key: str(int(value) + 1) if value.isdigit() else value + "x"})
        if key == "invoice_fingerprint":
            changed[key] = "cd" * 32
        assert intent_hash(changed) != intent_hash(base), key


def test_exact_near_conversion_never_uses_floats():
    assert near_to_yocto("0.05") == "50000000000000000000000"
    assert near_to_yocto("0.000000000000000000000001") == "1"
    assert yocto_to_near("340282366920938463463374607431768211455") == "340282366920938.463463374607431768211455"
    for bad in ("1e-3", "-1", "0.0000000000000000000000001", "", ".", "1.2.3", "0x10"):
        with pytest.raises(ValueError):
            near_to_yocto(bad)


def test_canonical_json_is_sorted_compact_utf8_and_rejects_floats():
    assert canonical_json({"b": 1, "a": "₹"}) == '{"a":"₹","b":1}'.encode()
    with pytest.raises(ValueError):
        canonical_json({"amount": 0.05})


def test_merkle_proofs_verify_each_section_and_reject_tampering():
    leaves = [leaf_hash(f"s{i}", {"i": i}) for i in range(6)]
    root = merkle_root(leaves)
    for index, leaf in enumerate(leaves):
        assert verify_merkle_proof(leaf, merkle_proof(leaves, index), root)
    assert not verify_merkle_proof(leaf_hash("s0", {"i": 99}), merkle_proof(leaves, 0), root)


def test_fingerprint_is_sha256_of_exact_utf8_bytes():
    assert fingerprint("a\n") != fingerprint("a\r\n")
    assert len(fingerprint("x")) == 64


def test_submission_errors_mirror_submit_intent_order():
    state = merge(VECTORS["base"], {"agent_nonce": "5"})
    intent = Intent(**state.pop("intent"))
    snap = Snapshot(**state)
    assert policy.submission_errors(intent, snap) == ["NONCE_REPLAY"]
    paused = snap.model_copy(update={"paused": True, "agent_id": None})
    assert policy.submission_errors(intent.model_copy(update={"nonce": "6"}), paused) == ["AGENT_ONLY", "VAULT_PAUSED"]
