"""Schema-validated data model shared by every service.

Field names and integer encodings (decimal strings) intentionally match the vault
contract's JSON interface, so the same objects flow unchanged between the chain, the
services, the receipts and the browser.
"""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

U128_MAX = 2**128 - 1
U64_MAX = 2**64 - 1

DecimalStr = Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)$", max_length=39)]
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
AccountId = Annotated[
    str,
    Field(
        pattern=r"^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$",
        min_length=2,
        max_length=64,
    ),
]
Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9._:-]{1,80}$")]

ExecutionMode = Literal["LOCAL_SIMULATION", "TESTNET"]
InferenceMode = Literal["OFFLINE_HEURISTIC", "REAL_LLM_INFERENCE", "MODEL_FAILED_CLOSED"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _u128(value: str) -> str:
    if int(value) > U128_MAX:
        raise ValueError("outside u128 range")
    return value


def _u64(value: str) -> str:
    if int(value) > U64_MAX:
        raise ValueError("outside u64 range")
    return value


class Intent(Strict):
    """The exact action under review (`IntentFields` in the contract)."""

    network_id: str = Field(min_length=1, max_length=32)
    vault_id: AccountId
    agent_id: AccountId
    authorization_id: str = Field(min_length=1, max_length=80)
    recipient: AccountId
    asset: str = Field(min_length=1, max_length=16)
    amount: DecimalStr
    action: str = Field(min_length=1, max_length=32)
    nonce: DecimalStr
    expires_at_ms: DecimalStr
    policy_version: DecimalStr
    invoice_fingerprint: Digest
    purpose_id: str = Field(min_length=1, max_length=160)

    _amount = field_validator("amount")(_u128)
    _ints = field_validator("nonce", "expires_at_ms", "policy_version")(_u64)


class Policy(Strict):
    version: DecimalStr
    allowed_recipients: list[AccountId] = Field(min_length=1, max_length=16)
    max_transaction: DecimalStr
    daily_limit: DecimalStr
    allowed_actions: list[str] = Field(min_length=1, max_length=4)
    expires_at_ms: DecimalStr

    _amounts = field_validator("max_transaction", "daily_limit")(_u128)
    _ints = field_validator("version", "expires_at_ms")(_u64)


class Authorization(Strict):
    """An owner-written business mandate, independent of any invoice text."""

    id: Identifier
    owner_id: AccountId
    agent_id: AccountId
    recipient: AccountId
    amount: DecimalStr
    max_total: DecimalStr
    asset: str = "NEAR"
    purpose_id: str = Field(pattern=r"^[A-Za-z0-9._:-]{1,160}$")
    invoice_fingerprint: Digest
    expires_at_ms: DecimalStr
    policy_version: DecimalStr
    action: str = "native_transfer"
    revoked: bool = False

    _amounts = field_validator("amount", "max_total")(_u128)
    _ints = field_validator("expires_at_ms", "policy_version")(_u64)


class Budget(Strict):
    spent: DecimalStr = "0"
    reserved: DecimalStr = "0"


class Snapshot(Strict):
    """Authoritative state a proposal is evaluated against.

    The shape matches `packages/shared-types/policy-vectors.json` (minus `intent`), so
    the cross-implementation vectors load directly into this model.
    """

    vault_id: AccountId
    owner_id: AccountId
    agent_id: AccountId | None
    attestor_id: AccountId
    now_ms: DecimalStr
    paused: bool = False
    policy: Policy
    authorization: Authorization | None
    authorization_budget: Budget = Budget()
    daily_budget: Budget = Budget()
    agent_nonce: DecimalStr = "0"
    available_balance: DecimalStr | None = None
    source: Literal["LOCAL_SIMULATION", "NEAR_TESTNET", "FIXTURE"] = "FIXTURE"


class Check(Strict):
    invariant: str
    passed: bool
    detail: str


class Finding(Strict):
    role: Literal["injection", "fraud", "redteam"]
    severity: Literal["info", "warning", "critical"]
    code: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    detail: str = Field(min_length=1, max_length=2000)
    channel: str = Field(default="proposal", max_length=80)
    location: str | None = Field(default=None, max_length=120)
    excerpt: str | None = Field(default=None, max_length=400)
    invariant: str | None = Field(default=None, max_length=80)


class ToolResult(Strict):
    tool: str = Field(min_length=1, max_length=60)
    output: str = Field(max_length=8000)


class Message(Strict):
    sender: str = Field(min_length=1, max_length=120)
    body: str = Field(max_length=8000)


class AgentContext(Strict):
    """Everything the transaction agent reads. All of it is untrusted data."""

    authorization_id: str = Field(min_length=1, max_length=80)
    objective: str = Field(min_length=1, max_length=400)
    invoice: str = Field(min_length=1, max_length=20000)
    tool_results: list[ToolResult] = Field(default_factory=list, max_length=8)
    messages: list[Message] = Field(default_factory=list, max_length=8)


class ToolCall(Strict):
    tool: str
    arguments: dict
    result: str | None = None


class Proposal(Strict):
    """What the (possibly compromised) agent decided to do, with its own trace."""

    intent: Intent
    extracted: dict
    tool_calls: list[ToolCall]
    notes: list[str]
    mode: InferenceMode


class LifecycleStep(Strict):
    step: str
    actor: Literal["AGENT", "ATTESTOR", "COMPROMISED_ATTESTOR", "OWNER", "VAULT"]
    outcome: Literal["ACCEPTED", "REJECTED", "APPROVED", "DENIED", "EXECUTED", "FAILED", "SKIPPED"]
    codes: list[str] = Field(default_factory=list)
    detail: str = ""


class RunTrace(Strict):
    """One side of the counterfactual twin: an input, the proposal it produced, and
    exactly what the vault does with that proposal."""

    label: Literal["reference", "adversarial"]
    context_digest: Digest
    context: AgentContext
    proposal: Proposal
    intent_hash: Digest
    policy_results: list[Check]
    violations: list[str]
    execution_eligible: bool
    lifecycle: list[LifecycleStep]
    simulation_result: Literal["EXECUTED", "BLOCKED", "FAILED"]


class Variation(Strict):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["field", "input"]
    description: str = Field(max_length=300)
    challenged_invariant: str = Field(max_length=80)
    proposal: Intent
    agent_followed_injection: bool | None = None
    violations: list[str]
    eligible: bool


class Receipt(Strict):
    """Counterfactual Verification Receipt (CVR)."""

    receipt_version: Literal["aegis.cvr/1"] = "aegis.cvr/1"
    intent_hash: Digest
    intent: Intent
    authorization_id: str
    policy_version: DecimalStr
    invoice_fingerprint: Digest
    agent_id: AccountId
    evaluation_timestamp: DecimalStr
    expiration: DecimalStr
    adversarial_test_ids: list[str] = Field(min_length=1, max_length=64)
    reference_run_hash: Digest
    adversarial_run_hash: Digest
    security_findings: list[Finding] = Field(max_length=64)
    deterministic_policy_results: list[Check]
    attestor_id: AccountId
    evidence_merkle_root_or_hash: Digest
    final_decision: Literal["ALLOW", "BLOCK"]
    attestation_transaction_hash: str | None = None
    execution_mode: ExecutionMode = "LOCAL_SIMULATION"
    inference_mode: InferenceMode = "OFFLINE_HEURISTIC"
    evidence: dict
    receipt_hash: Digest
