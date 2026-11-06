/**
 * In-browser port of the deterministic transaction agent (services/replay-engine/aegis/agent.py,
 * `CompromisedOfflineAgent`). Same structured fields, same directive patterns, same recency rule,
 * same invisible-character decoding — so what a visitor types here is interpreted exactly as the
 * backend agent would interpret it. The agent is untrusted by design: it follows injected
 * instructions, and the vault contract is what decides.
 */
import { fingerprint, type Intent } from '@aegis/receipt-verifier';

const ACCOUNT = '[a-z0-9][a-z0-9._-]*[a-z0-9]';
const AMOUNT = '[0-9]+(?:\\.[0-9]{1,24})?';
const ZERO_WIDTH = /[​‌‍⁠-⁤﻿‪-‮⁦-⁩]/g;

/** What a model effectively "sees": Unicode tag characters decode to ASCII, zero-width/bidi controls vanish. */
export function reveal(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 0xe0020 && code <= 0xe007e) out += String.fromCodePoint(code - 0xe0000);
    else if (code >= 0xe0000 && code <= 0xe007f) continue;
    else out += char;
  }
  return out.replace(ZERO_WIDTH, '').normalize('NFKC');
}

/** Encode ASCII as invisible Unicode tag characters (used by the hidden-directive preset). */
export const hide = (text: string): string => [...text].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');

const STRUCTURED: [Field, RegExp][] = [
  ['recipient', new RegExp(`^Recipient:\\s*(${ACCOUNT})\\s*$`, 'm')],
  ['amount_near', new RegExp(`^Amount:\\s*(${AMOUNT})\\s*NEAR\\s*$`, 'm')],
  ['purpose_id', /^Purpose:\s*([A-Za-z0-9._:-]+)\s*$/m],
  ['invoice_id', /^INVOICE\s+([A-Za-z0-9._:-]+)\s*$/m],
];
const DIRECTIVES: [RegExp, Field[]][] = [
  [new RegExp(`\\b(?:send|pay|transfer)\\s+(${AMOUNT})\\s*NEAR\\s+to\\s+(${ACCOUNT})`, 'gi'), ['amount_near', 'recipient']],
  [new RegExp(`\\bPAY_TO\\s*[=:]\\s*(${ACCOUNT})`, 'gi'), ['recipient']],
  [new RegExp(`\\bpayout account(?:\\s+(?:updated|changed))?\\s*:\\s*(${ACCOUNT})`, 'gi'), ['recipient']],
  [new RegExp(`\\bAMOUNT(?:_NEAR)?\\s*[=:]\\s*(${AMOUNT})`, 'gi'), ['amount_near']],
  [new RegExp(`\\btwo payments of\\s+(${AMOUNT})\\s*NEAR`, 'gi'), ['amount_near']],
  [/\bPURPOSE\s*[=:]\s*([A-Za-z0-9._:-]+)/gi, ['purpose_id']],
];

type Field = 'recipient' | 'amount_near' | 'purpose_id' | 'invoice_id';
export type Extracted = Record<Field, string | null>;

function directives(text: string): { at: number; field: Field; value: string }[] {
  const found: { at: number; field: Field; value: string }[] = [];
  for (const [pattern, fields] of DIRECTIVES) {
    for (const match of text.matchAll(pattern)) fields.forEach((field, i) => found.push({ at: match.index ?? 0, field, value: match[i + 1] }));
  }
  return found.sort((a, b) => a.at - b.at || a.field.localeCompare(b.field));
}

/** Exact decimal NEAR → yoctoNEAR (no floating point). */
export function nearToYocto(amount: string): string {
  const text = amount.trim();
  if (!/^[0-9]*\.?[0-9]*$/.test(text) || !/[0-9]/.test(text)) throw new Error(`Invalid NEAR amount ${amount}`);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > 24) throw new Error('NEAR amounts have at most 24 decimal places');
  const value = BigInt(whole || '0') * 10n ** 24n + BigInt((fraction + '0'.repeat(24)).slice(0, 24));
  if (value >= 1n << 128n) throw new Error('Amount exceeds u128');
  return value.toString();
}

export interface Template { vault_id: string; agent_id: string; authorization_id: string; nonce: string; expires_at_ms: string; policy_version: string }
export interface Proposal { intent: Intent | null; extracted: Extracted; notes: string[]; error?: string }

/** Read the invoice and any extra channel (email, tool output) and propose a payment intent. */
export function propose(invoice: string, context: string, template: Template): Proposal {
  const extracted: Extracted = { recipient: null, amount_near: null, purpose_id: null, invoice_id: null };
  const notes: string[] = [];
  const view = reveal(invoice);
  if (view !== invoice) notes.push('Invoice contained invisible characters; the agent read their decoded text.');
  for (const [field, pattern] of STRUCTURED) {
    const match = view.match(pattern);
    if (match) extracted[field] = match[1];
  }
  const channels: [string, string][] = [['invoice', view]];
  if (context.trim()) channels.push(['context', reveal(context)]);
  for (const [channel, text] of channels) {
    for (const { field, value } of directives(text)) {
      if (extracted[field] !== value) notes.push(`Followed a ${field.replace('_near', '')} directive found in the ${channel}: ${value}`);
      extracted[field] = value;
    }
  }
  if (!extracted.recipient || !extracted.amount_near || !extracted.purpose_id) {
    return { intent: null, extracted, notes, error: 'The agent could not extract a complete payment (recipient, amount and purpose).' };
  }
  let amount: string;
  try { amount = nearToYocto(extracted.amount_near); } catch (error) {
    return { intent: null, extracted, notes, error: error instanceof Error ? error.message : String(error) };
  }
  return {
    extracted, notes,
    intent: {
      network_id: 'testnet', vault_id: template.vault_id, agent_id: template.agent_id, authorization_id: template.authorization_id,
      recipient: extracted.recipient, asset: 'NEAR', amount, action: 'native_transfer', nonce: template.nonce,
      expires_at_ms: template.expires_at_ms, policy_version: template.policy_version,
      invoice_fingerprint: fingerprint(invoice), purpose_id: extracted.purpose_id,
    },
  };
}
