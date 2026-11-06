'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment } from 'react';
import { Activity, KeyRound, Landmark, ShieldCheck } from 'lucide-react';
import type { Dashboard } from '../lib/data';
import { ago, date, near, pct, short } from '../lib/format';
import { AccountLink, Badge, Empty, Hash, Panel, Stat, TxLink, Verdict } from './ui';

export function MissionControl({ data }: { data: Dashboard | null }) {
  if (!data) return <Panel><Empty>Loading vault state…</Empty></Panel>;
  const chain = data.chain ?? {};
  const intents = data.recent_intents ?? [];
  const count = (status: string) => intents.filter((i: any) => i.status === status).length;
  const ledger = data.ledger ?? [];
  const rejected = ledger.filter((t: any) => t.succeeded === false && t.transaction_hash).length;
  const executed = ledger.filter((t: any) => t.succeeded && /execute/i.test(t.operation ?? t.label ?? '')).length;
  const spent = (BigInt(chain.today?.spent ?? '0') + BigInt(chain.today?.reserved ?? '0')).toString();
  const testnet = data.mode === 'TESTNET';
  return (
    <>
      {data.chain_error
        ? <Verdict decision="WARN" title="Vault state unavailable" detail={data.chain_error} />
        : <Verdict decision="ALLOW" title={chain.paused ? 'Vault paused by the owner' : 'Authorization boundary holding'}
            detail={`${testnet ? 'Live NEAR testnet vault' : 'Local simulation vault'} ${chain.vault_id ?? ''} · contract v${chain.contract_version ?? '?'} · policy v${chain.policy_version ?? '?'} · ${rejected} unauthorized attempts rejected by the contract in the recorded ledger.`} />}
      <div className="grid g4">
        <Stat label="Vault available" value={near(chain.available, 3)} unit="NEAR" hint={`Balance ${near(chain.balance, 3)} · storage ${near(chain.storage_cost, 2)}`} />
        <Stat label="Daily budget" value={near(spent, 3)} unit={`/ ${near(chain.daily_limit, 3)} NEAR`} meter={pct(spent, chain.daily_limit)} hint="Spent + reserved today" glow="rgba(242,184,75,0.1)" />
        <Stat label="Active agents" value={chain.agent_id ? 1 : 0} hint={chain.agent_id ? `${short(chain.agent_id, 16, 0)} · gen ${chain.agent_generation}` : 'Agent revoked'} glow="rgba(167,139,250,0.1)" />
        <Stat label="Pending transfers" value={Number(chain.pending_transfers ?? 0)} hint={`${count('PROPOSED')} proposed · ${count('ATTESTED')} attested`} />
      </div>
      <div className="grid g4">
        <Stat label="Executed payments" value={count('EXECUTED')} hint="In the 12 most recent intents" glow="rgba(61,220,151,0.1)" />
        <Stat label="Blocked attempts" value={count('REJECTED') + count('EXPIRED')} hint="Denied or expired proposals" glow="rgba(255,92,108,0.12)" />
        <Stat label="Contract rejections" value={rejected} hint="Real failed transactions in the ledger" glow="rgba(255,92,108,0.12)" />
        <Stat label="Intents recorded" value={Number(chain.intent_count ?? 0)} hint={`${chain.intents_today ?? 0} today · ${executed} executions in ledger`} />
      </div>
      <div className="grid g-2-1">
        <Panel eyebrow={testnet ? 'NEAR testnet' : 'Local simulation'} title="Recent transactions" action={<Badge tone={testnet ? 'cyan' : 'plain'}>{testnet ? 'real tx hashes' : 'simulated'}</Badge>}>
          {ledger.length ? (
            <div className="scroll-x"><table className="table"><thead><tr><th>Action</th><th>Signer</th><th>Outcome</th><th>Transaction</th></tr></thead><tbody>
              {ledger.slice(0, 14).map((t: any, i: number) => (
                <tr key={i}>
                  <td>{t.label ?? t.operation}</td>
                  <td className="mono tiny">{t.role ?? short(t.signer_id, 10, 0)}</td>
                  <td>{t.succeeded ? <Badge tone="green">success</Badge> : <><Badge tone="red">rejected</Badge><div className="mono tiny" style={{ color: 'var(--red)', marginTop: 4 }}>{(t.violated_invariants ?? []).join(', ') || String(t.failure ?? '').replace('Smart contract panicked: ', '').slice(0, 80)}</div></>}</td>
                  <td>{t.transaction_hash ? <TxLink hash={t.transaction_hash} /> : <span className="subtle tiny">{t.mode === 'LOCAL_SIMULATION' ? 'simulated' : 'none'}</span>}</td>
                </tr>
              ))}
            </tbody></table></div>
          ) : <Empty>No transactions yet. Run the pipeline from the Transaction Center.</Empty>}
        </Panel>
        <Panel eyebrow="On-chain audit trail" title="Latest vault events">
          <div className="list">
            {(data.recent_audit ?? []).slice(0, 10).map((e: any) => (
              <div className="item" key={e.id}>
                <Activity size={14} style={{ color: /DENIED|FAILED|REVOKED|PAUSED/.test(e.event) ? 'var(--red)' : /EXECUTED|ATTESTED/.test(e.event) ? 'var(--green)' : 'var(--cyan)', marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="mono tiny" style={{ fontWeight: 600 }}>{e.event}</div>
                  <div className="subtle tiny">{short(e.caller, 14, 0)} · {ago(e.timestamp_ms)}{e.subject ? ` · ${short(e.subject, 10, 4)}` : ''}</div>
                </div>
              </div>
            ))}
            {!data.recent_audit?.length && <Empty>No events.</Empty>}
          </div>
        </Panel>
      </div>
      <div className="grid g2">
        <Panel eyebrow="Independent principals" title="Who can do what">
          <dl className="kv">
            <dt><Landmark size={12} /> VAULT</dt><dd><AccountLink id={data.principals?.vault} /><div className="subtle tiny">Custodies funds; executes only attested, mandate-matching intents.</div></dd>
            <dt><KeyRound size={12} /> OWNER</dt><dd><AccountLink id={data.principals?.owner} /><div className="subtle tiny">Writes mandates and policy. Never seen by the agent or browser.</div></dd>
            <dt>AGENT</dt><dd><AccountLink id={data.principals?.agent} /><div className="subtle tiny">Function-call key: submit_intent, execute_intent only.</div></dd>
            <dt><ShieldCheck size={12} /> ATTESTOR</dt><dd><AccountLink id={data.principals?.attestor} /><div className="subtle tiny">Separate process and key: attest_intent only.</div></dd>
          </dl>
        </Panel>
        <Panel eyebrow="Deployment proof" title="Contract on NEAR testnet">
          {data.deployment ? (
            <dl className="kv">
              <dt>Code hash</dt><dd><Hash value={data.deployment.code_hash} label="code hash" /></dd>
              <dt>WASM sha256</dt><dd><Hash value={data.deployment.wasm_sha256} label="wasm sha256" /></dd>
              <dt>Deploy + init</dt><dd><TxLink hash={data.deployment.transaction_hash} /> <span className="subtle tiny">{date(Date.parse(data.deployment.deployed_at))}</span></dd>
              {(data.deployment.upgrades ?? []).map((u: any, i: number) => <Fragment key={i}><dt>Upgrade {i + 1}</dt><dd><TxLink hash={u.transaction_hash} /> <span className="subtle tiny">{u.reason}</span></dd></Fragment>)}
              <dt>Reproduce</dt><dd className="small muted">pnpm build:contract → compare sha256; NEAR code hash = base58(sha256(wasm)).</dd>
            </dl>
          ) : <Empty>No deployment record.</Empty>}
        </Panel>
      </div>
    </>
  );
}
