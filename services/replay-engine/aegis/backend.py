"""Vault backends with one interface.

* `LocalBackend` — LOCAL_SIMULATION. A LocalVault persisted in SQLite; every mutation runs
  inside `BEGIN IMMEDIATE`, so concurrent requests from the three services serialize the
  same way receipts serialize on one NEAR shard.
* `TestnetBackend` — TESTNET. Views over JSON-RPC; signed calls through the single-role
  bridge. Holds no key itself.

A service's role (`AEGIS_ROLE`: AGENT, ATTESTOR or OWNER) fixes which mutations it may call.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from . import chain, fixtures
from .canonical import fingerprint
from .localvault import LocalVault, VaultError
from .models import Authorization, Intent, Policy, Snapshot

ROOT = Path(__file__).resolve().parents[3]
ROLE_OPERATIONS = {
    "AGENT": {"submit", "execute"},
    "ATTESTOR": {"attest"},
    "OWNER": {"create_authorization", "revoke_authorization", "set_policy", "pause", "unpause"},
}


def mode() -> str:
    value = os.getenv("AEGIS_MODE", "LOCAL_SIMULATION")
    if value not in ("LOCAL_SIMULATION", "TESTNET"):
        raise RuntimeError("AEGIS_MODE must be LOCAL_SIMULATION or TESTNET")
    return value


def role() -> str:
    return os.getenv("AEGIS_ROLE", "AGENT")


def db_path() -> Path:
    path = Path(os.getenv("AEGIS_DB", str(ROOT / "runtime/aegis.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _authorize(operation: str) -> None:
    if operation not in ROLE_OPERATIONS.get(role(), set()):
        raise PermissionError(f"A {role()} service cannot perform {operation}")


def result(operation: str, ok: bool, *, failure: str | None = None, codes: list[str] | None = None, value=None, label: str = "") -> dict:
    return {"mode": "LOCAL_SIMULATION", "operation": operation, "label": label or operation, "succeeded": ok, "transaction_hash": None,
            "explorer_url": None, "failure": failure, "violated_invariants": codes or [], "return_value": value,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


class LocalBackend:
    mode = "LOCAL_SIMULATION"

    def principals(self) -> dict:
        return fixtures.offline()["principals"]

    @contextmanager
    def vault(self, write: bool = False):
        db = sqlite3.connect(db_path(), timeout=15)
        try:
            db.execute("CREATE TABLE IF NOT EXISTS vault_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)")
            if write:
                db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM vault_state WHERE id = 1").fetchone()
            clock = lambda: int(time.time() * 1000)  # noqa: E731
            if row:
                vault = LocalVault(json.loads(row[0]), clock)
            else:
                p = self.principals()
                vault = LocalVault.create(vault_id=p["vault"], owner_id=p["owner"], agent_id=p["agent"], attestor_id=p["attestor"],
                                          policy=fixtures.offline_policy(), balance=int(fixtures.offline()["vault_balance"]), clock=clock)
                vault.create_authorization(p["owner"], fixtures.standard_mandate(p["owner"], p["agent"], p["recipient"], fixtures.offline()["authorization_expires_at_ms"]))
                db.execute("INSERT OR IGNORE INTO vault_state VALUES (1, ?)", (json.dumps(vault.state),))
            yield vault
            if write:
                db.execute("INSERT OR REPLACE INTO vault_state VALUES (1, ?)", (json.dumps(vault.state),))
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    # views
    def status(self) -> dict:
        with self.vault() as v:
            return v.status()

    def policy(self) -> Policy:
        with self.vault() as v:
            return v.policy

    def authorizations(self) -> list[dict]:
        with self.vault() as v:
            return v.authorizations()

    def authorization(self, authorization_id: str) -> dict | None:
        with self.vault() as v:
            record = v.state["authorizations"].get(authorization_id)
            return record["authorization"] if record else None

    def intent(self, h: str) -> dict | None:
        with self.vault() as v:
            return v.get_intent(h)

    def recent_intents(self, limit: int = 20) -> list[dict]:
        with self.vault() as v:
            return v.recent_intents(limit)

    def recent_audit(self, limit: int = 20) -> list[dict]:
        with self.vault() as v:
            return v.recent_audit(limit)

    def agent_nonce(self, agent_id: str) -> int:
        with self.vault() as v:
            return int(v.state["agent_nonces"].get(agent_id, 0))

    def snapshot(self, authorization_id: str, agent_id: str | None = None) -> Snapshot:
        with self.vault() as v:
            return v.snapshot(authorization_id, agent_id)

    def check_intent(self, intent: Intent) -> dict:
        with self.vault() as v:
            return v.check_intent(intent)

    # signed operations
    def _mutate(self, operation: str, fn, label: str = "") -> dict:
        _authorize(operation)
        try:
            with self.vault(write=True) as v:
                return result(operation, True, value=fn(v), label=label)
        except VaultError as exc:
            return result(operation, False, failure=exc.message, codes=exc.codes, label=label)

    def submit(self, intent: Intent, label: str = "") -> dict:
        return self._mutate("submit", lambda v: v.submit_intent(self.principals()["agent"], intent), label)

    def execute(self, h: str, label: str = "") -> dict:
        def run(v: LocalVault):
            v.execute_intent(self.principals()["agent"], h)
            return {"settled": "EXECUTED" if v.settle(h) else "FAILED"}
        return self._mutate("execute", run, label)

    def attest(self, h: str, evidence_hash: str, approved: bool, label: str = "") -> dict:
        return self._mutate("attest", lambda v: v.attest_intent(self.principals()["attestor"], h, evidence_hash, approved), label)

    def create_authorization(self, auth: Authorization, label: str = "") -> dict:
        return self._mutate("create_authorization", lambda v: v.create_authorization(self.principals()["owner"], auth), label)

    def revoke_authorization(self, authorization_id: str, label: str = "") -> dict:
        return self._mutate("revoke_authorization", lambda v: v.revoke_authorization(self.principals()["owner"], authorization_id), label)

    def set_policy(self, new_policy: Policy, label: str = "") -> dict:
        return self._mutate("set_policy", lambda v: v.set_policy(self.principals()["owner"], new_policy), label)

    def pause(self, label: str = "") -> dict:
        return self._mutate("pause", lambda v: v.pause(self.principals()["owner"]), label)

    def unpause(self, label: str = "") -> dict:
        return self._mutate("unpause", lambda v: v.unpause(self.principals()["owner"]), label)


class TestnetBackend:
    mode = "TESTNET"

    def principals(self) -> dict:
        return {"vault": os.getenv("NEAR_VAULT_ID"), "owner": os.getenv("NEAR_OWNER_ID"), "agent": os.getenv("NEAR_AGENT_ID"),
                "attestor": os.getenv("NEAR_ATTESTOR_ID"), "recipient": os.getenv("NEAR_RECIPIENT_ID")}

    def status(self) -> dict:
        return chain.view("get_vault_status") | {"mode": "TESTNET"}

    def policy(self) -> Policy:
        return Policy(**chain.view("get_policy"))

    def authorizations(self) -> list[dict]:
        return chain.view("get_authorizations", {"limit": 50})

    def authorization(self, authorization_id: str) -> dict | None:
        return chain.view("get_authorization", {"authorization_id": authorization_id})

    def intent(self, h: str) -> dict | None:
        return chain.view("get_intent", {"intent_hash": h})

    def recent_intents(self, limit: int = 20) -> list[dict]:
        return chain.view("get_recent_intents", {"limit": limit})

    def recent_audit(self, limit: int = 20) -> list[dict]:
        return chain.view("get_recent_audit", {"limit": limit})

    def agent_nonce(self, agent_id: str) -> int:
        return int(chain.view("get_agent_nonce", {"agent_id": agent_id}))

    def snapshot(self, authorization_id: str, agent_id: str | None = None) -> Snapshot:
        return chain.authoritative_snapshot(authorization_id, agent_id)

    def check_intent(self, intent: Intent) -> dict:
        return chain.view("check_intent", {"intent": intent.model_dump()})

    def _signed(self, operation: str, payload: dict, label: str = "") -> dict:
        _authorize(operation)
        return chain.bridge(operation, payload, label)

    def submit(self, intent: Intent, label: str = "") -> dict:
        return self._signed("submit", {"intent": intent.model_dump()}, label)

    def execute(self, h: str, label: str = "") -> dict:
        return self._signed("execute", {"intent_hash": h}, label)

    def attest(self, h: str, evidence_hash: str, approved: bool, label: str = "") -> dict:
        return self._signed("attest", {"intent_hash": h, "evidence_hash": evidence_hash, "approved": approved}, label)

    def create_authorization(self, auth: Authorization, label: str = "") -> dict:
        return self._signed("create_authorization", {"authorization": auth.model_dump()}, label)

    def revoke_authorization(self, authorization_id: str, label: str = "") -> dict:
        return self._signed("revoke_authorization", {"authorization_id": authorization_id}, label)

    def set_policy(self, new_policy: Policy, label: str = "") -> dict:
        return self._signed("set_policy", {"policy": new_policy.model_dump()}, label)

    def pause(self, label: str = "") -> dict:
        return self._signed("pause", {}, label)

    def unpause(self, label: str = "") -> dict:
        return self._signed("unpause", {}, label)


def get_backend():
    return TestnetBackend() if mode() == "TESTNET" else LocalBackend()


def reference_invoice_for(authorization: dict) -> str | None:
    """The owner-authorized invoice text for a mandate, located by its fingerprint."""
    from . import store
    text = store.invoice(authorization["invoice_fingerprint"])
    if text:
        return text
    candidate = fixtures.reference_invoice(authorization["recipient"])
    return candidate if fingerprint(candidate) == authorization["invoice_fingerprint"] else None
