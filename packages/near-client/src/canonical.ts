import { createHash } from 'node:crypto';

/** Exact Borsh layout shared with contracts/aegis-vault/src/lib.rs. */
export interface IntentFields {
  network_id: string;
  vault_id: string;
  agent_id: string;
  authorization_id: string;
  recipient: string;
  asset: string;
  amount: string;
  action: string;
  nonce: string;
  expires_at_ms: string;
  policy_version: string;
  invoice_fingerprint: string;
  purpose_id: string;
}

export function unsignedInteger(value: string, bits: 64 | 128): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`Expected canonical u${bits} decimal string`);
  const n = BigInt(value);
  if (n >= (1n << BigInt(bits))) throw new Error(`Value exceeds u${bits}`);
  return n;
}

function string(value: string): Buffer {
  if (typeof value !== 'string') throw new Error('Expected string');
  const data = Buffer.from(value, 'utf8');
  if (data.length > 4096) throw new Error('Canonical field exceeds 4096 bytes');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return Buffer.concat([length, data]);
}

function integer(value: string, bits: 64 | 128): Buffer {
  let n = unsignedInteger(value, bits);
  const output = Buffer.alloc(bits / 8);
  for (let i = 0; i < output.length; i++) {
    output[i] = Number(n & 255n);
    n >>= 8n;
  }
  return output;
}

export function encodeIntent(intent: IntentFields): Buffer {
  return Buffer.concat([
    ...[intent.network_id, intent.vault_id, intent.agent_id, intent.authorization_id, intent.recipient, intent.asset].map(string),
    integer(intent.amount, 128),
    string(intent.action),
    integer(intent.nonce, 64),
    integer(intent.expires_at_ms, 64),
    integer(intent.policy_version, 64),
    string(intent.invoice_fingerprint),
    string(intent.purpose_id),
  ]);
}

export function hashIntent(intent: IntentFields): string {
  return createHash('sha256').update(encodeIntent(intent)).digest('hex');
}

export function invoiceFingerprint(invoice: string): string {
  return createHash('sha256').update(invoice, 'utf8').digest('hex');
}

export function nearToYoctoExact(amount: string): string {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/.test(amount)) throw new Error('NEAR amount must be a nonnegative decimal with at most 24 fractional digits');
  const [whole, fraction = ''] = amount.split('.');
  const result = (BigInt(whole) * 10n ** 24n + BigInt(fraction.padEnd(24, '0'))).toString();
  unsignedInteger(result, 128);
  return result;
}
