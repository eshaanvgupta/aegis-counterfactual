/**
 * Browser data plane. Every deployment remains useful without privileged keys:
 *
 * - SERVICE: a same-origin or explicitly configured AEGIS API provides the full
 *   transaction workflow and current vault state.
 * - CHAIN: when services are not configured, the browser reads the deployed NEAR
 *   vault directly through public RPC and combines it with reproducible evidence.
 *
 * Both modes refresh while the page is visible. Recorded evidence is a provenance
 * layer, never presented as a live chain response.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Mode = 'loading' | 'live' | 'evidence';
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const STATIC = process.env.NEXT_PUBLIC_STATIC === '1';
export const EXPLORER = 'https://testnet.nearblocks.io';

function normalizeBase(value: string | undefined, fallback: string): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  if (candidate.startsWith('/')) return candidate.replace(/\/$/, '');
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return fallback;
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function publicHttpUrls(value: string | undefined): string[] {
  return (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
    try {
      const url = new URL(entry);
      return ['http:', 'https:'].includes(url.protocol) ? [url.toString().replace(/\/$/, '')] : [];
    } catch {
      return [];
    }
  });
}

export const API_BASE = normalizeBase(process.env.NEXT_PUBLIC_AEGIS_API_BASE_URL, '/api');
export const OWNER_API_BASE = normalizeBase(process.env.NEXT_PUBLIC_AEGIS_OWNER_API_BASE_URL, '/owner-api');
export const REMOTE_API_CONFIGURED = /^https?:\/\//.test(API_BASE);
export const REFRESH_INTERVAL_MS = Math.min(120_000, Math.max(5_000, Number(process.env.NEXT_PUBLIC_AEGIS_REFRESH_MS) || 15_000));

const configuredRpcs = publicHttpUrls(process.env.NEXT_PUBLIC_NEAR_RPC_URLS);
export const RPC_ENDPOINTS = [...new Set([
  ...configuredRpcs,
  'https://test.rpc.fastnear.com',
  'https://rpc.testnet.near.org',
])];
export const RPC = RPC_ENDPOINTS[0];

const endpoint = (base: string, path: string) => `${base}${path.startsWith('/') ? path : `/${path}`}`;

export async function detectMode(): Promise<'live' | 'evidence'> {
  // A static export can still be a complete dynamic client when it is built with
  // an explicit API base. The public GitHub Pages build intentionally uses chain mode.
  if (STATIC && !REMOTE_API_CONFIGURED) return 'evidence';
  try {
    const response = await fetch(endpoint(API_BASE, '/system/health'), {
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
      headers: { 'X-AEGIS-Client': 'workstation' },
    });
    if (response.ok) return 'live';
  } catch {
    /* The chain-backed experience remains available while services reconnect. */
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
  return parse(await fetch(endpoint(API_BASE, path), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AEGIS-Client': 'workstation' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }));
}

export async function ownerApi<T = any>(path: string, body: unknown, token: string): Promise<T> {
  return parse(await fetch(endpoint(OWNER_API_BASE, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AEGIS-Client': 'workstation', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  }));
}

const cache = new Map<string, Promise<any>>();
export function evidenceFile<T = any>(name: string): Promise<T> {
  if (!cache.has(name)) {
    cache.set(name, fetch(`${BASE}/evidence/${name}`).then((response) => {
      if (!response.ok) throw new Error(`Missing bundled evidence ${name}`);
      return response.json();
    }));
  }
  return cache.get(name)!;
}

function encodeArgs(args: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function rpcViewAt<T = any>(rpcUrl: string, vault: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(7000),
    cache: 'no-store',
    body: JSON.stringify({ jsonrpc: '2.0', id: `aegis-${method}`, method: 'query', params: {
      request_type: 'call_function', finality: 'final', account_id: vault, method_name: method,
      args_base64: encodeArgs(args),
    } }),
  });
  if (!response.ok) throw new Error(`RPC returned ${response.status}`);
  const reply = await response.json();
  if (reply.error || reply.result?.error) throw new Error(JSON.stringify(reply.error ?? reply.result.error).slice(0, 240));
  if (!Array.isArray(reply.result?.result)) throw new Error('RPC response did not include contract result bytes');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(reply.result.result)) || 'null');
}

export interface ChainAnswer<T> { value: T; block_height: number; block_hash: string; endpoint: string; latency_ms: number }

/** Call a contract view and return the value together with the block it was evaluated at. */
export async function rpcQuery<T = any>(vault: string, method: string, args: Record<string, unknown> = {}): Promise<ChainAnswer<T>> {
  let lastError: unknown;
  for (const rpcUrl of RPC_ENDPOINTS) {
    const started = performance.now();
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000), cache: 'no-store',
        body: JSON.stringify({ jsonrpc: '2.0', id: `aegis-${method}`, method: 'query', params: {
          request_type: 'call_function', finality: 'final', account_id: vault, method_name: method, args_base64: encodeArgs(args),
        } }),
      });
      if (!response.ok) throw new Error(`RPC returned ${response.status}`);
      const reply = await response.json();
      if (reply.error || reply.result?.error) throw new Error(JSON.stringify(reply.error ?? reply.result.error).slice(0, 240));
      return {
        value: JSON.parse(new TextDecoder().decode(new Uint8Array(reply.result.result)) || 'null'),
        block_height: reply.result.block_height, block_hash: reply.result.block_hash,
        endpoint: new URL(rpcUrl).host, latency_ms: Math.round(performance.now() - started),
      };
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('No NEAR testnet RPC endpoint responded');
}

