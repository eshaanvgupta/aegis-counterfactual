/**
 * Network, role and credential configuration for the testnet tooling.
 *
 * Credentials come from exactly one place per process: the `NEAR_<ROLE>_PRIVATE_KEY`
 * environment variable injected by `scripts/testnet-role.mjs` (or set by the operator).
 * Nothing in this package reads another role's key, prints key material, or accepts a
 * mainnet account or RPC endpoint.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type Role = 'OWNER' | 'AGENT' | 'ATTESTOR' | 'VAULT';
export const ROLES: readonly Role[] = ['OWNER', 'AGENT', 'ATTESTOR', 'VAULT'];

export const NETWORK_ID = 'testnet';
export const DEFAULT_RPC_URLS = ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'];
export const EXPLORER_TX = 'https://testnet.nearblocks.io/txns/';
export const EXPLORER_ACCOUNT = 'https://testnet.nearblocks.io/address/';

const TESTNET_ACCOUNT = /^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/;
const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;

export class ConfigurationError extends Error {}

/** Load `.env` from the working directory if present (never required). */
export function loadEnvironment(): void {
  const file = resolve(process.cwd(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigurationError(
      `Missing ${name}. Run \`pnpm testnet:provision\` or see docs/NEAR_DEPLOYMENT.md. No transaction was signed.`,
    );
  }
  return value;
}

/** Accept only named `.testnet` accounts or 64-hex implicit accounts. */
export function testnetAccount(account: string): string {
  if (typeof account !== 'string' || account.length < 2 || account.length > 64) {
    throw new ConfigurationError('Account ID must be 2-64 characters.');
  }
  if (!TESTNET_ACCOUNT.test(account) && !IMPLICIT_ACCOUNT.test(account)) {
    throw new ConfigurationError(`Refusing non-testnet account "${account}".`);
  }
  return account;
}

export function accountId(role: Role): string {
  return testnetAccount(required(`NEAR_${role}_ID`));
}

export function rpcUrls(): string[] {
  const configured = (process.env.NEAR_RPC_URL ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const urls = configured.length ? configured : DEFAULT_RPC_URLS;
  for (const url of urls) {
    const parsed = new URL(url);
    const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !local) throw new ConfigurationError('RPC must use HTTPS (or local HTTP).');
    if (parsed.username || parsed.password) throw new ConfigurationError('Credentials in RPC URLs are not supported.');
    if (/mainnet/i.test(parsed.hostname)) throw new ConfigurationError('Mainnet RPC endpoints are refused.');
  }
  return urls;
}

export function assertTestnetNetwork(): void {
  if ((process.env.NEAR_NETWORK_ID ?? NETWORK_ID) !== NETWORK_ID) {
    throw new ConfigurationError('Only NEAR testnet is supported.');
  }
}

/** Four distinct accounts; no two supplied keys may be identical. */
export function assertSeparatedPrincipals(): void {
  const ids = ROLES.map(accountId);
  if (new Set(ids).size !== ids.length) {
    throw new ConfigurationError('OWNER, AGENT, ATTESTOR and VAULT must be distinct accounts.');
  }
  const keys = ROLES.map((role) => process.env[`NEAR_${role}_PRIVATE_KEY`]).filter(Boolean);
  if (new Set(keys).size !== keys.length) {
    throw new ConfigurationError('Independent principals cannot share a private key.');
  }
}

/** A process signs as exactly one role; any other role's key in its environment is an error. */
export function assertSingleSigningRole(role: Role): void {
  const foreign = ROLES.filter((other) => other !== role && process.env[`NEAR_${other}_PRIVATE_KEY`]);
  if (foreign.length) {
    throw new ConfigurationError(
      `This ${role} process also received ${foreign.join(', ')} credentials. Each principal must run in its own process.`,
    );
  }
}

export function signingEnabled(): boolean {
  return process.env.NEAR_ALLOW_TESTNET_TRANSACTIONS === 'true';
}

export function redact(message: string): string {
  return message.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/g, 'ed25519:[REDACTED]').slice(0, 2000);
}
