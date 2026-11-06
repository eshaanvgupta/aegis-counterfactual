import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { canonicalJson, digest, encodeIntent, intentHash, ORDER, verifyReceipt, violations, type Intent, type Snapshot } from './index.js';

const root = resolve(import.meta.dirname, '../../..');
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const merge = (base: any, patch: any): any => {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : v;
  return out;
};

test('Borsh encoding and hashes match the Rust canonical vectors', () => {
  for (const v of read('packages/shared-types/canonical-vectors.json').vectors) {
    assert.equal(Buffer.from(encodeIntent(v.intent)).toString('hex'), v.borsh_hex, v.name);
    assert.equal(intentHash(v.intent), v.sha256, v.name);
  }
});

test('policy mirror matches every contract policy vector', () => {
  const fixture = read('packages/shared-types/policy-vectors.json');
  assert.deepEqual([...ORDER], fixture.order);
  for (const v of fixture.vectors) {
    const state = merge(fixture.base, v.patch);
    const { intent, ...snapshot } = state as { intent: Intent } & Snapshot;
    assert.deepEqual(violations(intent, snapshot as Snapshot), v.violations, v.name);
  }
});

test('canonical JSON matches the Python encoding rules', () => {
  assert.equal(canonicalJson({ b: 1, a: '₹', c: [true, null] }), '{"a":"₹","b":1,"c":[true,null]}');
  assert.throws(() => canonicalJson({ x: 0.5 }));
});

test('every shipped receipt (Python-generated, some attested on testnet) verifies independently', () => {
  const dir = resolve(root, 'examples/receipts');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 3);
  for (const file of files) {
    const result = verifyReceipt(read(`examples/receipts/${file}`));
    assert.deepEqual(result.errors, [], file);
    assert.equal(result.integrity, 'INTEGRITY VERIFIED');
  }
});

test('tampering is detected by the TypeScript verifier too', () => {
  const receipt = read('examples/receipts/blocked.json');
  const flipped = { ...receipt, final_decision: 'ALLOW' };
  const { receipt_hash: _, ...body } = flipped;
  flipped.receipt_hash = digest(body);
  assert.equal(verifyReceipt(flipped).policy, 'POLICY FAILED');
  const edited = structuredClone(receipt);
  edited.evidence.findings[0].detail = 'nothing to see here';
  assert.equal(verifyReceipt(edited).integrity, 'INTEGRITY FAILED');
  assert.equal(verifyReceipt({}).decision, 'BLOCK');
});
