#!/usr/bin/env node
/**
 * Start the workstation: verifier (8001), agent (8000), owner console (8002) and web (3000).
 *
 *   node scripts/dev.mjs              LOCAL_SIMULATION, no keys, no network
 *   node scripts/dev.mjs --testnet    TESTNET: each service runs as one principal
 *   node scripts/dev.mjs --no-web     services only (used by the e2e scripts)
 *   node scripts/dev.mjs --production serve the built web app (next start)
 *
 * Isolation: the agent never receives the owner token or any non-AGENT key; the verifier
 * never receives the owner token or any non-ATTESTOR key; the browser receives nothing.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const args = new Set(process.argv.slice(2));
const testnet = args.has('--testnet');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('Python environment missing. Run `pnpm run setup` first.');
  process.exit(1);
}
if (testnet && !existsSync('runtime/dev-credentials/manifest.json') && !process.env.NEAR_VAULT_ID) {
  console.error('No testnet identities. Run `pnpm testnet:provision` (or set NEAR_* variables) first.');
  process.exit(1);
}
mkdirSync('runtime', { recursive: true });
const token = (name) => process.env[name] || randomBytes(32).toString('hex');
const ownerToken = token('AEGIS_OWNER_TOKEN');
const verifierToken = token('AEGIS_VERIFIER_TOKEN');
writeFileSync('runtime/owner-token.txt', ownerToken, { mode: 0o600 });

const base = { ...process.env, PYTHONPATH: path.join(root, 'services/replay-engine'), AEGIS_MODE: testnet ? 'TESTNET' : 'LOCAL_SIMULATION', PYTHONUNBUFFERED: '1' };
for (const key of Object.keys(base)) if (/^(NEAR_.*PRIVATE_KEY|AEGIS_(OWNER|VERIFIER)_TOKEN)$/.test(key)) delete base[key];

const services = [
  { name: 'verifier', role: 'ATTESTOR', dir: 'verifier-api', port: 8001, env: { AEGIS_VERIFIER_TOKEN: verifierToken } },
  { name: 'agent', role: 'AGENT', dir: 'agent-api', port: 8000, env: { AEGIS_VERIFIER_TOKEN: verifierToken, AEGIS_VERIFIER_URL: 'http://127.0.0.1:8001' } },
  { name: 'owner', role: 'OWNER', dir: 'owner-api', port: 8002, env: { AEGIS_OWNER_TOKEN: ownerToken } },
];

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}
function start(name, command, argv, env) {
  const child = spawn(command, argv, { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
  children.push(child);
  child.on('error', (error) => { console.error(`[${name}] ${error.message}`); stop(1); });
  child.on('exit', (code) => { if (!stopping && code !== 0) { console.error(`[${name}] exited with ${code}`); stop(code || 1); } });
}

for (const svc of services) {
  const env = { ...base, ...svc.env, AEGIS_ROLE: svc.role };
  const uvicorn = ['-m', 'uvicorn', 'main:app', '--app-dir', path.join(root, 'services', svc.dir), '--host', '127.0.0.1', '--port', String(svc.port), '--log-level', 'warning'];
  if (testnet) start(svc.name, process.execPath, [path.join(root, 'scripts/testnet-role.mjs'), svc.role, python, ...uvicorn], env);
  else start(svc.name, python, uvicorn, env);
}

if (!args.has('--no-web')) {
  const webEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(webEnv)) if (/^(NEAR_|LLM_|AEGIS_)/.test(key)) delete webEnv[key];
  const nextBin = path.join(root, 'apps/web/node_modules/next/dist/bin/next');
  start('web', process.execPath, [nextBin, args.has('--production') ? 'start' : 'dev', path.join(root, 'apps/web'), '--hostname', '127.0.0.1', '--port', '3000'], webEnv);
}

console.log(`\nAEGIS // COUNTERFACTUAL — ${testnet ? 'TESTNET (real NEAR transactions)' : 'LOCAL_SIMULATION (no keys, no network)'}`);
console.log('  Workstation  http://127.0.0.1:3000');
console.log('  Agent API    http://127.0.0.1:8000/docs   Verifier http://127.0.0.1:8001/docs   Owner http://127.0.0.1:8002/docs');
console.log('  Owner token  runtime/owner-token.txt (paste into Policy Vault to sign owner actions)\n');
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop());
