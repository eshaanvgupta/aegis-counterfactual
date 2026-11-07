#!/usr/bin/env node
/**
 * Builds the web app. Always refreshes the bundled public evidence first.
 *   node scripts/build-web.mjs            → workstation build (proxies to local services)
 *   node scripts/build-web.mjs --static   → static export in apps/web/out (key-less evidence viewer)
 *   AEGIS_BASE_PATH=/repo-name             → base path for GitHub Pages style hosting
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isStatic = process.argv.includes('--static');
const run = (cmd, args, env = {}) => {
  const options = { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } };
  // Windows resolves pnpm.cmd only through a shell; pass one command string there (no argument array with shell).
  const r = process.platform === 'win32'
    ? spawnSync([cmd, ...args].join(' '), { ...options, shell: true })
    : spawnSync(cmd, args, options);
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('node', [join('scripts', 'export-web-evidence.mjs')]);
run('pnpm', ['--filter', '@aegis/web', 'exec', 'next', 'build'], { AEGIS_STATIC: isStatic ? '1' : '0', NEXT_TELEMETRY_DISABLED: '1' });
if (isStatic) console.log('Static evidence viewer written to apps/web/out');
