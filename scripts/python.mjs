import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) { console.error('Run pnpm run setup first (Python 3.12+ required).'); process.exit(1); }
const env = { ...process.env, PYTHONPATH: path.join(root, 'services/replay-engine') };
const child = spawn(python, process.argv.slice(2), { cwd: root, env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
