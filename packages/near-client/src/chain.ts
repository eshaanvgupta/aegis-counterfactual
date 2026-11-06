/** Testnet RPC access, single-role signing, and genuine transaction evidence. */
import { Account, FailoverRpcProvider, JsonRpcProvider, actions, teraToGas, type KeyPairString, type Provider } from 'near-api-js';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ConfigurationError, EXPLORER_TX, accountId, assertSeparatedPrincipals, assertSingleSigningRole,
  assertTestnetNetwork, rpcUrls, required, signingEnabled, type Role,
} from './config.js';
import { failureMessage, gasBurnt, isFailure, receiptFailures, vaultEvents, violatedInvariants, type OutcomeLike } from './outcome.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ChainEvidence {
  mode: 'NEAR_TESTNET';
  timestamp: string;
  label: string;
  operation: string;
  role: Role;
  signer_id: string;
  receiver_id: string;
  transaction_hash: string;
  explorer_url: string;
  succeeded: boolean;
  failure: string | null;
  violated_invariants: string[];
  events: string[];
  gas_burnt: number;
  return_value?: unknown;
  intent_hash?: string;
}

let cachedProvider: Provider | undefined;

export function provider(): Provider {
  assertTestnetNetwork();
  if (!cachedProvider) {
    const providers = rpcUrls().map((url) => new JsonRpcProvider({ url }, { retries: 2, wait: 500, backoff: 2 }));
    cachedProvider = providers.length === 1 ? providers[0] : new FailoverRpcProvider(providers);
  }
  return cachedProvider;
}

/** Refuse to sign unless the RPC reports chain_id "testnet". */
export async function verifyTestnetRpc(): Promise<void> {
  assertTestnetNetwork();
  const errors: string[] = [];
  for (const url of rpcUrls()) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'aegis-chain-check', method: 'status', params: [] }),
        signal: AbortSignal.timeout(10_000),
      });
      const reply = (await response.json()) as { result?: { chain_id?: string } };
      if (reply.result?.chain_id === 'testnet') return;
      errors.push(`${url}: chain_id ${reply.result?.chain_id ?? 'unknown'}`);
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : 'unreachable'}`);
    }
  }
  throw new ConfigurationError(`No testnet RPC confirmed (${errors.join('; ')}). Signing refused.`);
}

export async function signingAccount(role: Role): Promise<Account> {
  if (!signingEnabled()) {
    throw new ConfigurationError(
      'Signing disabled. Testnet transactions require NEAR_ALLOW_TESTNET_TRANSACTIONS=true (set automatically by scripts/testnet-role.mjs).',
    );
  }
  assertSingleSigningRole(role);
  assertSeparatedPrincipals();
  await verifyTestnetRpc();
  const secret = required(`NEAR_${role}_PRIVATE_KEY`);
  if (!secret.startsWith('ed25519:')) throw new ConfigurationError(`NEAR_${role}_PRIVATE_KEY must be a serialized ed25519 key.`);
  return new Account(accountId(role), provider(), secret as KeyPairString);
}

export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId?: string): Promise<T> {
  return (await provider().callFunction({ contractId: contractId ?? accountId('VAULT'), method, args })) as T;
}

function decodeReturn(status: unknown): unknown {
  if (typeof status !== 'object' || status === null || !('SuccessValue' in status)) return undefined;
  const encoded = (status as { SuccessValue: string }).SuccessValue;
  if (!encoded) return undefined;
  const text = Buffer.from(encoded, 'base64').toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toEvidence(label: string, role: Role, operation: string, outcome: OutcomeLike): ChainEvidence {
  const hash = outcome.transaction?.hash;
  if (!hash) throw new Error('RPC response missing a transaction hash; no evidence fabricated.');
  const failure = failureMessage(outcome);
  const succeeded = !isFailure(outcome.status) && receiptFailures(outcome).length === 0;
  return {
    mode: 'NEAR_TESTNET',
    timestamp: new Date().toISOString(),
    label,
    operation,
    role,
    signer_id: outcome.transaction.signer_id,
    receiver_id: outcome.transaction.receiver_id,
    transaction_hash: hash,
    explorer_url: EXPLORER_TX + hash,
    succeeded,
    failure: succeeded ? null : failure,
    violated_invariants: succeeded ? [] : violatedInvariants(failure),
    events: vaultEvents(outcome).map((e) => e.event),
    gas_burnt: gasBurnt(outcome),
    return_value: decodeReturn(outcome.status),
  };
}

/** Append-only local ledger of every signed transaction (ignored by Git). */
export async function recordEvidence(evidence: ChainEvidence): Promise<ChainEvidence> {
  const file = process.env.AEGIS_CHAIN_LEDGER ?? resolve(REPO_ROOT, 'runtime/chain-ledger.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(evidence) + '\n');
  return evidence;
}

/**
 * Sign one zero-deposit function call to the vault. Failed outcomes are returned (with
 * their genuine hash and panic message), never thrown away.
 */
export async function call(
  role: Exclude<Role, 'VAULT'>,
  method: string,
  args: Record<string, unknown>,
  options: { gasTera?: number; label?: string; signer?: Account } = {},
): Promise<ChainEvidence> {
  const signer = options.signer ?? (await signingAccount(role));
  const outcome = await signer.signAndSendTransaction({
    receiverId: accountId('VAULT'),
    actions: [actions.functionCall(method, args, teraToGas(String(options.gasTera ?? 50) as `${number}`), 0n)],
    waitUntil: 'FINAL',
    throwOnFailure: false,
  });
  return recordEvidence(toEvidence(options.label ?? method, role, method, outcome as unknown as OutcomeLike));
}

export async function transactionOutcome(txHash: string, signerId: string): Promise<OutcomeLike> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash)) throw new Error('Invalid NEAR transaction hash.');
  const outcome = await provider().viewTransactionStatus({ txHash, accountId: signerId, waitUntil: 'FINAL' });
  return outcome as unknown as OutcomeLike;
}
