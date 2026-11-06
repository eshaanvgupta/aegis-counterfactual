"""Deterministic authorization policy: an exact mirror of the vault contract.

`violations()` reproduces `Vault::violations` in contracts/aegis-vault/src/lib.rs,
returning the same invariant codes in the same order. Parity is enforced by the shared
fixture packages/shared-types/policy-vectors.json, which the Rust tests, these Python
tests and the TypeScript verifier all assert.

This module decides eligibility. Nothing an AI investigator says can change its output.
"""
from __future__ import annotations

import re

from .models import Check, Intent, Snapshot

NETWORK_ID = "testnet"
ASSET_NEAR = "NEAR"
ACTION_NATIVE_TRANSFER = "native_transfer"
DAY_MS = 86_400_000
U128_MAX = 2**128 - 1

ORDER = [
    "VAULT_PAUSED", "WRONG_DOMAIN", "AGENT_NOT_REGISTERED", "UNSUPPORTED_ACTION", "RECIPIENT_NOT_ALLOWED",
    "MAX_TRANSACTION", "POLICY_VERSION", "INTENT_EXPIRED", "AUTHORIZATION_NOT_FOUND", "AUTHORIZATION_REVOKED",
    "AUTHORIZATION_EXPIRED", "AUTHORIZATION_PRINCIPAL", "AUTHORIZATION_POLICY_VERSION", "AUTHORIZATION_RECIPIENT",
    "AUTHORIZATION_AMOUNT", "AUTHORIZATION_ACTION", "INVOICE_MISMATCH", "PURPOSE_MISMATCH", "AUTHORIZATION_BUDGET",
    "DAILY_BUDGET",
]

DESCRIPTIONS = {
    "VAULT_PAUSED": "The owner's emergency pause is off.",
    "WRONG_DOMAIN": "The intent is bound to NEAR testnet and to this exact vault account.",
    "AGENT_NOT_REGISTERED": "The proposing agent is the currently registered spending principal.",
    "UNSUPPORTED_ACTION": "Only native NEAR transfers are executable; no arbitrary calls.",
    "RECIPIENT_NOT_ALLOWED": "The recipient is on the owner's policy allowlist.",
    "MAX_TRANSACTION": "The amount is positive and within the per-transaction cap.",
    "POLICY_VERSION": "The intent was built under the current policy version.",
    "INTENT_EXPIRED": "Neither the intent nor the policy has expired.",
    "AUTHORIZATION_NOT_FOUND": "An owner mandate with this ID exists.",
    "AUTHORIZATION_REVOKED": "The owner has not revoked the mandate.",
    "AUTHORIZATION_EXPIRED": "The mandate is live and outlives the intent.",
    "AUTHORIZATION_PRINCIPAL": "The mandate names this owner and this agent.",
    "AUTHORIZATION_POLICY_VERSION": "The mandate was issued under the current policy version.",
    "AUTHORIZATION_RECIPIENT": "The recipient equals the mandate's recipient.",
    "AUTHORIZATION_AMOUNT": "The amount equals the mandate's exact amount.",
    "AUTHORIZATION_ACTION": "The asset and action equal the mandate's.",
    "INVOICE_MISMATCH": "The invoice fingerprint equals the one the owner authorized.",
    "PURPOSE_MISMATCH": "The business purpose equals the mandate's purpose.",
    "AUTHORIZATION_BUDGET": "Spent + reserved + amount stays within the mandate total.",
    "DAILY_BUDGET": "Today's spent + reserved + amount stays within the daily limit.",
}

_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]+$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def _fits(*parts: int, limit: int) -> bool:
    """Checked u128 addition, as in the contract: overflow counts as exceeding."""
    total = sum(parts)
    return total <= U128_MAX and total <= limit


