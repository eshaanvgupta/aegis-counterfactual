"""NEAR testnet access for the Python services.

Reads (views, transaction status) use JSON-RPC directly and need no key. Signed calls go
through `packages/near-client/src/bridge.ts`, a child process that receives exactly one
role's key from this service's environment and refuses operations belonging to any other
role. No key material is ever placed in a request body, log line or receipt.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import time
from pathlib import Path

import httpx

from .models import Authorization, Budget, Intent, Policy, Receipt, Snapshot
from .receipts import verify_receipt

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"]
EXPLORER_TX = "https://testnet.nearblocks.io/txns/"


class ChainError(RuntimeError):
    pass


def rpc_urls() -> list[str]:
    urls = [u.strip() for u in os.getenv("NEAR_RPC_URL", "").split(",") if u.strip()] or DEFAULT_RPCS
    for url in urls:
        if "mainnet" in url:
            raise ChainError("Mainnet RPC endpoints are refused")
    return urls


def rpc(method: str, params) -> dict:
    last = "no RPC configured"
    for url in rpc_urls():
        try:
            response = httpx.post(url, json={"jsonrpc": "2.0", "id": "aegis", "method": method, "params": params}, timeout=20)
            data = response.json()
            if "result" in data:
                return data["result"]
            last = json.dumps(data.get("error"))[:400]
        except (httpx.HTTPError, ValueError) as exc:
            last = str(exc)[:200]
    raise ChainError(f"RPC {method} failed: {last}")


def vault_id() -> str:
    value = os.getenv("NEAR_VAULT_ID", "")
    if not value.endswith(".testnet"):
        raise ChainError("NEAR_VAULT_ID must be a .testnet account")
    return value


def view(method: str, args: dict | None = None):
    result = rpc("query", {"request_type": "call_function", "finality": "final", "account_id": vault_id(), "method_name": method,
                           "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()})
    if "error" in result:
        raise ChainError(str(result["error"])[:400])
    raw = bytes(result["result"]).decode() or "null"
    return json.loads(raw)


def tx_status(tx_hash: str, signer_id: str) -> dict:
    return rpc("tx", {"tx_hash": tx_hash, "sender_account_id": signer_id, "wait_until": "FINAL"})


def bridge(operation: str, payload: dict, label: str | None = None) -> dict:
    """Sign one vault call as this process's single role. Returns genuine evidence,
    including failed outcomes with their real transaction hash and panic message."""
    command = [os.getenv("AEGIS_NODE", "node"), str(ROOT / "node_modules/tsx/dist/cli.mjs"), str(ROOT / "packages/near-client/src/bridge.ts")]
    request = json.dumps({"operation": operation, "label": label or operation, **payload})
    try:
        result = subprocess.run(command, input=request, text=True, capture_output=True, cwd=ROOT, timeout=120, check=False)
        reply = json.loads(result.stdout.strip().splitlines()[-1]) if result.stdout.strip() else {}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError):
        raise ChainError("NEAR bridge unavailable or timed out; no outcome is assumed") from None
    if not reply.get("ok"):
        raise ChainError(reply.get("error", "NEAR bridge failed")[:600])
    return reply["result"]


def authoritative_snapshot(authorization_id: str, agent_id: str | None = None) -> Snapshot:
    """Re-read every input to the policy from the vault itself. Never from the caller."""
    status = view("get_vault_status")
    policy = view("get_policy")
    auth = view("get_authorization", {"authorization_id": authorization_id})
    budget = view("get_authorization_budget", {"authorization_id": authorization_id}) or {"spent": "0", "reserved": "0"}
    agent = agent_id or status.get("agent_id")
    nonce = view("get_agent_nonce", {"agent_id": agent}) if agent else "0"
    return Snapshot(
        vault_id=status["vault_id"], owner_id=status["owner_id"], agent_id=status.get("agent_id"), attestor_id=status["attestor_id"],
        now_ms=str(int(time.time() * 1000)), paused=status["paused"], policy=Policy(**policy),
        authorization=Authorization(**auth) if auth else None, authorization_budget=Budget(**budget),
        daily_budget=Budget(**status["today"]), agent_nonce=str(nonce), available_balance=status["available"], source="NEAR_TESTNET",
    )


def _method_bound_to(tx: dict, intent_hash: str) -> str | None:
    for action in tx.get("transaction", {}).get("actions", []):
        call = action.get("FunctionCall") if isinstance(action, dict) else None
        if not call:
            continue
        args = json.loads(base64.b64decode(call["args"]).decode() or "{}")
        bound = args.get("intent_hash")
        if call["method_name"] == "submit_intent" and "intent" in args:
            from .canonical import intent_hash as hash_of
            bound = hash_of(args["intent"])
        if bound == intent_hash:
            return call["method_name"]
    return None


def succeeded(status: dict, receipts: list | None = None) -> bool:
    return "Failure" not in json.dumps(status) and not any("Failure" in json.dumps(r.get("outcome", {}).get("status", {})) for r in receipts or [])


def verify_onchain(data: dict) -> dict:
    """Local verification plus: the vault's own record of this intent commits to this
    receipt's evidence root, by this attestor, in a successful attest_intent transaction,
    with a lifecycle state consistent with the receipt's decision."""
    local = verify_receipt(data)
    if local["errors"]:
        return local
    r = Receipt.model_validate(data)
    if not r.attestation_transaction_hash:
        return local | {"on_chain": "NOT VERIFIED: receipt carries no attestation transaction hash"}
    try:
        record = view("get_intent", {"intent_hash": r.intent_hash})
        if not record:
            raise ChainError("The vault has no record of this intent hash")
        if Intent(**record["intent"]) != r.intent:
            raise ChainError("On-chain intent differs from the receipt's intent")
        if record.get("evidence_hash") != r.evidence_merkle_root_or_hash:
            raise ChainError("On-chain evidence commitment differs from the receipt's evidence root")
        if record.get("attested_by") != r.attestor_id:
            raise ChainError("On-chain attestor differs from the receipt's attestor")
        tx = tx_status(r.attestation_transaction_hash, r.attestor_id)
        if _method_bound_to(tx, r.intent_hash) != "attest_intent" or not succeeded(tx.get("status", {}), tx.get("receipts_outcome")):
            raise ChainError("Attestation transaction is not a successful attest_intent call for this intent")
        accepted = {"ALLOW": {"ATTESTED", "EXECUTING", "EXECUTED", "FAILED"}, "BLOCK": {"REJECTED", "EXPIRED"}}[r.final_decision]
        if record["status"] not in accepted:
            raise ChainError(f"On-chain status {record['status']} is inconsistent with decision {r.final_decision}")
        return local | {"on_chain": "ON-CHAIN OUTCOME VERIFIED", "chain_state": record["status"], "attestation_transaction": r.attestation_transaction_hash,
                        "explorer_url": EXPLORER_TX + r.attestation_transaction_hash,
                        "note": "Confirms the recorded contract decision and evidence commitment, not the correctness of AI findings."}
    except (ChainError, KeyError, ValueError) as exc:
        return local | {"on_chain": "ON-CHAIN VERIFICATION FAILED", "chain_error": str(exc)[:400]}
