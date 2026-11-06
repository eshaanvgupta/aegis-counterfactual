/**
 * Independent TypeScript verifier for Counterfactual Verification Receipts.
 *
 * A second, separately written implementation of the canonical intent encoding, the
 * deterministic policy (mirroring the vault contract), canonical JSON, the evidence
 * Merkle root, and receipt verification. It runs in the browser and in Node, with no
 * network access. The test suite proves it agrees with the Rust contract (policy vectors)
 * and with the Python verifier (shipped receipts).
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export interface Intent {
  network_id: string; vault_id: string; agent_id: string; authorization_id: string; recipient: string; asset: string;
  amount: string; action: string; nonce: string; expires_at_ms: string; policy_version: string; invoice_fingerprint: string; purpose_id: string;
}
export interface Policy { version: string; allowed_recipients: string[]; max_transaction: string; daily_limit: string; allowed_actions: string[]; expires_at_ms: string }
export interface Authorization {
  id: string; owner_id: string; agent_id: string; recipient: string; amount: string; max_total: string; asset: string; purpose_id: string;
  invoice_fingerprint: string; expires_at_ms: string; policy_version: string; action: string; revoked: boolean;
}
export interface Budget { spent: string; reserved: string }
export interface Snapshot {
  vault_id: string; owner_id: string; agent_id: string | null; attestor_id: string; now_ms: string; paused: boolean; policy: Policy;
  authorization: Authorization | null; authorization_budget: Budget; daily_budget: Budget; [key: string]: unknown;
}
export interface Check { invariant: string; passed: boolean; detail: string }

export const ORDER = [
  'VAULT_PAUSED', 'WRONG_DOMAIN', 'AGENT_NOT_REGISTERED', 'UNSUPPORTED_ACTION', 'RECIPIENT_NOT_ALLOWED', 'MAX_TRANSACTION',
  'POLICY_VERSION', 'INTENT_EXPIRED', 'AUTHORIZATION_NOT_FOUND', 'AUTHORIZATION_REVOKED', 'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_PRINCIPAL', 'AUTHORIZATION_POLICY_VERSION', 'AUTHORIZATION_RECIPIENT', 'AUTHORIZATION_AMOUNT',
  'AUTHORIZATION_ACTION', 'INVOICE_MISMATCH', 'PURPOSE_MISMATCH', 'AUTHORIZATION_BUDGET', 'DAILY_BUDGET',
] as const;
const U128_MAX = (1n << 128n) - 1n;
const SECTIONS = ['snapshot', 'reference', 'adversarial', 'variations', 'findings', 'provenance'] as const;

export const sha256Hex = (data: Uint8Array | string): string => bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
export const fingerprint = (text: string): string => sha256Hex(text);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function borshString(value: string): Uint8Array {
  const bytes = utf8ToBytes(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.length, true);
  return concat([length, bytes]);
}
function borshUint(value: string, bytes: 8 | 16): Uint8Array {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Expected a canonical decimal integer');
  let n = BigInt(value);
  if (n >= 1n << BigInt(bytes * 8)) throw new Error(`Integer exceeds u${bytes * 8}`);
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}

/** Borsh `IntentFields` (field order is part of the format) → SHA-256 hex. */
export function encodeIntent(i: Intent): Uint8Array {
  return concat([
    ...[i.network_id, i.vault_id, i.agent_id, i.authorization_id, i.recipient, i.asset].map(borshString),
    borshUint(i.amount, 16), borshString(i.action), borshUint(i.nonce, 8), borshUint(i.expires_at_ms, 8),
    borshUint(i.policy_version, 8), borshString(i.invoice_fingerprint), borshString(i.purpose_id),
  ]);
}
export const intentHash = (i: Intent): string => sha256Hex(encodeIntent(i));

