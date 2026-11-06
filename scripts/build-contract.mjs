#!/usr/bin/env node
/**
 * Reproducible contract build.
 *
 *   node scripts/build-contract.mjs [--skip-tests]
 *
 * 1. Runs the Rust unit tests (unless --skip-tests).
 * 2. Builds the release WASM for wasm32-unknown-unknown.
 * 3. Post-processes it with binaryen (pinned npm package) into a pure WebAssembly-MVP
 *    module: modern rustc emits sign-extension, bulk-memory and overlong call_indirect
 *    encodings by default, and NEAR runtimes before protocol 84 reject some of them.
 *    Lowering makes the artifact portable across runtime versions and strips the debug
 *    name section (about half of the raw size).
 * 4. Scans the final code section for post-MVP opcodes, validates it under binaryen's
 *    MVP feature set, checks the required exports, and records provenance hashes in
 *    artifacts/contract-build.json.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postMvpOpcodes } from './lib/wasm-scan.mjs';

const root = path.resolve(import.meta.dirname, '..');
const manifest = 'contracts/aegis-vault/Cargo.toml';
const target = process.env.CARGO_TARGET_DIR || (process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'aegis-rust-target')
  : path.join(root, 'contracts/aegis-vault/target'));
const env = { ...process.env, CARGO_TARGET_DIR: target };
// Supported aws-lc-sys option for Windows hosts without a separate NASM install
// (pulled in by near-sdk's unit-testing dependencies, not by the contract itself).
if (process.platform === 'win32') env.AWS_LC_SYS_PREBUILT_NASM ||= '1';

const REQUIRED_EXPORTS = [
  'init', 'create_authorization', 'revoke_authorization', 'register_agent', 'revoke_agent',
  'set_attestor', 'set_policy', 'pause', 'unpause', 'submit_intent', 'attest_intent',
  'execute_intent', 'on_execution_complete', 'expire_intent', 'emergency_recover', 'fund',
  'get_intent', 'get_intents', 'get_recent_intents', 'get_authorization', 'get_authorizations',
  'get_authorization_budget', 'get_policy', 'get_audit_event', 'get_recent_audit',
  'get_vault_status', 'get_agent_nonce', 'canonical_intent_hash', 'check_intent',
];

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', shell: false,
  });
  if (result.error || result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || '');
    console.error(result.error?.message || `${command} ${args.join(' ')} exited ${result.status}`);
    process.exit(result.status || 1);
  }
  return (result.stdout || '').trim();
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== '--skip-tests')) {
  console.error('Usage: node scripts/build-contract.mjs [--skip-tests]');
  process.exit(1);
}

const installedTargets = run('rustup', ['target', 'list', '--installed'], { capture: true });
if (!installedTargets.split(/\r?\n/).includes('wasm32-unknown-unknown')) {
  run('rustup', ['target', 'add', 'wasm32-unknown-unknown']);
}
if (!args.has('--skip-tests')) run('cargo', ['test', '--manifest-path', manifest, '--locked']);
// near-sdk 5.30 compiles NEAR host calls (panic_utf8, sha256, ...) only under `--cfg near`
// (cargo-near sets it). Without it, panics become bare `unreachable` traps and hashing falls
// back to pure Rust, so on-chain error messages would be lost.
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
// Path remapping makes the artifact byte-identical across machines for the pinned toolchain
// (rust-toolchain.toml): embedded source paths no longer depend on the home or repo directory.
// CARGO_ENCODED_RUSTFLAGS (0x1f-separated) keeps paths containing spaces intact.
env.CARGO_ENCODED_RUSTFLAGS = [...(process.env.RUSTFLAGS ?? '').split(' ').filter(Boolean), '--cfg', 'near',
  `--remap-path-prefix=${path.join(cargoHome, 'registry', 'src')}=/cargo/registry`, `--remap-path-prefix=${root}=/aegis`].join('\x1f');
delete env.RUSTFLAGS;
run('cargo', ['build', '--manifest-path', manifest, '--target', 'wasm32-unknown-unknown', '--release', '--locked']);
delete env.CARGO_ENCODED_RUSTFLAGS;

const raw = path.join(target, 'wasm32-unknown-unknown/release/aegis_vault.wasm');
if (!existsSync(raw)) throw new Error(`Cargo did not produce ${raw}`);
const rawCode = readFileSync(raw);

const wasmOpt = path.join(root, 'node_modules/binaryen/bin/wasm-opt');
if (!existsSync(wasmOpt)) {
  console.error('binaryen is missing. Run `pnpm install` first (it is a pinned devDependency).');
  process.exit(1);
}
const artifactDirectory = path.join(root, 'artifacts');
mkdirSync(artifactDirectory, { recursive: true });
const artifact = path.join(artifactDirectory, 'aegis_vault.wasm');
const passes = [
  '-Oz',
  '--llvm-memory-copy-fill-lowering',
  '--signext-lowering',
  '--llvm-nontrapping-fptoint-lowering',
  '--strip-debug', '--strip-producers', '--strip-target-features',
];
run(process.execPath, [wasmOpt, raw, ...passes, '-o', artifact]);
// Fails (non-zero exit) if any instruction outside MVP (+ internal mutable globals) remains.
run(process.execPath, [wasmOpt, artifact, '--mvp-features', '--enable-mutable-globals', '-o', path.join(os.tmpdir(), 'aegis-mvp-check.wasm')]);

const code = readFileSync(artifact);
const residual = postMvpOpcodes(code);
if (Object.keys(residual).length) {
  console.error('Post-MVP opcodes remain after lowering:', residual);
  process.exit(1);
}
const wasmModule = new WebAssembly.Module(code);
const exports = WebAssembly.Module.exports(wasmModule).map((e) => e.name).sort();
const imports = WebAssembly.Module.imports(wasmModule).map((i) => `${i.module}.${i.name}`);
for (const required of ['env.panic_utf8', 'env.sha256', 'env.promise_batch_action_transfer']) {
  if (!imports.includes(required)) {
    console.error(`Missing host import ${required}: was the contract built with --cfg near?`);
    process.exit(1);
  }
}
const missing = REQUIRED_EXPORTS.filter((m) => !exports.includes(m));
if (missing.length) {
  console.error('Missing required WASM exports:', missing);
  process.exit(1);
}

const sourceFiles = ['Cargo.toml', 'Cargo.lock', 'src/lib.rs', 'src/tests.rs'];
const binaryenVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/binaryen/package.json'), 'utf8')).version;
const evidence = {
  artifact: 'artifacts/aegis_vault.wasm',
  bytes: code.length,
  sha256: sha256(code),
  raw_cargo_output: { bytes: rawCode.length, sha256: sha256(rawCode), post_mvp_opcodes: postMvpOpcodes(rawCode) },
  built_at: new Date().toISOString(),
  rustc: run('rustc', ['--version'], { capture: true }),
  cargo: run('cargo', ['--version'], { capture: true }),
  binaryen: binaryenVersion,
  wasm_opt_passes: passes,
  target: 'wasm32-unknown-unknown',
  profile: 'release',
  tests_executed_by_this_build: !args.has('--skip-tests'),
  mvp_validated: true,
  rustflags: '--cfg near --remap-path-prefix=<cargo registry>=/cargo/registry --remap-path-prefix=<repo>=/aegis',
  host_imports: imports.length,
  post_mvp_opcodes: residual,
  exports,
  source_sha256: Object.fromEntries(sourceFiles.map((file) => [file, sha256(readFileSync(path.join(root, 'contracts/aegis-vault', file)))])),
  note: 'Builds are deterministic for a fixed toolchain; compare sha256 after building with the same rustc and binaryen versions.',
};
writeFileSync(path.join(artifactDirectory, 'contract-build.json'), JSON.stringify(evidence, null, 2) + '\n');
writeFileSync(path.join(artifactDirectory, 'aegis_vault.wasm.sha256'), `${evidence.sha256}  aegis_vault.wasm\n`);
console.log(JSON.stringify({ ...evidence, exports: `${exports.length} exports` }, null, 2));
