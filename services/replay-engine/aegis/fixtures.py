"""Shared fixtures: the reference invoice, the standard mandate and the scenario catalog."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .canonical import fingerprint
from .models import AgentContext, Authorization, Policy

ROOT = Path(__file__).resolve().parents[3]
SCENARIO_DIR = ROOT / "scenarios"


@lru_cache(maxsize=1)
def demo() -> dict:
    return json.loads((ROOT / "packages/shared-types/demo-fixtures.json").read_text(encoding="utf-8"))


def reference_invoice(recipient: str) -> str:
    return demo()["reference_invoice_template"].replace("{recipient}", recipient)


def reference_context(recipient: str) -> AgentContext:
    d = demo()
    return AgentContext(authorization_id=d["mandate"]["id"], objective=d["objective"], invoice=reference_invoice(recipient))


def standard_mandate(owner: str, agent: str, recipient: str, expires_at_ms: str, policy_version: str = "1") -> Authorization:
    m = demo()["mandate"]
    return Authorization(
        id=m["id"], owner_id=owner, agent_id=agent, recipient=recipient, amount=m["amount"], max_total=m["max_total"],
        purpose_id=m["purpose_id"], invoice_fingerprint=fingerprint(reference_invoice(recipient)),
        expires_at_ms=expires_at_ms, policy_version=policy_version,
    )


def offline() -> dict:
    return demo()["offline"]


def offline_policy() -> Policy:
    return Policy(**offline()["policy"])


@lru_cache(maxsize=1)
def scenarios() -> tuple[dict, ...]:
    docs = [json.loads(p.read_text(encoding="utf-8")) | {"path": p.relative_to(ROOT).as_posix()}
            for p in SCENARIO_DIR.glob("*/*.json")]
    return tuple(sorted(docs, key=lambda d: d["id"]))


def scenario(scenario_id: str) -> dict:
    for doc in scenarios():
        if doc["id"] == scenario_id or doc["slug"] == scenario_id:
            return doc
    raise KeyError(f"Unknown scenario {scenario_id}")
