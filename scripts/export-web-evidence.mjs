#!/usr/bin/env node
/**
 * Copies recorded, public evidence into apps/web/public/evidence so the web app can run as a
 * static, key-less evidence viewer. Only artifacts that are safe to publish are copied:
 * testnet transaction evidence, deployment metadata, the offline benchmark, and example receipts.
 * Nothing from runtime/ (tokens, credentials, databases) is ever read here.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/web/public/evidence');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'receipts'), { recursive: true });

const required = [
  ['artifacts/testnet-evidence.json', 'testnet-evidence.json'],
  ['artifacts/testnet-deployment.json', 'testnet-deployment.json'],
  ['artifacts/benchmark-offline.json', 'lab-runs.json'],
  ['artifacts/contract-build.json', 'contract-build.json'],
  ['artifacts/probe-mandate.json', 'probe-mandate.json'],
];
for (const [from, to] of required) {
  const source = join(root, from);
  if (!existsSync(source)) throw new Error(`Missing ${from}. Run the pipeline that produces it first.`);
  copyFileSync(source, join(out, to));
}

const LABELS = {
  'testnet-blocked.json': 'NEAR testnet · invoice injection BLOCKED (attested on-chain)',
  'testnet-allowed.json': 'NEAR testnet · legitimate payment ALLOWED (executed on-chain)',
  'blocked.json': 'Local simulation · invoice injection BLOCKED',
  'allowed.json': 'Local simulation · legitimate payment ALLOWED',
  'tool-poisoning-blocked.json': 'Local simulation · tool-output poisoning BLOCKED',
};
const order = Object.keys(LABELS);
const receipts = readdirSync(join(root, 'examples/receipts')).filter((f) => f.endsWith('.json'))
  .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
const files = [];
for (const name of receipts) {
  const body = readFileSync(join(root, 'examples/receipts', name), 'utf8');
  JSON.parse(body);
  writeFileSync(join(out, 'receipts', name), body);
  files.push({ name, label: LABELS[name] ?? name });
}
writeFileSync(join(out, 'receipts/index.json'), JSON.stringify({ files }, null, 2) + '\n');
console.log(`Exported ${required.length} artifacts and ${files.length} receipts to apps/web/public/evidence`);
