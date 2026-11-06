/**
 * JSON stdin → stdout bridge used by the Python services for signed vault calls.
 *
 * Each process holds exactly one principal's key (enforced by assertSingleSigningRole).
 * The bridge maps every operation to the only role allowed to perform it, so an agent
 * process can never sign an attestation or an owner operation even if asked to.
 */
import { accountId, call, redact, type Role } from './index.js';

type Operation = { role: Exclude<Role, 'VAULT'>; method: string; gas: number; args: (r: Request) => Record<string, unknown> };
interface Request { operation: string; label?: string; [key: string]: unknown }

const HEX64 = /^[0-9a-f]{64}$/;
const hash = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new Error(`Invalid ${name}`);
  return value;
};

const OPERATIONS: Record<string, Operation> = {
  submit: { role: 'AGENT', method: 'submit_intent', gas: 30, args: (r) => ({ intent: r.intent }) },
  execute: { role: 'AGENT', method: 'execute_intent', gas: 120, args: (r) => ({ intent_hash: hash(r.intent_hash, 'intent_hash') }) },
  attest: {
    role: 'ATTESTOR', method: 'attest_intent', gas: 40,
    args: (r) => {
      if (typeof r.approved !== 'boolean') throw new Error('approved must be boolean');
      return { intent_hash: hash(r.intent_hash, 'intent_hash'), evidence_hash: hash(r.evidence_hash, 'evidence_hash'), approved: r.approved };
    },
  },
  create_authorization: { role: 'OWNER', method: 'create_authorization', gas: 30, args: (r) => ({ authorization: r.authorization }) },
  revoke_authorization: { role: 'OWNER', method: 'revoke_authorization', gas: 30, args: (r) => ({ authorization_id: String(r.authorization_id) }) },
  set_policy: { role: 'OWNER', method: 'set_policy', gas: 30, args: (r) => ({ policy: r.policy }) },
  pause: { role: 'OWNER', method: 'pause', gas: 30, args: () => ({}) },
  unpause: { role: 'OWNER', method: 'unpause', gas: 30, args: () => ({}) },
};

async function run(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 65_536) throw new Error('Bridge input exceeds 64 KB');
  }
  const request = JSON.parse(input) as Request;
  const op = OPERATIONS[request.operation];
  if (!op) throw new Error(`Unsupported operation ${request.operation}`);
  const role = process.env.AEGIS_ROLE;
  if (role && role !== op.role) throw new Error(`This ${role} process cannot perform ${request.operation} (requires ${op.role}).`);
  accountId('VAULT');
  const evidence = await call(op.role, op.method, op.args(request), { gasTera: op.gas, label: request.label ?? op.method });
  // Single line: the Python caller parses the last stdout line.
  console.log(JSON.stringify({ ok: true, result: evidence }));
}

try {
  await run();
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: redact(error instanceof Error ? error.message : 'Bridge failure') }));
  process.exitCode = 1;
}
