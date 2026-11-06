"""Owner console (separate process; key: OWNER only; every route needs the owner token).

The owner writes mandates and policy independently of any invoice the agent reads. The
authorized invoice text is registered by fingerprint so reviewers can rebuild the
reference twin; the fingerprint itself lives on-chain in the mandate.
"""
from __future__ import annotations

import os
import time

from fastapi import Header, HTTPException
from pydantic import Field

from . import store
from .backend import get_backend, mode
from .canonical import fingerprint, near_to_yocto
from .models import Authorization, Policy, Strict
from .web import create_app, forbid_foreign_keys, require_token


def startup() -> None:
    os.environ.setdefault("AEGIS_ROLE", "OWNER")
    if os.environ["AEGIS_ROLE"] != "OWNER":
        raise RuntimeError("owner-api must run as OWNER")
    forbid_foreign_keys("OWNER")


app = create_app("AEGIS owner console", "owner-api", rate_per_minute=60, startup=startup)


@app.get("/system/health")
def health() -> dict:
    return {"service": "owner-api", "status": "ok", "mode": mode(), "principal": "OWNER"}


class MandateRequest(Strict):
    id: str = Field(pattern=r"^[A-Za-z0-9._:-]{1,80}$")
    recipient: str = Field(min_length=2, max_length=64)
    amount_near: str = Field(min_length=1, max_length=40)
    max_total_near: str | None = None
    purpose_id: str = Field(pattern=r"^[A-Za-z0-9._:-]{1,160}$")
    invoice: str = Field(min_length=1, max_length=20000)
    expires_in_hours: int = Field(default=24 * 30, ge=1, le=24 * 120)


@app.post("/owner/authorizations")
def create_authorization(body: MandateRequest, authorization: str | None = Header(default=None)) -> dict:
    require_token("AEGIS_OWNER_TOKEN", authorization)
    backend = get_backend()
    p = backend.principals()
    current = backend.policy()
    expires = min(int(time.time() * 1000) + body.expires_in_hours * 3_600_000, int(current.expires_at_ms))
    mandate = Authorization(id=body.id, owner_id=p["owner"], agent_id=p["agent"], recipient=body.recipient,
                            amount=near_to_yocto(body.amount_near), max_total=near_to_yocto(body.max_total_near or body.amount_near),
                            purpose_id=body.purpose_id, invoice_fingerprint=fingerprint(body.invoice), expires_at_ms=str(expires),
                            policy_version=current.version)
    store.register_invoice(body.invoice)
    outcome = backend.create_authorization(mandate, label=f"Owner authorizes {mandate.id}")
    store.log_event("owner-api", "CREATE_AUTHORIZATION", {"id": mandate.id, "succeeded": outcome["succeeded"]})
    if not outcome["succeeded"]:
        raise HTTPException(409, {"detail": outcome.get("failure"), "chain": outcome})
    return {"authorization": mandate.model_dump(), "chain": outcome}


@app.post("/owner/authorizations/{authorization_id}/revoke")
def revoke(authorization_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_token("AEGIS_OWNER_TOKEN", authorization)
    return get_backend().revoke_authorization(authorization_id, label=f"Owner revokes {authorization_id}")


class PolicyRequest(Strict):
    allowed_recipients: list[str] = Field(min_length=1, max_length=16)
    max_transaction_near: str
    daily_limit_near: str


@app.post("/owner/policy")
def set_policy(body: PolicyRequest, authorization: str | None = Header(default=None)) -> dict:
    require_token("AEGIS_OWNER_TOKEN", authorization)
    backend = get_backend()
    current = backend.policy()
    new = Policy(version=str(int(current.version) + 1), allowed_recipients=body.allowed_recipients,
                 max_transaction=near_to_yocto(body.max_transaction_near), daily_limit=near_to_yocto(body.daily_limit_near),
                 allowed_actions=["native_transfer"], expires_at_ms=current.expires_at_ms)
    return backend.set_policy(new, label=f"Owner sets policy v{new.version}")


@app.post("/owner/pause")
def pause(authorization: str | None = Header(default=None)) -> dict:
    require_token("AEGIS_OWNER_TOKEN", authorization)
    return get_backend().pause(label="Owner pauses the vault")


@app.post("/owner/unpause")
def unpause(authorization: str | None = Header(default=None)) -> dict:
    require_token("AEGIS_OWNER_TOKEN", authorization)
    return get_backend().unpause(label="Owner unpauses the vault")
