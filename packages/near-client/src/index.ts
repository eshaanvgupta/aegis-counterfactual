export * from './canonical.js';
export * from './config.js';
export * from './outcome.js';
export * from './chain.js';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvironment, redact } from './config.js';

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(file), 'utf8')) as T;
}

export function print(value: unknown): void {
  console.log(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

/** Run a CLI action with bounded, key-redacted error output and a non-zero exit code on failure. */
export async function main(action: () => Promise<void>, options: { loadEnv?: boolean } = {}): Promise<void> {
  if (options.loadEnv !== false) loadEnvironment();
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown failure';
    console.error(JSON.stringify({ ok: false, error: redact(message) }));
    process.exitCode = 1;
  }
}
