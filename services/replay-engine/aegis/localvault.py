"""LOCAL_SIMULATION: an in-process mirror of the vault contract's lifecycle.

`LocalVault` applies the same checks in the same order with the same error codes as
contracts/aegis-vault/src/lib.rs, using `policy.violations` (itself verified against the
contract by the shared policy vectors). It moves only simulated balances. Everything it
produces is labelled LOCAL_SIMULATION; real enforcement evidence comes from testnet.
"""
from __future__ import annotations

import copy
import re
from typing import Callable

from . import policy as rules
from .canonical import intent_hash
from .models import Authorization, Budget, Intent, Policy, Snapshot

DAY_MS = 86_400_000
MAX_DAILY_INTENTS = 64
MAX_AUTHORIZATIONS = 256
AUDIT_CAPACITY = 128
_IDENT = re.compile(r"^[A-Za-z0-9._:-]+$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


class VaultError(Exception):
    """A contract panic, e.g. `OWNER_ONLY` or `POLICY_VIOLATION:A,B`."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    @property
    def codes(self) -> list[str]:
        body = self.message.removeprefix("POLICY_VIOLATION:")
        return [c for c in body.split(",") if c]


def require(condition: bool, code: str) -> None:
    if not condition:
        raise VaultError(code)


class LocalVault:
    def __init__(self, state: dict, clock: Callable[[], int]):
        self.state = state
        self.clock = clock

    @classmethod
    def create(cls, *, vault_id: str, owner_id: str, agent_id: str, attestor_id: str, policy: Policy,
               balance: int, clock: Callable[[], int]) -> "LocalVault":
        require(len({vault_id, owner_id, agent_id, attestor_id}) == 4, "PRINCIPALS_MUST_DIFFER")
        state = {
            "vault_id": vault_id, "owner_id": owner_id, "agent_id": agent_id, "attestor_id": attestor_id,
            "agent_generation": 0, "attestor_generation": 0, "paused": False, "policy": policy.model_dump(),
            "authorizations": {}, "intents": {}, "intent_index": [], "agent_nonces": {}, "daily_budgets": {},
            "intent_quota": [0, 0], "reserved": "0", "pending_transfers": 0, "audit": [], "audit_count": 0,
            "balance": str(balance), "failing_recipients": [], "transfers": [],
        }
        vault = cls(state, clock)
        vault._record(vault_id, "VAULT_INITIALIZED", None)
        return vault

    def fork(self) -> "LocalVault":
        """An identical, independent world (the counterfactual twin)."""
        return LocalVault(copy.deepcopy(self.state), self.clock)

    # ---------------------------------------------------------------- helpers
    @property
    def policy(self) -> Policy:
        return Policy(**self.state["policy"])

    def _now(self) -> int:
        return int(self.clock())

    def _record(self, caller: str, event: str, subject: str | None) -> None:
        s = self.state
        s["audit"].append({"id": str(s["audit_count"]), "timestamp_ms": str(self._now()), "caller": caller, "event": event, "subject": subject})
        s["audit"] = s["audit"][-AUDIT_CAPACITY:]
        s["audit_count"] += 1

    def _owner(self, caller: str) -> None:
        require(caller == self.state["owner_id"], "OWNER_ONLY")

    def _agent(self, caller: str) -> None:
        require(self.state["agent_id"] is not None and caller == self.state["agent_id"], "AGENT_ONLY")

    def _intent(self, h: str) -> dict:
        record = self.state["intents"].get(h)
        require(record is not None, "INTENT_NOT_FOUND")
        return record

    def snapshot(self, authorization_id: str, agent_id: str | None = None) -> Snapshot:
        s = self.state
        record = s["authorizations"].get(authorization_id)
        today = s["daily_budgets"].get(str(self._now() // DAY_MS), {"spent": "0", "reserved": "0"})
        agent = agent_id or s["agent_id"] or ""
        return Snapshot(
            vault_id=s["vault_id"], owner_id=s["owner_id"], agent_id=s["agent_id"], attestor_id=s["attestor_id"],
            now_ms=str(self._now()), paused=s["paused"], policy=self.policy,
            authorization=Authorization(**record["authorization"]) if record else None,
            authorization_budget=Budget(**record["budget"]) if record else Budget(),
            daily_budget=Budget(**today), agent_nonce=str(s["agent_nonces"].get(agent, 0)),
            available_balance=str(self.available_balance()), source="LOCAL_SIMULATION",
        )

    def violations(self, intent: Intent) -> list[str]:
        return rules.violations(intent, self.snapshot(intent.authorization_id, intent.agent_id))

    def _assert_executable(self, intent: Intent) -> None:
        found = self.violations(intent)
        if found:
            raise VaultError("POLICY_VIOLATION:" + ",".join(found))

    def available_balance(self) -> int:
        # Simulated storage requirement plus the contract's 0.05 NEAR margin.
        return max(int(self.state["balance"]) - 3 * 10**24 // 100 - 5 * 10**22, 0)

    # ------------------------------------------------------------------ owner
    def create_authorization(self, caller: str, auth: Authorization) -> None:
        self._owner(caller)
        s, p = self.state, self.policy
        require(len(s["authorizations"]) < MAX_AUTHORIZATIONS, "AUTHORIZATION_CAPACITY")
        require(bool(_IDENT.match(auth.id)) and len(auth.id) <= 80, "INVALID_IDENTIFIER")
        require(auth.id not in s["authorizations"], "AUTHORIZATION_EXISTS")
        require(auth.owner_id == s["owner_id"], "WRONG_OWNER")
        require(auth.agent_id == s["agent_id"], "AGENT_NOT_REGISTERED")
        require(not auth.revoked, "AUTHORIZATION_REVOKED")
        require(auth.asset == "NEAR" and auth.action == "native_transfer", "UNSUPPORTED_ACTION")
        require(int(auth.amount) > 0 and int(auth.max_total) >= int(auth.amount), "INVALID_AMOUNT")
        require(int(auth.amount) <= int(p.max_transaction), "MAX_TRANSACTION")
        require(auth.policy_version == p.version, "POLICY_VERSION")
        require(self._now() < int(auth.expires_at_ms) <= int(p.expires_at_ms), "AUTHORIZATION_EXPIRY")
        require(auth.recipient in p.allowed_recipients, "RECIPIENT_NOT_ALLOWED")
        s["authorizations"][auth.id] = {"authorization": auth.model_dump(), "budget": {"spent": "0", "reserved": "0"}, "created_at_ms": str(self._now())}
        self._record(caller, "AUTHORIZATION_CREATED", auth.id)

    def revoke_authorization(self, caller: str, authorization_id: str) -> None:
        self._owner(caller)
        record = self.state["authorizations"].get(authorization_id)
        require(record is not None, "AUTHORIZATION_NOT_FOUND")
        record["authorization"]["revoked"] = True
        self._record(caller, "AUTHORIZATION_REVOKED", authorization_id)

    def register_agent(self, caller: str, agent_id: str) -> None:
        self._owner(caller)
        s = self.state
        require(agent_id not in (s["owner_id"], s["attestor_id"], s["vault_id"]), "PRINCIPALS_MUST_DIFFER")
        s["agent_id"], s["agent_generation"] = agent_id, s["agent_generation"] + 1
        self._record(caller, "AGENT_REGISTERED", agent_id)

    def revoke_agent(self, caller: str) -> None:
        self._owner(caller)
        self.state["agent_id"], self.state["agent_generation"] = None, self.state["agent_generation"] + 1
        self._record(caller, "AGENT_REVOKED", None)

    def set_attestor(self, caller: str, attestor_id: str) -> None:
        self._owner(caller)
        s = self.state
        require(attestor_id not in (s["owner_id"], s["agent_id"], s["vault_id"]), "PRINCIPALS_MUST_DIFFER")
        s["attestor_id"], s["attestor_generation"] = attestor_id, s["attestor_generation"] + 1
        self._record(caller, "ATTESTOR_CHANGED", attestor_id)

    def set_policy(self, caller: str, new_policy: Policy) -> None:
        self._owner(caller)
        require(int(new_policy.max_transaction) > 0 and int(new_policy.daily_limit) >= int(new_policy.max_transaction), "INVALID_POLICY_LIMITS")
        require(new_policy.allowed_actions == ["native_transfer"], "UNSUPPORTED_ACTION")
        require(int(new_policy.expires_at_ms) > self._now(), "POLICY_EXPIRED")
        require(int(new_policy.version) == int(self.policy.version) + 1, "POLICY_MUST_INCREMENT")
        self.state["policy"] = new_policy.model_dump()
        self._record(caller, "POLICY_CHANGED", new_policy.version)

    def pause(self, caller: str) -> None:
        self._owner(caller)
        self.state["paused"] = True
        self._record(caller, "PAUSED", None)

    def unpause(self, caller: str) -> None:
        self._owner(caller)
        self.state["paused"] = False
        self._record(caller, "UNPAUSED", None)

    # ------------------------------------------------------------------ agent
    def submit_intent(self, caller: str, intent: Intent) -> str:
        s = self.state
        self._agent(caller)
        require(not s["paused"], "VAULT_PAUSED")
        require(intent.agent_id == caller, "WRONG_AGENT")
        require(intent.network_id == "testnet" and intent.vault_id == s["vault_id"], "WRONG_DOMAIN")
        for value, limit in ((intent.authorization_id, 80), (intent.purpose_id, 160)):
            require(0 < len(value) <= limit, "INVALID_FIELD_LENGTH")
            require(bool(_IDENT.match(value)), "INVALID_IDENTIFIER")
        require(bool(_HEX64.match(intent.invoice_fingerprint)), "INVALID_HASH")
        require(int(intent.amount) > 0, "INVALID_AMOUNT")
        require(int(intent.nonce) > s["agent_nonces"].get(intent.agent_id, 0), "NONCE_REPLAY")
        today = self._now() // DAY_MS
        submitted = s["intent_quota"][1] if s["intent_quota"][0] == today else 0
        require(submitted < MAX_DAILY_INTENTS, "DAILY_INTENT_QUOTA")
        h = intent_hash(intent)
        require(h not in s["intents"], "INTENT_EXISTS")
        s["intent_quota"] = [today, submitted + 1]
        s["agent_nonces"][intent.agent_id] = int(intent.nonce)
        s["intent_index"].append(h)
        s["intents"][h] = {
            "intent": intent.model_dump(), "intent_hash": h, "status": "PROPOSED", "proposed_at_ms": str(self._now()),
            "evidence_hash": None, "attested_by": None, "attested_at_ms": None, "agent_generation": str(s["agent_generation"]),
            "attestor_generation": None, "reservation_day": None, "settled_at_ms": None,
        }
        self._record(caller, "INTENT_PROPOSED", h)
        return h

    def execute_intent(self, caller: str, h: str) -> dict:
        """Reserve budget and dispatch the (simulated) transfer. Call `settle` to deliver
        the callback; `execute_and_settle` does both."""
        s = self.state
        self._agent(caller)
        require(not s["paused"], "VAULT_PAUSED")
        record = self._intent(h)
        require(record["status"] == "ATTESTED", "INTENT_NOT_ATTESTED")
        require(record["attested_by"] == s["attestor_id"], "ATTESTOR_CHANGED")
        require(record["attestor_generation"] == str(s["attestor_generation"]), "ATTESTOR_GENERATION")
        require(record["agent_generation"] == str(s["agent_generation"]), "AGENT_GENERATION")
        require(record["evidence_hash"] is not None, "MISSING_EVIDENCE")
        intent = Intent(**record["intent"])
        require(intent_hash(intent) == h, "INTENT_HASH_MISMATCH")
        self._assert_executable(intent)
        amount = int(intent.amount)
        require(amount <= self.available_balance(), "INSUFFICIENT_AVAILABLE_BALANCE")
        day = str(self._now() // DAY_MS)
        budget = s["daily_budgets"].setdefault(day, {"spent": "0", "reserved": "0"})
        budget["reserved"] = str(int(budget["reserved"]) + amount)
        mandate = s["authorizations"][intent.authorization_id]["budget"]
        mandate["reserved"] = str(int(mandate["reserved"]) + amount)
        s["reserved"] = str(int(s["reserved"]) + amount)
        s["pending_transfers"] += 1
        s["balance"] = str(int(s["balance"]) - amount)  # deducted at dispatch, as on NEAR
        record["status"], record["reservation_day"] = "EXECUTING", day
        self._record(caller, "TRANSFER_RESERVED", h)
        return {"intent_hash": h, "recipient": intent.recipient, "amount": intent.amount}

    def settle(self, h: str) -> bool:
        """The private callback. Fails if the recipient is in `failing_recipients`."""
        s = self.state
        record = self._intent(h)
        require(record["status"] == "EXECUTING", "INVALID_CALLBACK_STATE")
        intent = Intent(**record["intent"])
        amount = int(intent.amount)
        success = intent.recipient not in s["failing_recipients"]
        budget = s["daily_budgets"][record["reservation_day"]]
        mandate = s["authorizations"][intent.authorization_id]["budget"]
        budget["reserved"] = str(int(budget["reserved"]) - amount)
        mandate["reserved"] = str(int(mandate["reserved"]) - amount)
        if success:
            budget["spent"] = str(int(budget["spent"]) + amount)
            mandate["spent"] = str(int(mandate["spent"]) + amount)
            s["transfers"].append({"intent_hash": h, "recipient": intent.recipient, "amount": intent.amount})
        else:
            s["balance"] = str(int(s["balance"]) + amount)  # refund receipt
        s["reserved"] = str(int(s["reserved"]) - amount)
        s["pending_transfers"] -= 1
        record["status"] = "EXECUTED" if success else "FAILED"
        record["settled_at_ms"] = str(self._now())
        self._record(s["vault_id"], "TRANSFER_EXECUTED" if success else "TRANSFER_FAILED_QUOTA_RELEASED", h)
        return success

    def execute_and_settle(self, caller: str, h: str) -> bool:
        self.execute_intent(caller, h)
        return self.settle(h)

    # --------------------------------------------------------------- attestor
    def attest_intent(self, caller: str, h: str, evidence_hash: str, approved: bool) -> str:
        s = self.state
        require(caller == s["attestor_id"], "ATTESTOR_ONLY")
        require(bool(_HEX64.match(evidence_hash)), "INVALID_HASH")
        record = self._intent(h)
        require(record["status"] == "PROPOSED", "INVALID_INTENT_STATE")
        intent = Intent(**record["intent"])
        require(intent_hash(intent) == h, "INTENT_HASH_MISMATCH")
        if approved:
            require(not s["paused"], "VAULT_PAUSED")
            require(record["agent_generation"] == str(s["agent_generation"]), "AGENT_GENERATION")
            self._assert_executable(intent)
            status, event = "ATTESTED", "INTENT_ATTESTED"
        elif self._now() >= int(intent.expires_at_ms):
            status, event = "EXPIRED", "INTENT_EXPIRED"
        else:
            status, event = "REJECTED", "INTENT_DENIED"
        record.update(status=status, evidence_hash=evidence_hash, attested_by=s["attestor_id"],
                      attested_at_ms=str(self._now()), attestor_generation=str(s["attestor_generation"]))
        self._record(caller, event, h)
        return status

    def expire_intent(self, caller: str, h: str) -> None:
        record = self._intent(h)
        require(record["status"] in ("PROPOSED", "ATTESTED"), "INVALID_INTENT_STATE")
        require(self._now() >= int(record["intent"]["expires_at_ms"]), "INTENT_NOT_EXPIRED")
        record["status"], record["settled_at_ms"] = "EXPIRED", str(self._now())
        self._record(caller, "INTENT_EXPIRED", h)

    # ------------------------------------------------------------------ views
    def get_intent(self, h: str) -> dict | None:
        record = self.state["intents"].get(h)
        return copy.deepcopy(record) if record else None

    def recent_intents(self, limit: int = 20) -> list[dict]:
        return [copy.deepcopy(self.state["intents"][h]) for h in reversed(self.state["intent_index"][-limit:])]

    def recent_audit(self, limit: int = 20) -> list[dict]:
        return list(reversed(self.state["audit"][-limit:]))

    def authorizations(self) -> list[dict]:
        return [copy.deepcopy(r) for r in self.state["authorizations"].values()]

    def check_intent(self, intent: Intent) -> dict:
        found = self.violations(intent)
        return {"intent_hash": intent_hash(intent), "executable": not found, "violations": found}

    def status(self) -> dict:
        s = self.state
        today = s["daily_budgets"].get(str(self._now() // DAY_MS), {"spent": "0", "reserved": "0"})
        return {
            "contract_version": "1.0.0-local", "network_id": "testnet", "vault_id": s["vault_id"], "owner_id": s["owner_id"],
            "agent_id": s["agent_id"], "attestor_id": s["attestor_id"], "agent_generation": str(s["agent_generation"]),
            "attestor_generation": str(s["attestor_generation"]), "paused": s["paused"], "balance": s["balance"],
            "available": str(self.available_balance()), "reserved": s["reserved"], "pending_transfers": str(s["pending_transfers"]),
            "today": today, "daily_limit": self.policy.daily_limit, "policy_version": self.policy.version,
            "authorization_count": str(len(s["authorizations"])), "intent_count": str(len(s["intent_index"])),
            "audit_count": str(s["audit_count"]), "mode": "LOCAL_SIMULATION",
        }