/** Sorted keys, no whitespace, UTF-8; non-integer numbers are rejected (as in Python). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('Floats are not allowed in canonical evidence');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Unsupported canonical value ${typeof value}`);
}
export const digest = (value: unknown): string => sha256Hex(canonicalJson(value));
export const leafHash = (name: string, value: unknown): string => sha256Hex(concat([utf8ToBytes('aegis.leaf:'), utf8ToBytes(canonicalJson({ name, value }))]));
const node = (left: string, right: string): string => sha256Hex(concat([utf8ToBytes('aegis.node:'), hexToBytes(left), hexToBytes(right)]));
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function merkleRoot(leaves: string[]): string {
  if (!leaves.length) throw new Error('Merkle tree needs at least one leaf');
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) next.push(node(level[i], level[i + 1]));
    if (level.length % 2) next.push(level[level.length - 1]);
    level = next;
  }
  return level[0];
}

const fits = (limit: bigint, ...parts: bigint[]): boolean => { const t = parts.reduce((a, b) => a + b, 0n); return t <= U128_MAX && t <= limit; };

/** Mirror of `Vault::violations` in contracts/aegis-vault/src/lib.rs. */
export function violations(intent: Intent, s: Snapshot): string[] {
  const now = BigInt(s.now_ms), p = s.policy, amount = BigInt(intent.amount), found: string[] = [];
  if (s.paused) found.push('VAULT_PAUSED');
  if (intent.network_id !== 'testnet' || intent.vault_id !== s.vault_id) found.push('WRONG_DOMAIN');
  if (s.agent_id !== intent.agent_id) found.push('AGENT_NOT_REGISTERED');
  if (intent.asset !== 'NEAR' || intent.action !== 'native_transfer' || !p.allowed_actions.includes(intent.action)) found.push('UNSUPPORTED_ACTION');
  if (!p.allowed_recipients.includes(intent.recipient)) found.push('RECIPIENT_NOT_ALLOWED');
  if (amount === 0n || amount > BigInt(p.max_transaction)) found.push('MAX_TRANSACTION');
  if (intent.policy_version !== p.version) found.push('POLICY_VERSION');
  if (now >= BigInt(intent.expires_at_ms) || now >= BigInt(p.expires_at_ms)) found.push('INTENT_EXPIRED');
  const a = s.authorization && s.authorization.id === intent.authorization_id ? s.authorization : null;
  if (!a) found.push('AUTHORIZATION_NOT_FOUND');
  else {
    if (a.revoked) found.push('AUTHORIZATION_REVOKED');
    if (now >= BigInt(a.expires_at_ms) || BigInt(intent.expires_at_ms) > BigInt(a.expires_at_ms)) found.push('AUTHORIZATION_EXPIRED');
    if (a.agent_id !== intent.agent_id || a.owner_id !== s.owner_id) found.push('AUTHORIZATION_PRINCIPAL');
    if (a.policy_version !== p.version) found.push('AUTHORIZATION_POLICY_VERSION');
    if (a.recipient !== intent.recipient) found.push('AUTHORIZATION_RECIPIENT');
    if (a.amount !== intent.amount) found.push('AUTHORIZATION_AMOUNT');
    if (a.asset !== intent.asset || a.action !== intent.action) found.push('AUTHORIZATION_ACTION');
    if (a.invoice_fingerprint !== intent.invoice_fingerprint) found.push('INVOICE_MISMATCH');
    if (a.purpose_id !== intent.purpose_id) found.push('PURPOSE_MISMATCH');
    if (!fits(BigInt(a.max_total), BigInt(s.authorization_budget.spent), BigInt(s.authorization_budget.reserved), amount)) found.push('AUTHORIZATION_BUDGET');
  }
  if (!fits(BigInt(p.daily_limit), BigInt(s.daily_budget.spent), BigInt(s.daily_budget.reserved), amount)) found.push('DAILY_BUDGET');
  return found;
}

