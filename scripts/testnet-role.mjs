#!/usr/bin/env node
/**
 * Run one command as exactly one testnet principal.
 *
 *   node scripts/testnet-role.mjs <OWNER|AGENT|ATTESTOR|VAULT|READONLY> <script.ts|script.mjs|executable> [args...]
 *
 * Credentials are read from runtime/dev-credentials/ (created by `pnpm testnet:provision`)
 * or, if that does not exist, from NEAR_<ROLE>_ID / NEAR_<ROLE>_PRIVATE_KEY in the
 * environment or .env. The child receives every role's public account ID but only the
 * selected role's private key; every other NEAR_*_PRIVATE_KEY is removed.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ROLES = ['OWNER', 'AGENT', 'ATTESTOR', 'VAULT'];
const [role, command, ...args] = process.argv.slice(2);

if (![...ROLES, 'READONLY'].includes(role) || !command) {
  console.error('Usage: node scripts/testnet-role.mjs <OWNER|AGENT|ATTESTOR|VAULT|READONLY> <script.ts|script.mjs|executable> [args...]');
  process.exit(1);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^NEAR_.*PRIVATE_KEY$/.test(key)) delete env[key];

const directory = path.join(root, 'runtime/dev-credentials');
const manifestPath = path.join(directory, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.network_id !== 'testnet') fail('Credential manifest is not for testnet.');
  for (const [name, details] of Object.entries(manifest.roles)) env[`NEAR_${name}_ID`] = details.account_id;
  if (role !== 'READONLY') {
    const credential = JSON.parse(readFileSync(path.join(directory, `${role.toLowerCase()}.json`), 'utf8'));
    if (credential.account_id !== manifest.roles[role]?.account_id) fail('Credential file does not match the manifest.');
    env[`NEAR_${role}_PRIVATE_KEY`] = credential.private_key;
  }
  env.NEAR_RPC_URL ||= manifest.rpc_url;
} else if (role !== 'READONLY') {
  const key = process.env[`NEAR_${role}_PRIVATE_KEY`];
  if (!key || !process.env[`NEAR_${role}_ID`]) {
    fail(`No runtime/dev-credentials and no NEAR_${role}_ID / NEAR_${role}_PRIVATE_KEY. Run \`pnpm testnet:provision\` first.`);
  }
  env[`NEAR_${role}_PRIVATE_KEY`] = key;
}

env.NEAR_NETWORK_ID = 'testnet';
env.NEAR_ALLOW_TESTNET_TRANSACTIONS = role === 'READONLY' ? 'false' : 'true';
env.AEGIS_MODE = 'TESTNET';
env.AEGIS_ROLE = role;

let executable = command;
let argv = args;
if (/\.(ts|mts)$/.test(command)) {
  executable = process.execPath;
  argv = [path.join(root, 'node_modules/tsx/dist/cli.mjs'), command, ...args];
} else if (/\.(mjs|js)$/.test(command)) {
  executable = process.execPath;
  argv = [command, ...args];
}

const child = spawn(executable, argv, { cwd: root, env, stdio: 'inherit' });
child.on('error', (error) => fail(`Failed to start ${command}: ${error.message}`));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
