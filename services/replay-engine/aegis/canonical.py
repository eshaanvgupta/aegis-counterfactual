"""Deterministic encodings shared with the Rust contract and the TypeScript tooling.

* `encode_intent` / `intent_hash`: Borsh encoding of `IntentFields` and its SHA-256, the
  on-chain intent identity (vectors in packages/shared-types/canonical-vectors.json).
* `canonical_json` / `digest`: sorted-key, compact UTF-8 JSON with floats forbidden, so
  Python and TypeScript hash evidence identically.
* `merkle_root` / `merkle_proof`: the CVR evidence commitment, allowing one evidence
  section to be disclosed and checked without the others.
"""
from __future__ import annotations

import hashlib
import json
import struct
from typing import Any, Mapping

from .models import Intent

YOCTO_PER_NEAR = 10**24

_STRING_FIELDS_HEAD = ("network_id", "vault_id", "agent_id", "authorization_id", "recipient", "asset")


def _borsh_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    return struct.pack("<I", len(raw)) + raw


def encode_intent(intent: Intent | Mapping[str, Any]) -> bytes:
    """Borsh layout of the contract's `IntentFields` (field order is part of the format)."""
    data = intent.model_dump() if isinstance(intent, Intent) else dict(intent)
    out = b"".join(_borsh_string(data[f]) for f in _STRING_FIELDS_HEAD)
    out += int(data["amount"]).to_bytes(16, "little")
    out += _borsh_string(data["action"])
    for field in ("nonce", "expires_at_ms", "policy_version"):
        out += int(data[field]).to_bytes(8, "little")
    out += _borsh_string(data["invoice_fingerprint"])
    out += _borsh_string(data["purpose_id"])
    return out


def intent_hash(intent: Intent | Mapping[str, Any]) -> str:
    return hashlib.sha256(encode_intent(intent)).hexdigest()


def _reject_floats(value: Any) -> None:
    if isinstance(value, float):
        raise ValueError("Floats are not allowed in canonical evidence; use decimal strings")
    if isinstance(value, dict):
        for key, inner in value.items():
            if not isinstance(key, str):
                raise ValueError("Canonical JSON keys must be strings")
            _reject_floats(inner)
    elif isinstance(value, (list, tuple)):
        for inner in value:
            _reject_floats(inner)


def canonical_json(value: Any) -> bytes:
    _reject_floats(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def fingerprint(text: str) -> str:
    """SHA-256 of the exact UTF-8 bytes of an invoice."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def leaf_hash(name: str, value: Any) -> str:
    return hashlib.sha256(b"aegis.leaf:" + canonical_json({"name": name, "value": value})).hexdigest()


def _node(left: str, right: str) -> str:
    return hashlib.sha256(b"aegis.node:" + bytes.fromhex(left) + bytes.fromhex(right)).hexdigest()


def merkle_root(leaves: list[str]) -> str:
    """Binary Merkle root with domain-separated leaves and nodes; odd levels carry the
    last node up unchanged (no duplication, so no second-preimage ambiguity)."""
    if not leaves:
        raise ValueError("Merkle tree needs at least one leaf")
    level = list(leaves)
    while len(level) > 1:
        nxt = [_node(level[i], level[i + 1]) for i in range(0, len(level) - 1, 2)]
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt
    return level[0]


def merkle_proof(leaves: list[str], index: int) -> list[dict[str, str]]:
    proof: list[dict[str, str]] = []
    level = list(leaves)
    while len(level) > 1:
        sibling = index ^ 1
        if sibling < len(level):
            proof.append({"side": "left" if sibling < index else "right", "hash": level[sibling]})
        nxt = [_node(level[i], level[i + 1]) for i in range(0, len(level) - 1, 2)]
        if len(level) % 2:
            nxt.append(level[-1])
        level, index = nxt, index // 2
    return proof


def verify_merkle_proof(leaf: str, proof: list[dict[str, str]], root: str) -> bool:
    current = leaf
    for step in proof:
        current = _node(step["hash"], current) if step["side"] == "left" else _node(current, step["hash"])
    return current == root


def near_to_yocto(amount: str) -> str:
    """Exact decimal NEAR → yoctoNEAR string. Rejects exponents, signs and >24 decimals."""
    text = amount.strip()
    if not text or any(c not in "0123456789." for c in text) or text.count(".") > 1:
        raise ValueError(f"Invalid NEAR amount {amount!r}")
    whole, _, fraction = text.partition(".")
    if len(fraction) > 24:
        raise ValueError("NEAR amounts have at most 24 decimal places")
    if not whole and not fraction:
        raise ValueError(f"Invalid NEAR amount {amount!r}")
    value = int(whole or "0") * YOCTO_PER_NEAR + int((fraction + "0" * 24)[:24])
    if value >= 2**128:
        raise ValueError("Amount exceeds u128")
    return str(value)


def yocto_to_near(amount: str | int) -> str:
    """Exact yoctoNEAR → decimal NEAR string (integer arithmetic; no float rounding)."""
    whole, fraction = divmod(int(amount), YOCTO_PER_NEAR)
    digits = str(fraction).rjust(24, "0").rstrip("0")
    return f"{whole}.{digits}" if digits else str(whole)