export interface Verification {
  integrity: 'INTEGRITY VERIFIED' | 'INTEGRITY FAILED';
  policy: 'POLICY VERIFIED' | 'POLICY FAILED';
  on_chain: string;
  ai_analysis: 'ANALYSIS ADVISORY';
  decision: 'ALLOW' | 'BLOCK';
  errors: string[];
  verifier: 'typescript';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function verifyReceipt(r: any): Verification {
  const integrity: string[] = [];
  const policy: string[] = [];
  try {
    const e = r?.evidence;
    if (!e || SECTIONS.some((s) => !(s in e))) throw new Error('Evidence is missing sections');
    const snap: Snapshot = e.snapshot;
    const bind = (ok: boolean, label: string) => { if (!ok) integrity.push(label); };
    const { receipt_hash: claimed, ...body } = r;
    bind(claimed === digest(body), 'receipt hash does not recompute');
    bind(r.intent_hash === intentHash(r.intent), 'canonical intent hash does not recompute');
    bind(r.evidence_merkle_root_or_hash === merkleRoot(SECTIONS.map((s) => leafHash(s, e[s]))), 'evidence Merkle root does not recompute');
    bind(r.reference_run_hash === digest(e.reference), 'reference run hash does not recompute');
    bind(r.adversarial_run_hash === digest(e.adversarial), 'adversarial run hash does not recompute');
    bind(canonicalJson(e.adversarial.proposal.intent) === canonicalJson(r.intent), 'reviewed intent is not the adversarial proposal');
    for (const [field, key] of [['authorization_id', 'authorization_id'], ['policy_version', 'policy_version'], ['invoice_fingerprint', 'invoice_fingerprint'], ['agent_id', 'agent_id'], ['expiration', 'expires_at_ms']] as const) {
      bind(r[field] === r.intent[key], `${field} binding`);
    }
    bind(r.evaluation_timestamp === snap.now_ms, 'evaluation timestamp binding');
    bind(r.attestor_id === snap.attestor_id, 'attestor binding');
    bind(canonicalJson(r.security_findings) === canonicalJson(e.findings), 'findings binding');
    bind(e.variations.every((v: any) => r.adversarial_test_ids.includes(v.id)), 'every variation must be listed in adversarial_test_ids');
    if (snap.authorization) bind(fingerprint(e.reference.context.invoice) === snap.authorization.invoice_fingerprint, 'reference input is not the owner-authorized invoice');
    for (const name of ['reference', 'adversarial'] as const) {
      const t = e[name];
      const found = violations(t.proposal.intent, snap);
      if (canonicalJson(t.violations) !== canonicalJson(found)) policy.push(`${name}: violations do not recompute`);
      if (t.execution_eligible !== (found.length === 0)) policy.push(`${name}: eligibility does not follow from the violations`);
      if (found.length && t.simulation_result === 'EXECUTED') policy.push(`${name}: a violating proposal is recorded as executed`);
      if (t.intent_hash !== intentHash(t.proposal.intent)) policy.push(`${name}: trace intent hash does not recompute`);
      if (t.proposal.intent.invoice_fingerprint !== fingerprint(t.context.invoice)) policy.push(`${name}: fingerprint is not of the invoice the agent read`);
    }
    const failed = new Set(violations(r.intent, snap));
    const checks = r.deterministic_policy_results as Check[];
    if (checks.length !== ORDER.length || checks.some((c, i) => c.invariant !== ORDER[i] || c.passed === failed.has(c.invariant))) policy.push('deterministic policy results do not recompute');
    for (const v of e.variations) {
      const found = violations(v.proposal, snap);
      if (canonicalJson(v.violations) !== canonicalJson(found) || v.eligible !== (found.length === 0)) policy.push(`variation ${v.id} does not recompute`);
    }
    const expected = e.provenance.complete && failed.size === 0 ? 'ALLOW' : 'BLOCK';
    if (r.final_decision !== expected) policy.push(`final decision ${r.final_decision} does not follow from the evidence`);
    const errors = [...integrity, ...policy];
    return { integrity: integrity.length ? 'INTEGRITY FAILED' : 'INTEGRITY VERIFIED', policy: policy.length ? 'POLICY FAILED' : 'POLICY VERIFIED',
      on_chain: 'NOT CHECKED', ai_analysis: 'ANALYSIS ADVISORY', decision: errors.length ? 'BLOCK' : expected, errors, verifier: 'typescript' };
  } catch (error) {
    return { integrity: 'INTEGRITY FAILED', policy: 'POLICY FAILED', on_chain: 'NOT CHECKED', ai_analysis: 'ANALYSIS ADVISORY', decision: 'BLOCK',
      errors: [`malformed receipt: ${error instanceof Error ? error.message : String(error)}`], verifier: 'typescript' };
  }
}
