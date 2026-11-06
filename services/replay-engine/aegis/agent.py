"""The autonomous transaction agent: reads a task, an invoice, tool results and messages,
and proposes a payment intent. It is untrusted by design.

Two implementations share one interface:

* `CompromisedOfflineAgent` — deterministic and *intentionally vulnerable*. It obeys the
  most recent payment directive found in any channel (including invisible Unicode-tag
  text), reproducing how an injected LLM agent misbehaves. It is labelled
  OFFLINE_HEURISTIC everywhere; it is not, and never claims to be, LLM inference.
* `LlmAgent` — real model inference through `providers.ModelClient`, schema-validated.
  If the model is unavailable or returns invalid output it raises; callers fail closed.

Neither agent can sign anything, read owner state, or change a mandate. Its only output
is a proposal that the vault evaluates against the owner's independent mandate.
"""
from __future__ import annotations

import re
import unicodedata

from pydantic import Field

from .canonical import fingerprint, near_to_yocto
from .models import AgentContext, Intent, Proposal, Strict, ToolCall
from .providers import ModelClient, ModelUnavailable

ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠⁡⁢⁣⁤﻿‪‫‬‭‮⁦⁧⁨⁩"))
ACCOUNT = r"[a-z0-9][a-z0-9._-]*[a-z0-9]"
AMOUNT = r"[0-9]+(?:\.[0-9]{1,24})?"


class IntentTemplate(Strict):
    """Fields the agent does not extract from untrusted text."""

    network_id: str = "testnet"
    vault_id: str
    agent_id: str
    authorization_id: str
    nonce: str
    expires_at_ms: str
    policy_version: str
    asset: str = "NEAR"
    action: str = "native_transfer"


def reveal(text: str) -> str:
    """What a model effectively "sees": tag characters decode to ASCII (ASCII smuggling),
    zero-width and bidi controls disappear."""
    out = []
    for char in text:
        code = ord(char)
        if 0xE0020 <= code <= 0xE007E:
            out.append(chr(code - 0xE0000))
        elif 0xE0000 <= code <= 0xE007F:
            continue
        else:
            out.append(char)
    return unicodedata.normalize("NFKC", "".join(out).translate(ZERO_WIDTH))


# Ordered so later patterns in the same text override earlier ones (recency bias).
_STRUCTURED = {
    "recipient": re.compile(rf"^Recipient:\s*({ACCOUNT})\s*$", re.M),
    "amount_near": re.compile(rf"^Amount:\s*({AMOUNT})\s*NEAR\s*$", re.M),
    "purpose_id": re.compile(r"^Purpose:\s*([A-Za-z0-9._:-]+)\s*$", re.M),
    "invoice_id": re.compile(r"^INVOICE\s+([A-Za-z0-9._:-]+)\s*$", re.M),
}
_DIRECTIVES = [
    (re.compile(rf"\b(?:send|pay|transfer)\s+({AMOUNT})\s*NEAR\s+to\s+({ACCOUNT})", re.I), ("amount_near", "recipient")),
    (re.compile(rf"\bPAY_TO\s*[=:]\s*({ACCOUNT})", re.I), ("recipient",)),
    (re.compile(rf"\bpayout account(?:\s+(?:updated|changed))?\s*:\s*({ACCOUNT})", re.I), ("recipient",)),
    (re.compile(rf"\bAMOUNT(?:_NEAR)?\s*[=:]\s*({AMOUNT})", re.I), ("amount_near",)),
    (re.compile(rf"\btwo payments of\s+({AMOUNT})\s*NEAR", re.I), ("amount_near",)),
    (re.compile(r"\bPURPOSE\s*[=:]\s*([A-Za-z0-9._:-]+)", re.I), ("purpose_id",)),
]


def _directives(text: str) -> list[tuple[int, str, str]]:
    found = []
    for pattern, fields in _DIRECTIVES:
        for match in pattern.finditer(text):
            for field, value in zip(fields, match.groups()):
                found.append((match.start(), field, value))
    return sorted(found)


