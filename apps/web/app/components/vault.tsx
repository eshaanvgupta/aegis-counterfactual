'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Pause, PlayCircle, Plus, ShieldOff } from 'lucide-react';
import { api, ownerApi, type Dashboard, type Mode } from '../lib/data';
import { date, near, pct, short } from '../lib/format';
import { AccountLink, Badge, Empty, Hash, Panel, TxLink } from './ui';

export function PolicyVault({ mode, data, refresh }: { mode: Mode; data: Dashboard | null; refresh: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const [form, setForm] = useState({ id: '', recipient: '', amount_near: '0.05', purpose_id: 'compute-services', invoice: '' });
  const [limits, setLimits] = useState({ allowed_recipients: '', max_transaction_near: '0.1', daily_limit_near: '0.25' });

  useEffect(() => { try { setToken(sessionStorage.getItem('aegis-owner-token') ?? ''); } catch { /* storage unavailable */ } }, []);
  useEffect(() => {
    if (mode !== 'live') return;
    api('/fixtures').then((f) => {
      const n = (data?.authorizations?.length ?? 0) + 1;
      const id = `INV-2026-${String(100 + n).padStart(3, '0')}`;
      setForm({ id, recipient: f.principals.recipient, amount_near: '0.05', purpose_id: 'compute-services', invoice: f.reference_invoice.replace('INV-2026-001', id) });
    }).catch(() => undefined);
    if (data?.policy) setLimits({ allowed_recipients: data.policy.allowed_recipients.join(', '), max_transaction_near: near(data.policy.max_transaction, 24), daily_limit_near: near(data.policy.daily_limit, 24) });
  }, [mode, data?.policy, data?.authorizations?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveToken = (value: string) => { setToken(value); try { sessionStorage.setItem('aegis-owner-token', value); } catch { /* ignore */ } };
  const act = async (key: string, path: string, body: unknown = {}) => {
    setBusy(key); setMessage(null);
    try {
      const r = await ownerApi(path, body, token);
      const chain = r.chain ?? r;
      setMessage({ ok: chain.succeeded !== false, text: chain.succeeded === false ? `Rejected: ${chain.failure}` : `${chain.label ?? 'Owner action'} succeeded`, tx: chain.transaction_hash });
      refresh();
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy('');
  };
  const policy = data?.policy;
  const chain = data?.chain ?? {};
  return (
    <>
      <div className="grid g-2-1">
        <Panel eyebrow={`Policy v${policy?.version ?? '?'}`} title="Owner spending policy" action={chain.paused ? <Badge tone="red">paused</Badge> : <Badge tone="green">active</Badge>}>
          {policy ? (
            <dl className="kv">
              <dt>Allowed recipients</dt><dd>{policy.allowed_recipients.map((r: string) => <div key={r}><AccountLink id={r} /></div>)}</dd>
              <dt>Per-transaction cap</dt><dd className="mono">{near(policy.max_transaction, 6)} NEAR</dd>
              <dt>Daily limit</dt><dd className="mono">{near(policy.daily_limit, 6)} NEAR</dd>
              <dt>Actions</dt><dd className="mono">{policy.allowed_actions.join(', ')} <span className="subtle tiny">(no arbitrary calls)</span></dd>
              <dt>Policy expires</dt><dd>{date(policy.expires_at_ms)}</dd>
              <dt>Change rule</dt><dd className="small muted">Every change must increment the version; attestations and mandates from older versions stop executing.</dd>
            </dl>
          ) : <Empty>No policy loaded.</Empty>}
        </Panel>
        <Panel eyebrow="Owner console" title="Signed owner actions">
          {mode !== 'live' ? (
            <div className="notice">Owner actions require the OWNER key, which only exists in the local owner process. Run <code>pnpm dev:testnet</code> and paste <code>runtime/owner-token.txt</code> here. This public page is read-only.</div>
          ) : (
            <div className="stack">
              <label className="field"><span className="row" style={{ gap: 6 }}><KeyRound size={12} /> Owner token (runtime/owner-token.txt)</span><input className="input mono" type="password" value={token} onChange={(e) => saveToken(e.target.value)} placeholder="paste the local owner token" /></label>
              <div className="row">
                <button className="btn danger" disabled={!token || !!busy} onClick={() => act('pause', '/owner/pause')}>{busy === 'pause' ? <Loader2 size={14} className="spin" /> : <Pause size={14} />}Pause agent execution</button>
                <button className="btn" disabled={!token || !!busy} onClick={() => act('unpause', '/owner/unpause')}><PlayCircle size={14} />Unpause</button>
              </div>
              <p className="subtle tiny">The token authenticates you to the local owner console; the owner&apos;s NEAR key never reaches the browser.</p>
            </div>
          )}
          {message && <div className={`notice ${message.ok ? 'info' : ''}`} style={{ marginTop: 10 }}>{message.text} {message.tx && <TxLink hash={message.tx} />}</div>}
        </Panel>
      </div>
      <Panel eyebrow="Business mandates" title="Owner-written authorizations (independent of any invoice text)">
        <div className="scroll-x"><table className="table"><thead><tr><th>Mandate</th><th>Recipient</th><th>Exact amount</th><th>Budget used</th><th>Purpose · invoice</th><th>Expires</th><th /></tr></thead><tbody>
          {(data?.authorizations ?? []).map((record: any) => {
            const a = record.authorization ?? record;
            const b = record.budget ?? { spent: '0', reserved: '0' };
            const used = (BigInt(b.spent) + BigInt(b.reserved)).toString();
            return (
              <tr key={a.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{a.id}{a.revoked && <div><Badge tone="red">revoked</Badge></div>}</td>
                <td><AccountLink id={a.recipient} /></td>
                <td className="mono">{near(a.amount, 6)} NEAR<div className="subtle tiny">max total {near(a.max_total, 6)}</div></td>
                <td style={{ minWidth: 140 }}><div className="mono tiny">{near(used, 6)} / {near(a.max_total, 6)}</div><div className="meter"><i style={{ width: `${pct(used, a.max_total)}%` }} /></div></td>
                <td className="mono tiny">{a.purpose_id}<div className="subtle">{short(a.invoice_fingerprint, 10, 6)}</div></td>
                <td className="tiny">{date(a.expires_at_ms)}</td>
                <td>{mode === 'live' && !a.revoked && <button className="btn sm danger" disabled={!token || !!busy} onClick={() => act(`revoke-${a.id}`, `/owner/authorizations/${a.id}/revoke`)}><ShieldOff size={12} />Revoke</button>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
        {!data?.authorizations?.length && <Empty>No mandates.</Empty>}
      </Panel>
      {mode === 'live' && (
        <div className="grid g2">
          <Panel eyebrow="New mandate" title="Create authorization">
            <div className="stack">
              <div className="grid g2" style={{ gap: 10 }}>
                <label className="field">Mandate ID<input className="input mono" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} /></label>
                <label className="field">Exact amount (NEAR)<input className="input mono" value={form.amount_near} onChange={(e) => setForm({ ...form, amount_near: e.target.value })} /></label>
                <label className="field">Recipient<input className="input mono" value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} /></label>
                <label className="field">Purpose<input className="input mono" value={form.purpose_id} onChange={(e) => setForm({ ...form, purpose_id: e.target.value })} /></label>
              </div>
              <label className="field">Authorized invoice text (its SHA-256 is bound on-chain)<textarea className="input" value={form.invoice} onChange={(e) => setForm({ ...form, invoice: e.target.value })} /></label>
              <button className="btn primary" disabled={!token || !!busy} onClick={() => act('create', '/owner/authorizations', form)}>{busy === 'create' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}Sign and create mandate</button>
            </div>
          </Panel>
          <Panel eyebrow="Limits" title="Change spending policy (version + 1)">
            <div className="stack">
              <label className="field">Allowed recipients (comma separated)<input className="input mono" value={limits.allowed_recipients} onChange={(e) => setLimits({ ...limits, allowed_recipients: e.target.value })} /></label>
              <div className="grid g2" style={{ gap: 10 }}>
                <label className="field">Max per transaction (NEAR)<input className="input mono" value={limits.max_transaction_near} onChange={(e) => setLimits({ ...limits, max_transaction_near: e.target.value })} /></label>
                <label className="field">Daily limit (NEAR)<input className="input mono" value={limits.daily_limit_near} onChange={(e) => setLimits({ ...limits, daily_limit_near: e.target.value })} /></label>
              </div>
              <div className="notice">Raising the version invalidates every existing mandate and attestation by design; create fresh mandates afterwards.</div>
              <button className="btn" disabled={!token || !!busy} onClick={() => act('policy', '/owner/policy', { ...limits, allowed_recipients: limits.allowed_recipients.split(',').map((s) => s.trim()).filter(Boolean) })}>Sign policy update</button>
            </div>
          </Panel>
        </div>
      )}
      {data?.chain && <Panel eyebrow="Vault" title="Custody"><dl className="kv"><dt>Vault account</dt><dd><AccountLink id={chain.vault_id} /></dd><dt>Owner</dt><dd><AccountLink id={chain.owner_id} /></dd><dt>Attestor generation</dt><dd className="mono">{chain.attestor_generation}</dd><dt>Agent generation</dt><dd className="mono">{chain.agent_generation}</dd><dt>Storage usage</dt><dd className="mono">{chain.storage_usage} bytes</dd><dt>Audit events</dt><dd className="mono">{chain.audit_count}</dd><dt>Deploy tx</dt><dd>{data.deployment ? <TxLink hash={data.deployment.transaction_hash} /> : '—'}</dd><dt>Code hash</dt><dd><Hash value={data.deployment?.code_hash} /></dd></dl></Panel>}
    </>
  );
}