/** Build the exact JSON-RPC request a visitor can replay from a terminal. */
export function rpcCurl(vault: string, method: string, args: Record<string, unknown>): string {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: vault, method_name: method, args_base64: encodeArgs(args) } });
  return `curl -s ${RPC_ENDPOINTS[0]} -H 'content-type: application/json' -d '${body}' | jq -r '.result.result | implode'`;
}

/** Read a single view method with endpoint failover. */
export async function rpcView<T = any>(vault: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of RPC_ENDPOINTS) {
    try { return await rpcViewAt<T>(rpcUrl, vault, method, args); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('No NEAR testnet RPC endpoint responded');
}

async function liveVaultSnapshot(vault: string) {
  const failures: string[] = [];
  for (const rpcUrl of RPC_ENDPOINTS) {
    try {
      const [chain, policy, authorizations, recent_intents, recent_audit] = await Promise.all([
        rpcViewAt(rpcUrl, vault, 'get_vault_status'),
        rpcViewAt(rpcUrl, vault, 'get_policy'),
        rpcViewAt(rpcUrl, vault, 'get_authorizations', { limit: 50 }),
        rpcViewAt(rpcUrl, vault, 'get_recent_intents', { limit: 12 }),
        rpcViewAt(rpcUrl, vault, 'get_recent_audit', { limit: 15 }),
      ]);
      return { chain, policy, authorizations, recent_intents, recent_audit, rpc_url: rpcUrl };
    } catch (error) {
      failures.push(`${new URL(rpcUrl).host}: ${error instanceof Error ? error.message : 'unavailable'}`);
    }
  }
  throw new Error(`NEAR RPC endpoints are reconnecting (${failures.join('; ').slice(0, 320)})`);
}

export interface Dashboard {
  mode: string;
  source: 'LIVE_SERVICES' | 'PUBLIC_TESTNET_RPC';
  principals: Record<string, string>;
  chain: any;
  chain_error?: string | null;
  refreshed_at?: string;
  rpc_url?: string;
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
  const refreshed_at = new Date().toISOString();
  if (mode === 'live') return { ...(await api('/vault/status')), source: 'LIVE_SERVICES', refreshed_at };
  const [deployment, evidence] = await Promise.all([evidenceFile('testnet-deployment.json'), evidenceFile('testnet-evidence.json')]);
  const vault = deployment.vault_id;
  const out: Dashboard = {
    mode: 'TESTNET', source: 'PUBLIC_TESTNET_RPC', principals: { vault, ...evidence.principals },
    chain: null, deployment, testnet_evidence: evidence, refreshed_at,
  };
  try {
    Object.assign(out, await liveVaultSnapshot(vault));
  } catch (error) {
    out.chain_error = error instanceof Error ? error.message : 'Testnet RPC is reconnecting';
  }
  const txs = (evidence.flows ?? []).flatMap((flow: any) => flow.steps.map((step: any) => step.evidence).filter((item: any) => item?.transaction_hash));
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
  return Promise.all(index.files.map(async (file) => ({ ...file, receipt: await evidenceFile(`receipts/${file.name}`) })));
}
