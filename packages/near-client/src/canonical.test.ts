import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { encodeIntent, hashIntent, nearToYoctoExact, unsignedInteger, type IntentFields } from './canonical.js';
import { assertSeparatedPrincipals, assertSingleSigningRole, assertTestnetNetwork, rpcUrls, testnetAccount } from './config.js';
import { boundIntentMethod, failureMessage, violatedInvariants, vaultEvents } from './outcome.js';

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../shared-types/canonical-vectors.json'), 'utf8'));
const base: IntentFields = vectors.vectors[0].intent;

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { fn(); } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test('Borsh encoding matches the Rust vectors', () => {
  for (const v of vectors.vectors) {
    assert.equal(encodeIntent(v.intent).toString('hex'), v.borsh_hex, v.name);
    assert.equal(hashIntent(v.intent), v.sha256, v.name);
  }
});

test('exact decimal NEAR conversion', () => {
  assert.equal(nearToYoctoExact('0.05'), '50000000000000000000000');
  assert.equal(nearToYoctoExact('0.000000000000000000000001'), '1');
  for (const bad of ['1e-3', '-1', '0.0000000000000000000000001']) assert.throws(() => nearToYoctoExact(bad));
  assert.throws(() => unsignedInteger('01', 64));
  assert.throws(() => unsignedInteger((1n << 128n).toString(), 128));
});

test('every identity field is bound into the hash', () => {
  for (const key of Object.keys(base) as (keyof IntentFields)[]) {
    const numeric = ['amount', 'nonce', 'expires_at_ms', 'policy_version'].includes(key);
    const changed = { ...base, [key]: numeric ? (BigInt(base[key]) + 1n).toString() : `${base[key]}x` };
    assert.notEqual(hashIntent(changed), hashIntent(base), key);
  }
});

test('mainnet accounts and endpoints are refused', () => {
  assert.equal(testnetAccount('owner.testnet'), 'owner.testnet');
  assert.throws(() => testnetAccount('owner.near'));
  assert.throws(() => testnetAccount('../owner.testnet'));
  withEnv({ NEAR_NETWORK_ID: 'mainnet' }, () => assert.throws(assertTestnetNetwork));
  withEnv({ NEAR_RPC_URL: 'https://rpc.mainnet.near.org' }, () => assert.throws(rpcUrls));
  withEnv({ NEAR_RPC_URL: 'http://evil.example' }, () => assert.throws(rpcUrls));
});

test('principals must be distinct and each process signs as one role', () => {
  const ids = { NEAR_OWNER_ID: 'o.testnet', NEAR_AGENT_ID: 'a.testnet', NEAR_ATTESTOR_ID: 'a.testnet', NEAR_VAULT_ID: 'v.testnet' };
  withEnv(ids, () => assert.throws(assertSeparatedPrincipals));
  withEnv({ NEAR_AGENT_PRIVATE_KEY: 'ed25519:x', NEAR_OWNER_PRIVATE_KEY: 'ed25519:y' }, () => assert.throws(() => assertSingleSigningRole('AGENT')));
  withEnv({ NEAR_AGENT_PRIVATE_KEY: 'ed25519:x', NEAR_OWNER_PRIVATE_KEY: undefined, NEAR_ATTESTOR_PRIVATE_KEY: undefined, NEAR_VAULT_PRIVATE_KEY: undefined },
    () => assertSingleSigningRole('AGENT'));
});

test('RPC outcomes are bound to the exact vault and intent', () => {
  const intentHash = hashIntent(base);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64');
  const tx = { hash: 'h', signer_id: 'agent.testnet', receiver_id: 'vault.testnet', actions: [{ FunctionCall: { method_name: 'execute_intent', args: encode({ intent_hash: intentHash }) } }] };
  assert.equal(boundIntentMethod(tx, 'vault.testnet', intentHash), 'execute_intent');
  assert.throws(() => boundIntentMethod(tx, 'other.testnet', intentHash));
  assert.throws(() => boundIntentMethod(tx, 'vault.testnet', '0'.repeat(64)));
  const submit = { ...tx, actions: [{ FunctionCall: { method_name: 'submit_intent', args: encode({ intent: base }) } }] };
  assert.equal(boundIntentMethod(submit, 'vault.testnet', intentHash), 'submit_intent');
});

test('contract panic messages and events are extracted from real outcome shapes', () => {
  const failed = {
    transaction: { hash: 'h', signer_id: 's', receiver_id: 'r', actions: [] },
    status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: 'Smart contract panicked: POLICY_VIOLATION:RECIPIENT_NOT_ALLOWED,AUTHORIZATION_RECIPIENT' } } } } },
    receipts_outcome: [{ outcome: { status: {}, logs: ['EVENT_JSON:{"standard":"aegis","version":"1.0.0","event":"INTENT_DENIED","data":[]}'] } }],
  };
  const message = failureMessage(failed);
  assert.deepEqual(violatedInvariants(message), ['RECIPIENT_NOT_ALLOWED', 'AUTHORIZATION_RECIPIENT']);
  assert.deepEqual(violatedInvariants('Smart contract panicked: INTENT_NOT_ATTESTED'), ['INTENT_NOT_ATTESTED']);
  assert.deepEqual(vaultEvents(failed).map((e) => e.event), ['INTENT_DENIED']);
});

test('the deployed artifact is a pure WebAssembly-MVP module', async () => {
  const { postMvpOpcodes } = await import('../../../scripts/lib/wasm-scan.mjs');
  const wasm = readFileSync(resolve(import.meta.dirname, '../../../artifacts/aegis_vault.wasm'));
  assert.deepEqual(postMvpOpcodes(wasm), {});
});
