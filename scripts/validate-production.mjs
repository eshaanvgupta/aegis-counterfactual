#!/usr/bin/env node
/** Validate a production environment without printing any credential material. */
import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = process.argv[2];
if (envFile) {
  const resolved = path.resolve(envFile);
  if (!existsSync(resolved)) throw new Error(`Environment file not found: ${resolved}`);
  process.loadEnvFile(resolved);
}

const required = [
  'AEGIS_PUBLIC_ORIGIN', 'AEGIS_OWNER_TOKEN', 'AEGIS_VERIFIER_TOKEN',
  'NEAR_VAULT_ID', 'NEAR_OWNER_ID', 'NEAR_AGENT_ID', 'NEAR_ATTESTOR_ID', 'NEAR_RECIPIENT_ID',
  'NEAR_OWNER_PRIVATE_KEY', 'NEAR_AGENT_PRIVATE_KEY', 'NEAR_ATTESTOR_PRIVATE_KEY',
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing required production variables: ${missing.join(', ')}`);

const value = (name) => process.env[name] ?? '';
const rejectPlaceholder = (name) => {
  if (/replace|example|changeme|your[-_]/i.test(value(name))) throw new Error(`${name} still contains a placeholder`);
};
required.forEach(rejectPlaceholder);

if ((process.env.AEGIS_MODE ?? 'TESTNET') !== 'TESTNET') throw new Error('Production runtime must use AEGIS_MODE=TESTNET');
if ((process.env.NEAR_NETWORK_ID ?? 'testnet') !== 'testnet') throw new Error('NEAR_NETWORK_ID must be testnet');
if (process.env.NEAR_VAULT_PRIVATE_KEY) throw new Error('Runtime services must not receive NEAR_VAULT_PRIVATE_KEY');

const origin = new URL(value('AEGIS_PUBLIC_ORIGIN'));
const localOrigin = ['localhost', '127.0.0.1'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && localOrigin)) {
  throw new Error('AEGIS_PUBLIC_ORIGIN must use HTTPS (local HTTP is accepted for staging)');
}
if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('AEGIS_PUBLIC_ORIGIN must be an origin only, without a path, query, fragment or credentials');
}

const tokens = ['AEGIS_OWNER_TOKEN', 'AEGIS_VERIFIER_TOKEN'].map(value);
if (tokens.some((token) => token.length < 48)) throw new Error('Owner and verifier tokens must each contain at least 48 characters');
if (new Set(tokens).size !== tokens.length) throw new Error('Owner and verifier tokens must be independent');

const accountPattern = /^(?:(?:[a-z0-9]+(?:[-_][a-z0-9]+)*)\.)+testnet$|^[0-9a-f]{64}$/;
const accountNames = ['NEAR_VAULT_ID', 'NEAR_OWNER_ID', 'NEAR_AGENT_ID', 'NEAR_ATTESTOR_ID', 'NEAR_RECIPIENT_ID'];
const accounts = accountNames.map(value);
for (const [index, account] of accounts.entries()) {
  if (!accountPattern.test(account) || account.length > 64) throw new Error(`${accountNames[index]} must be a valid testnet account`);
}
if (new Set(accounts.slice(0, 4)).size !== 4) throw new Error('Vault, owner, agent and attestor accounts must be distinct');

const keyNames = ['NEAR_OWNER_PRIVATE_KEY', 'NEAR_AGENT_PRIVATE_KEY', 'NEAR_ATTESTOR_PRIVATE_KEY'];
const keyPattern = /^ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}$/;
const keys = keyNames.map(value);
for (const [index, key] of keys.entries()) {
  if (!keyPattern.test(key)) throw new Error(`${keyNames[index]} is not a valid ed25519 private-key encoding`);
}
if (new Set(keys).size !== keys.length) throw new Error('Each runtime role must use an independent private key');

const provider = process.env.LLM_PROVIDER ?? 'offline';
if (provider !== 'offline' && process.env.AEGIS_ALLOW_PAID_LLM !== 'true') {
  throw new Error('Remote inference requires the explicit AEGIS_ALLOW_PAID_LLM=true operator gate');
}
if (provider !== 'offline' && !process.env.LLM_API_KEY) throw new Error('Remote inference requires LLM_API_KEY');

console.log(JSON.stringify({
  status: 'PRODUCTION_CONFIGURATION_VALID',
  origin: origin.origin,
  mode: 'TESTNET',
  inference: provider,
  principals: Object.fromEntries(accountNames.map((name, index) => [name, accounts[index]])),
  isolation: 'VAULT KEY ABSENT; OWNER / AGENT / ATTESTOR KEYS DISTINCT',
}, null, 2));

