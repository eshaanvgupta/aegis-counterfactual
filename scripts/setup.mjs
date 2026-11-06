#!/usr/bin/env node
/** Creates .venv (Python 3.12+) and installs the pinned Python dependencies. Node deps come from `pnpm install`. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';
const py = path.join(root, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const run = (cmd, args) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' }); return r.status === 0; };
if (!existsSync(py)) {
  const candidates = win ? [['py', ['-3.12', '-m', 'venv', '.venv']], ['py', ['-3', '-m', 'venv', '.venv']], ['python', ['-m', 'venv', '.venv']]] : [['python3.12', ['-m', 'venv', '.venv']], ['python3', ['-m', 'venv', '.venv']]];
  if (!candidates.some(([c, a]) => run(c, a))) { console.error('Could not create a virtualenv. Install Python 3.12+.'); process.exit(1); }
}
if (!run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', 'requirements.txt'])) process.exit(1);
console.log('\nReady.\n  pnpm dev            local simulation (no keys, no network)\n  pnpm demo:offline   run all 23 attack scenarios\n  pnpm test           every test suite');