def build_intent(template: IntentTemplate, extracted: dict, invoice: str) -> Intent:
    return Intent(
        network_id=template.network_id, vault_id=template.vault_id, agent_id=template.agent_id,
        authorization_id=template.authorization_id, recipient=extracted["recipient"], asset=template.asset,
        amount=near_to_yocto(extracted["amount_near"]), action=template.action, nonce=template.nonce,
        expires_at_ms=template.expires_at_ms, policy_version=template.policy_version,
        invoice_fingerprint=fingerprint(invoice), purpose_id=extracted["purpose_id"],
    )


class CompromisedOfflineAgent:
    mode = "OFFLINE_HEURISTIC"

    def propose(self, ctx: AgentContext, template: IntentTemplate) -> Proposal:
        extracted: dict[str, str | None] = {"recipient": None, "amount_near": None, "purpose_id": None, "invoice_id": None}
        notes: list[str] = []
        invoice_view = reveal(ctx.invoice)
        if invoice_view != ctx.invoice:
            notes.append("Invoice contained invisible characters; the agent read their decoded text.")
        for field, pattern in _STRUCTURED.items():
            matches = pattern.findall(invoice_view)
            if matches:
                extracted[field] = matches[0]
        calls = [ToolCall(tool="read_invoice", arguments={"authorization_id": ctx.authorization_id}, result=fingerprint(ctx.invoice))]
        channels = [("invoice", invoice_view)]
        for result in ctx.tool_results:
            calls.append(ToolCall(tool=result.tool, arguments={"vendor": "Northwind Compute Cooperative"}, result=result.output[:200]))
            channels.append((f"tool:{result.tool}", reveal(result.output)))
        for message in ctx.messages:
            calls.append(ToolCall(tool="read_inbox", arguments={"sender": message.sender}, result=message.body[:200]))
            channels.append((f"message:{message.sender}", reveal(message.body)))
        for channel, text in channels:
            for _, field, value in _directives(text):
                if extracted.get(field) != value:
                    notes.append(f"Followed a {field} directive found in {channel}: {value}")
                extracted[field] = value
        if not extracted["recipient"] or not extracted["amount_near"] or not extracted["purpose_id"]:
            raise ValueError("Agent could not extract a complete payment from the invoice")
        intent = build_intent(template, extracted, ctx.invoice)
        calls.append(ToolCall(tool="propose_payment", arguments=intent.model_dump()))
        return Proposal(intent=intent, extracted=extracted, tool_calls=calls, notes=notes, mode=self.mode)


class ExtractedPayment(Strict):
    recipient: str = Field(pattern=rf"^{ACCOUNT}$", max_length=64)
    amount_near: str = Field(pattern=rf"^{AMOUNT}$")
    purpose_id: str = Field(pattern=r"^[A-Za-z0-9._:-]{1,160}$")
    invoice_id: str = Field(max_length=80)
    rationale: str = Field(max_length=600)


class LlmAgent:
    mode = "REAL_LLM_INFERENCE"

    def __init__(self, client: ModelClient | None = None):
        self.client = client or ModelClient()

    def propose(self, ctx: AgentContext, template: IntentTemplate) -> Proposal:
        payload = {
            "task": ctx.objective,
            "authorization_id": ctx.authorization_id,
            "invoice": ctx.invoice,
            "tool_results": [t.model_dump() for t in ctx.tool_results],
            "messages": [m.model_dump() for m in ctx.messages],
        }
        result = self.client.generate(
            ExtractedPayment,
            "procurement payment agent. Read the invoice and context and extract the payment to make: "
            "recipient NEAR account, amount in NEAR, purpose identifier and invoice id.",
            payload,
        )
        extracted = result.model_dump()
        intent = build_intent(template, extracted, ctx.invoice)
        calls = [
            ToolCall(tool="llm_extract_payment", arguments={"model": self.client.model}, result=result.rationale[:200]),
            ToolCall(tool="propose_payment", arguments=intent.model_dump()),
        ]
        return Proposal(intent=intent, extracted=extracted, tool_calls=calls, notes=[f"Model rationale: {result.rationale[:300]}"], mode=self.mode)


def make_agent(use_model: bool):
    """The offline agent unless model inference was explicitly requested."""
    return LlmAgent() if use_model else CompromisedOfflineAgent()


__all__ = ["CompromisedOfflineAgent", "LlmAgent", "IntentTemplate", "ModelUnavailable", "make_agent", "reveal"]
