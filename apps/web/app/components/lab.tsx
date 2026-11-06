'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, PlayCircle } from 'lucide-react';
import { api, loadLabRuns, type Mode } from '../lib/data';
import { Badge, Empty, Panel, Provenance, Stat, Verdict, modeBadges } from './ui';
import { StepTimeline } from './command';

const TONE: Record<string, any> = { CONTROL: 'green', PROMPT_INJECTION: 'red', TOOL_POISONING: 'red', FINANCIAL_FRAUD: 'amber', PAYMENT_REDIRECTION: 'amber', REPLAY: 'violet', CONCURRENCY: 'violet', SETTLEMENT: 'cyan' };

export function AttackLab({ mode, selected, onSelect }: { mode: Mode; selected: any; onSelect: (run: any) => void }) {
  const [runs, setRuns] = useState<Record<string, any>>({});
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [busy, setBusy] = useState<string>('');
  const [filter, setFilter] = useState('ALL');
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadLabRuns(mode).then((list) => {
      const byId: Record<string, any> = {};
      for (const r of list) if (!byId[r.scenario.id]) byId[r.scenario.id] = r;
      setRuns(byId);
      if (!selected && byId['02']) onSelect(byId['02']);
    }).catch((e) => setError(String(e)));
    if (mode === 'live') api<any[]>('/lab/scenarios').then(setScenarios).catch(() => undefined);
    else loadLabRuns(mode).then((list) => setScenarios(list.map((r) => r.scenario))).catch(() => undefined);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useMemo(() => ['ALL', ...new Set(scenarios.map((s) => s.category))], [scenarios]);
  const run = async (id: string) => {
    setBusy(id); setError('');
    try {
      const r = await api(`/lab/scenarios/${id}/run`, { request_id: `ui-${id}-${Date.now()}` });
      setRuns((m) => ({ ...m, [id]: r })); onSelect(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };
  const runAll = async () => {
    setBusy('ALL'); setError('');
    try {
      const r = await api('/lab/run-all', { request_id: `ui-all-${Date.now()}` });
      const byId: Record<string, any> = {};
      for (const x of r.runs) byId[x.scenario.id] = x;
      setRuns(byId); setSummary(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };
  const all = Object.values(runs);
  const stats = summary ?? (all.length ? {
    total: all.length, correctly_blocked: all.filter((r) => r.expected.decision === 'BLOCK' && r.decision === 'BLOCK').length,
    legitimate_successes: all.filter((r) => r.expected.decision === 'ALLOW' && r.decision === 'ALLOW').length,
    unexpected_approvals: all.filter((r) => r.expected.decision === 'BLOCK' && r.decision === 'ALLOW').length,
    unexpected_rejections: all.filter((r) => r.expected.decision === 'ALLOW' && r.decision === 'BLOCK').length,
    average_evaluation_ms: all.reduce((n, r) => n + r.metrics.evaluation_ms, 0) / all.length,
  } : null);
  const shown = scenarios.filter((s) => filter === 'ALL' || s.category === filter);
  return (
    <>
      {mode !== 'live' && <div className="notice info">Recorded runs from the Python replay engine (<code>pnpm demo:offline</code>), bundled with this page. Run <code>pnpm dev</code> locally to execute scenarios live.</div>}
      {stats && (
        <div className="grid g4">
          <Stat label="Scenarios" value={stats.total} hint="Synthetic, reproducible fixtures" />
          <Stat label="Attacks blocked" value={`${stats.correctly_blocked}`} hint={`Unexpected approvals: ${stats.unexpected_approvals}`} glow="rgba(255,92,108,0.12)" />
          <Stat label="Legitimate handled" value={stats.legitimate_successes} hint={`Unexpected rejections: ${stats.unexpected_rejections}`} glow="rgba(61,220,151,0.1)" />
          <Stat label="Mean evaluation" value={Number(stats.average_evaluation_ms).toFixed(1)} unit="ms" hint="Offline heuristic · no paid inference" />
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="seg">{categories.map((c) => <button key={c} className={filter === c ? 'on' : ''} onClick={() => setFilter(c)}>{c.replaceAll('_', ' ').toLowerCase()}</button>)}</div>
        {mode === 'live' && <button className="btn primary" onClick={runAll} disabled={!!busy}>{busy === 'ALL' ? <Loader2 size={15} className="spin" /> : <PlayCircle size={15} />}Run all scenarios</button>}
      </div>
      {error && <div className="notice">{error}</div>}
      <div className="cards">
        {shown.map((s) => {
          const r = runs[s.id];
          return (
            <div key={s.id} className={`card ${selected?.scenario?.id === s.id ? 'selected' : ''}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}><Badge tone={TONE[s.category] ?? 'plain'}>{s.category.replaceAll('_', ' ')}</Badge><span className="mono tiny subtle">#{s.id}</span></div>
              <h3>{s.title}</h3>
              <p>{s.threat}</p>
              <p><span className="subtle">Attack objective: </span>{s.proposed_malicious_action}</p>
              <div className="foot">
                {r ? <span className="row" style={{ gap: 6 }}><Badge tone={r.decision === 'ALLOW' ? 'green' : 'red'}>{r.outcome}</Badge>{r.matches_expected ? <Badge tone="cyan">as expected</Badge> : <Badge tone="amber">unexpected</Badge>}</span> : <span className="subtle tiny">expected {s.expected.decision}</span>}
                <div className="row" style={{ gap: 6 }}>
                  {r && <button className="btn sm ghost" onClick={() => onSelect(r)}>Inspect</button>}
                  {mode === 'live' && <button className="btn sm" onClick={() => run(s.id)} disabled={!!busy}>{busy === s.id ? <Loader2 size={13} className="spin" /> : <Play size={13} />}Run</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {selected?.scenario && (
        <div className="grid g2">
          <Panel eyebrow={`Scenario ${selected.scenario.id}`} title={selected.scenario.title}>
            <div className="stack">
              <Verdict decision={selected.decision === 'ALLOW' ? 'ALLOW' : 'BLOCK'} title={`${selected.decision} · ${selected.outcome}`} detail={selected.expected?.contract_behavior} />
              <Provenance items={modeBadges(selected)} />
              <dl className="kv">
                <dt>Legitimate objective</dt><dd>{selected.scenario.legitimate_objective}</dd>
                <dt>Malicious action</dt><dd>{selected.scenario.proposed_malicious_action}</dd>
                <dt>Expected</dt><dd>{selected.expected.decision} / {selected.expected.outcome}</dd>
                <dt>Observed</dt><dd>{selected.decision} / {selected.outcome} {selected.matches_expected ? <Badge tone="cyan">match</Badge> : <Badge tone="amber">mismatch</Badge>}</dd>
                <dt>Blocking invariants</dt><dd className="mono tiny" style={{ color: 'var(--red)' }}>{selected.observed_invariants.join(', ') || '—'}</dd>
                <dt>Unprotected baseline</dt><dd>{selected.baseline?.would_transfer ? `Would have signed ${selected.baseline.would_transfer.amount_near} NEAR → ${selected.baseline.would_transfer.recipient} (simulated only; funds never move)` : 'Not applicable to this scenario'}</dd>
                <dt>Evidence</dt><dd className="mono tiny">{selected.scenario.path}</dd>
              </dl>
            </div>
          </Panel>
          <Panel eyebrow="Execution timeline" title="Adversarial twin through the vault">
            <StepTimeline steps={(selected.adversarial?.lifecycle ?? []).map((s: any) => ({ name: s.step, actor: s.actor, status: s.outcome, detail: `${s.codes?.length ? s.codes.join(', ') + ' — ' : ''}${s.detail}` }))} />
            {selected.extras?.tamper_checks && (
              <div className="stack" style={{ marginTop: 12 }}>
                {selected.extras.tamper_checks.map((t: any, i: number) => (
                  <div key={i} className="item"><div><div style={{ fontWeight: 600, fontSize: 12.5 }}>{t.tamper}</div>
                    <div className="tiny muted">{t.integrity} · {t.policy}{t.authoritative_violations ? ` · live mandate check: ${t.authoritative_violations.join(', ')}` : ''}</div>
                    {t.lesson && <div className="tiny" style={{ color: 'var(--amber)', marginTop: 3 }}>{t.lesson}</div>}</div></div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
      {!scenarios.length && <Panel><Empty>Loading scenarios…</Empty></Panel>}
    </>
  );
}
