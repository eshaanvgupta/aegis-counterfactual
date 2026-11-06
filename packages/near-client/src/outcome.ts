/** Interpreting real RPC transaction outcomes without trusting any self-reported verdict. */
import { hashIntent, type IntentFields } from './canonical.js';

export interface TransactionView {
  hash: string;
  signer_id: string;
  receiver_id: string;
  actions: unknown[];
}

export interface OutcomeLike {
  transaction: TransactionView;
  status: unknown;
  receipts_outcome?: { id?: string; outcome: { status: unknown; logs?: string[]; gas_burnt?: number } }[];
  transaction_outcome?: { outcome: { gas_burnt?: number } };
}

const INTENT_METHODS = ['submit_intent', 'attest_intent', 'execute_intent', 'expire_intent'];

/** Bind an RPC outcome to the exact reviewed vault intent, not an unrelated transaction. */
export function boundIntentMethod(transaction: TransactionView, vaultId: string, intentHash: string): string {
  if (transaction.receiver_id !== vaultId) throw new Error('Transaction receiver is not the expected vault.');
  const relevant = transaction.actions.flatMap((action) => {
    if (typeof action !== 'object' || action === null || !('FunctionCall' in action)) return [];
    const call = (action as { FunctionCall: { method_name: string; args: string } }).FunctionCall;
    if (!INTENT_METHODS.includes(call.method_name)) return [];
    let args: { intent?: IntentFields; intent_hash?: string };
    try {
      args = JSON.parse(Buffer.from(call.args, 'base64').toString('utf8'));
    } catch {
      return [];
    }
    const bound = call.method_name === 'submit_intent' && args.intent ? hashIntent(args.intent) : args.intent_hash;
    return bound === intentHash ? [call.method_name] : [];
  });
  if (relevant.length !== 1) throw new Error('Transaction must contain exactly one call bound to the requested intent.');
  return relevant[0];
}

function findExecutionError(value: unknown, depth = 0): string | undefined {
  if (depth > 12 || value === null || typeof value !== 'object') return undefined;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'ExecutionError' && typeof inner === 'string') return inner;
    if (key === 'MethodResolveError' || key === 'CompilationError' || key === 'LinkError') {
      return `${key}: ${JSON.stringify(inner)}`;
    }
    const found = findExecutionError(inner, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function isFailure(status: unknown): boolean {
  return typeof status === 'object' && status !== null && 'Failure' in status;
}

/** Every failure in the transaction or any of its receipts. */
export function receiptFailures(outcome: OutcomeLike): unknown[] {
  return (outcome.receipts_outcome ?? []).map((r) => r.outcome.status).filter(isFailure);
}

/**
 * The contract's panic message, e.g. `Smart contract panicked: POLICY_VIOLATION:...`,
 * from the transaction status or the first failing receipt.
 */
export function failureMessage(outcome: OutcomeLike): string | null {
  const direct = findExecutionError(outcome.status);
  if (direct) return direct;
  for (const failure of receiptFailures(outcome)) {
    const found = findExecutionError(failure);
    if (found) return found;
  }
  return isFailure(outcome.status) ? JSON.stringify(outcome.status).slice(0, 600) : null;
}

/** `POLICY_VIOLATION:A,B` → ['A','B']; `Smart contract panicked: OWNER_ONLY` → ['OWNER_ONLY']. */
export function violatedInvariants(message: string | null): string[] {
  if (!message) return [];
  const panic = message.replace(/^Smart contract panicked:\s*/, '').trim();
  const body = panic.startsWith('POLICY_VIOLATION:') ? panic.slice('POLICY_VIOLATION:'.length) : panic;
  return body.split(',').map((s) => s.trim()).filter((s) => /^[A-Z][A-Z0-9_]+$/.test(s));
}

/** NEP-297 events emitted by the vault in this transaction. */
export function vaultEvents(outcome: OutcomeLike): { event: string; data: unknown }[] {
  const events: { event: string; data: unknown }[] = [];
  for (const receipt of outcome.receipts_outcome ?? []) {
    for (const log of receipt.outcome.logs ?? []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const parsed = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: string; event?: string; data?: unknown };
        if (parsed.standard === 'aegis' && parsed.event) events.push({ event: parsed.event, data: parsed.data });
      } catch {
        // Ignore malformed logs from other contracts.
      }
    }
  }
  return events;
}

export function gasBurnt(outcome: OutcomeLike): number {
  const tx = outcome.transaction_outcome?.outcome.gas_burnt ?? 0;
  return tx + (outcome.receipts_outcome ?? []).reduce((sum, r) => sum + (r.outcome.gas_burnt ?? 0), 0);
}