def violations(intent: Intent, snap: Snapshot) -> list[str]:
    now = int(snap.now_ms)
    policy = snap.policy
    amount = int(intent.amount)
    found: list[str] = []
    if snap.paused:
        found.append("VAULT_PAUSED")
    if intent.network_id != NETWORK_ID or intent.vault_id != snap.vault_id:
        found.append("WRONG_DOMAIN")
    if snap.agent_id != intent.agent_id:
        found.append("AGENT_NOT_REGISTERED")
    if intent.asset != ASSET_NEAR or intent.action != ACTION_NATIVE_TRANSFER or intent.action not in policy.allowed_actions:
        found.append("UNSUPPORTED_ACTION")
    if intent.recipient not in policy.allowed_recipients:
        found.append("RECIPIENT_NOT_ALLOWED")
    if amount == 0 or amount > int(policy.max_transaction):
        found.append("MAX_TRANSACTION")
    if intent.policy_version != policy.version:
        found.append("POLICY_VERSION")
    if now >= int(intent.expires_at_ms) or now >= int(policy.expires_at_ms):
        found.append("INTENT_EXPIRED")
    auth = snap.authorization if snap.authorization and snap.authorization.id == intent.authorization_id else None
    if auth is None:
        found.append("AUTHORIZATION_NOT_FOUND")
    else:
        if auth.revoked:
            found.append("AUTHORIZATION_REVOKED")
        if now >= int(auth.expires_at_ms) or int(intent.expires_at_ms) > int(auth.expires_at_ms):
            found.append("AUTHORIZATION_EXPIRED")
        if auth.agent_id != intent.agent_id or auth.owner_id != snap.owner_id:
            found.append("AUTHORIZATION_PRINCIPAL")
        if auth.policy_version != policy.version:
            found.append("AUTHORIZATION_POLICY_VERSION")
        if auth.recipient != intent.recipient:
            found.append("AUTHORIZATION_RECIPIENT")
        if auth.amount != intent.amount:
            found.append("AUTHORIZATION_AMOUNT")
        if auth.asset != intent.asset or auth.action != intent.action:
            found.append("AUTHORIZATION_ACTION")
        if auth.invoice_fingerprint != intent.invoice_fingerprint:
            found.append("INVOICE_MISMATCH")
        if auth.purpose_id != intent.purpose_id:
            found.append("PURPOSE_MISMATCH")
        budget = snap.authorization_budget
        if not _fits(int(budget.spent), int(budget.reserved), amount, limit=int(auth.max_total)):
            found.append("AUTHORIZATION_BUDGET")
    day = snap.daily_budget
    if not _fits(int(day.spent), int(day.reserved), amount, limit=int(policy.daily_limit)):
        found.append("DAILY_BUDGET")
    return found


def checks(intent: Intent, snap: Snapshot) -> list[Check]:
    """Every invariant with pass/fail, in contract order (for receipts and the UI)."""
    failed = set(violations(intent, snap))
    return [Check(invariant=code, passed=code not in failed, detail=DESCRIPTIONS[code]) for code in ORDER]


def allowed(intent: Intent, snap: Snapshot) -> bool:
    return not violations(intent, snap)


def submission_errors(intent: Intent, snap: Snapshot) -> list[str]:
    """Structural checks `submit_intent` applies before recording a proposal, in order.
    The contract panics at the first; this returns all, first one first."""
    errors: list[str] = []
    if snap.agent_id is None or intent.agent_id != snap.agent_id:
        errors.append("AGENT_ONLY")
    if snap.paused:
        errors.append("VAULT_PAUSED")
    if intent.network_id != NETWORK_ID or intent.vault_id != snap.vault_id:
        errors.append("WRONG_DOMAIN")
    if not _IDENTIFIER.match(intent.authorization_id) or len(intent.authorization_id) > 80 or \
            not _IDENTIFIER.match(intent.purpose_id) or len(intent.purpose_id) > 160:
        errors.append("INVALID_IDENTIFIER")
    if not _DIGEST.match(intent.invoice_fingerprint):
        errors.append("INVALID_HASH")
    if int(intent.amount) == 0:
        errors.append("INVALID_AMOUNT")
    if int(intent.nonce) <= int(snap.agent_nonce):
        errors.append("NONCE_REPLAY")
    return errors
