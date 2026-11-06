/**
 * Data layer. Two sources, one shape:
 *
 * - LIVE: the local services (`pnpm dev` / `pnpm dev:testnet`) behind the Next.js proxy.
 * - EVIDENCE: a static deployment. Recorded artifacts are bundled under /evidence, and the
 *   vault's current state is read live from NEAR testnet RPC in the browser (views only;
 *   no keys, no writes).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Mode = 'loading' | 'live' | 'evidence';
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const STATIC = process.env.NEXT_PUBLIC_STATIC === '1';
export const RPC = 'https://test.rpc.fastnear.com';
export const EXPLORER = 'https://testnet.nearblocks.io';

export async function detectMode(): Promise<'live' | 'evidence'> {
  if (STATIC) return 'evidence';
  try {
    const response = await fetch('/api/system/health', { signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (response.ok) return 'live';
  } catch {
    /* fall through to evidence mode */
  }
  return 'evidence';
}

async function parse(response: Response): Promise<any> {
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Service returned ${response.status} without JSON`);
  }
  if (!response.ok) {
    const detail = data?.detail;
    throw new Error(typeof detail === 'string' ? detail : detail ? JSON.stringify(detail).slice(0, 400) : `Request failed (${response.status})`);
  }
  return data;
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  return parse(await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AEGIS-Client': 'workstation' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }));
}

export async function ownerApi<T = any>(path: string, body: unknown, token: string): Promise<T> {
  return parse(await fetch('/owner-api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AEGIS-Client': 'workstation', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  }));
}

const cache = new Map<string, Promise<any>>();
export function evidenceFile<T = any>(name: string): Promise<T> {
  if (!cache.has(name)) {
    cache.set(name, fetch(`${BASE}/evidence/${name}`).then((r) => {
      if (!r.ok) throw new Error(`Missing bundled evidence ${name}`);
      return r.json();
    }));
  }
  return cache.get(name)!;
}

export async function rpcView<T = any>(vault: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'aegis', method: 'query', params: {
      request_type: 'call_function', finality: 'final', account_id: vault, method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    } }),
  });
  const reply = await response.json();
  if (reply.error || reply.result?.error) throw new Error(JSON.stringify(reply.error ?? reply.result.error).slice(0, 200));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(reply.result.result)) || 'null');
}

export interface Dashboard {
  mode: string;
  source: 'LIVE_SERVICES' | 'PUBLIC_TESTNET_RPC';
  principals: Record<string, string>;
  chain: any;
  chain_error?: string | null;
  policy?: any;
  authorizations?: any[];
  recent_intents?: any[];
  recent_audit?: any[];
  ledger?: any[];
  stats?: Record<string, number>;
  deployment?: any;
  testnet_evidence?: any;
}

export async function loadDashboard(mode: Mode): Promise<Dashboard> {
  if (mode === 'live') return { ...(await api('/vault/status')), source: 'LIVE_SERVICES' };
  const [deployment, evidence] = await Promise.all([evidenceFile('testnet-deployment.json'), evidenceFile('testnet-evidence.json')]);
  const vault = deployment.vault_id;
  const out: Dashboard = { mode: 'TESTNET', source: 'PUBLIC_TESTNET_RPC', principals: { vault, ...evidence.principals }, chain: null, deployment, testnet_evidence: evidence };
  try {
    const [chain, policy, authorizations, recent_intents, recent_audit] = await Promise.all([
      rpcView(vault, 'get_vault_status'), rpcView(vault, 'get_policy'), rpcView(vault, 'get_authorizations', { limit: 50 }),
      rpcView(vault, 'get_recent_intents', { limit: 12 }), rpcView(vault, 'get_recent_audit', { limit: 15 }),
    ]);
    Object.assign(out, { chain, policy, authorizations, recent_intents, recent_audit });
  } catch (error) {
    out.chain_error = error instanceof Error ? error.message : 'Testnet RPC unavailable';
  }
  const txs = (evidence.flows ?? []).flatMap((f: any) => f.steps.map((s: any) => s.evidence).filter((e: any) => e?.transaction_hash));
  out.ledger = txs.slice().reverse();
  return out;
}

export async function loadLabRuns(mode: Mode): Promise<any[]> {
  if (mode === 'live') {
    const runs = await api<any[]>('/lab/runs?limit=100');
    if (runs.length) return runs;
  }
  const bench = await evidenceFile('lab-runs.json');
  return bench.runs;
}

export async function loadReceipts(): Promise<{ name: string; label: string; receipt: any }[]> {
  const index = await evidenceFile<{ files: { name: string; label: string }[] }>('receipts/index.json');
  return Promise.all(index.files.map(async (f) => ({ ...f, receipt: await evidenceFile(`receipts/${f.name}`) })));
}
