#!/usr/bin/env node
/**
 * Runs every automated check that needs no network and no keys.
 *   pnpm test              Python (services, swarm, receipts, lab) + TypeScript (canonical, receipt verifier) + Rust contract
 *   pnpm test --security   only the security-relevant subsets (policy parity, isolation, receipts, contract)
 *   pnpm test --no-rust    skip cargo (e.g. on machines without the pinned Rust toolchain)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const py = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(py)) { console.error('Python environment missing. Run `pnpm run setup` first.'); process.exit(1); }
const env = { ...process.env, PYTHONPATH: path.join(root, 'services/replay-engine') };
if (process.platform === 'win32') {
  env.CARGO_TARGET_DIR ||= path.join(process.env.LOCALAPPDATA ?? root, 'aegis-rust-target');
  // near-sdk's unit-testing dependency graph pulls aws-lc-sys. Use its supported
  // packaged NASM fallback on Windows, matching scripts/build-contract.mjs.
  env.AWS_LC_SYS_PREBUILT_NASM ||= '1';
}
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');

const security = args.has('--security');
const commands = [
  ['Python services, swarm, receipts, attack lab', py, ['-m', 'pytest', '-q', ...(security ? ['-k', 'policy or vector or isolation or role or token or origin or receipt or tamper or forged or replay or nonce or attest'] : [])]],
  ['TypeScript canonical encoding parity', process.execPath, [tsx, '--test', 'packages/near-client/src/canonical.test.ts']],
  ['TypeScript independent receipt verifier', process.execPath, [tsx, '--test', 'packages/receipt-verifier/src/verifier.test.ts']],
];
if (!args.has('--no-rust')) commands.push(['Rust contract (incl. shared policy vectors)', 'cargo', ['test', '--manifest-path', 'contracts/aegis-vault/Cargo.toml', '--locked', '--quiet']]);

const failed = [];
for (const [label, cmd, cmdArgs] of commands) {
  console.log(`\n━━ ${label}`);
  const r = spawnSync(cmd, cmdArgs, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) failed.push(label);
}
console.log(failed.length ? `\nFAILED: ${failed.join('; ')}` : '\nAll test suites passed.');
process.exit(failed.length ? 1 : 0);
