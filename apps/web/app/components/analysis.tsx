'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { Background, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, FileWarning, FlaskConical, Landmark, Play, Receipt, Repeat2, ScanSearch, Scale, ShieldCheck } from 'lucide-react';
import { near, short } from '../lib/format';
import { Badge, Checks, Empty, Findings, InvoiceView, Panel, Provenance, Verdict, modeBadges } from './ui';

const STAGES = ['input', 'reference', 'adversarial', 'injection', 'fraud', 'redteam', 'replay', 'receipt', 'verdict'] as const;
const NODES: { id: string; stage: string; label: string; sub: string; icon: any; x: number; y: number }[] = [
  { id: 'input', stage: 'input', label: 'Untrusted input', sub: 'invoice · tools · messages', icon: FileWarning, x: 0, y: 170 },
  { id: 'agent', stage: 'adversarial', label: 'Transaction agent', sub: 'proposes an intent (untrusted)', icon: Bot, x: 230, y: 170 },
  { id: 'injection', stage: 'injection', label: 'Prompt-injection investigator', sub: 'instruction sources', icon: ScanSearch, x: 480, y: 20 },
  { id: 'fraud', stage: 'fraud', label: 'Financial fraud investigator', sub: 'proposal vs. mandate', icon: Scale, x: 480, y: 170 },
  { id: 'redteam', stage: 'redteam', label: 'Adversarial red team', sub: 'counterfactual mutations', icon: FlaskConical, x: 480, y: 320 },
  { id: 'replay', stage: 'replay', label: 'Counterfactual replay', sub: 'reference vs. adversarial', icon: Repeat2, x: 740, y: 170 },
  { id: 'receipt', stage: 'receipt', label: 'Verification receipt', sub: 'evidence Merkle root', icon: Receipt, x: 980, y: 90 },
  { id: 'vault', stage: 'verdict', label: 'Attestor + vault', sub: 'deterministic decision', icon: Landmark, x: 980, y: 250 },
];

export function SwarmView({ run }: { run: any }) {
  const events: any[] = run?.events ?? [];
  const [cursor, setCursor] = useState<number>(STAGES.length);
  const [role, setRole] = useState<'injection' | 'fraud' | 'redteam'>('injection');
  useEffect(() => setCursor(STAGES.length), [run]);
  const replay = () => {
    setCursor(0);
    STAGES.forEach((_, i) => setTimeout(() => setCursor(i + 1), 450 * (i + 1)));
  };
  const decision = run?.receipt?.final_decision ?? run?.decision;
  const nodes: Node[] = useMemo(() => NODES.map((n) => {
    const index = STAGES.indexOf(n.stage as any);
    const state = cursor > index ? (n.id === 'vault' ? (decision === 'ALLOW' ? 'allow' : 'block') : 'done') : cursor === index ? 'active' : 'idle';
    const count = ['injection', 'fraud', 'redteam'].includes(n.id) ? (run?.findings ?? []).filter((f: any) => f.role === n.id).length : null;
    const Icon = n.icon;
    return { id: n.id, position: { x: n.x, y: n.y }, draggable: false, data: { label: (
      <div className={`flow-node ${state}`}>
        <div className="t"><Icon size={14} />{n.label}</div>
        <div className="s">{n.sub}{count !== null ? ` · ${count} findings` : ''}{n.id === 'vault' && cursor > index ? ` · ${decision}` : ''}</div>
      </div>) }, style: { background: 'transparent', border: 'none', padding: 0, width: 'auto' } };
  }), [cursor, run, decision]);
  const edges: Edge[] = [
    ['input', 'agent'], ['agent', 'injection'], ['agent', 'fraud'], ['agent', 'redteam'], ['injection', 'replay'], ['fraud', 'replay'], ['redteam', 'replay'], ['replay', 'receipt'], ['receipt', 'vault'],
  ].map(([s, t]) => ({ id: `${s}-${t}`, source: s, target: t, animated: cursor < STAGES.length, style: { stroke: '#2bb8be', strokeWidth: 1.4 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#2bb8be' } }));

  if (!run) return <Panel><Empty>Select a run in the Attack Laboratory or run the pipeline first.</Empty></Panel>;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Provenance items={[...modeBadges(run), { label: `${events.length} recorded backend events`, tone: 'plain' }]} />
        <button className="btn sm" onClick={replay}><Play size={13} /> Replay recorded events</button>
      </div>
      <div className="flow-wrap">
        <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable={false} panOnDrag zoomOnScroll={false} proOptions={{ hideAttribution: true }}>
          <Background color="#1a2a33" gap={24} />
        </ReactFlow>
      </div>
      <div className="grid g-2-1">
        <Panel eyebrow="Specialist findings" title="Schema-validated evidence (explanations, not authority)" action={
          <div className="seg">{(['injection', 'fraud', 'redteam'] as const).map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r === 'redteam' ? 'Red team' : r === 'fraud' ? 'Fraud' : 'Injection'}</button>)}</div>}>
          <Findings findings={run.findings ?? []} role={role} />
        </Panel>
        <Panel eyebrow="Backend event log" title="What actually happened">
          <div className="list">
            {events.map((e, i) => (
              <div className="item" key={i}>
                <span className="mono tiny subtle" style={{ minWidth: 52 }}>{e.elapsed_ms.toFixed ? e.elapsed_ms.toFixed(1) : e.elapsed_ms} ms</span>
                <div><div className="mono tiny" style={{ fontWeight: 600 }}>{e.stage} · {e.actor}</div><div className="subtle tiny">{e.detail}</div></div>
              </div>
            ))}
          </div>
          <p className="subtle tiny" style={{ marginTop: 10 }}>No majority vote: the vault decides from deterministic invariants alone.</p>
        </Panel>
      </div>
    </>
  );
}

function Field({ label, a, b, mono = true }: { label: string; a: string; b?: string; mono?: boolean }) {
  const changed = b !== undefined && a !== b;
  return (<div><div className="eyebrow">{label}</div><div className={`diff-cell ${changed ? 'changed' : ''}`} style={mono ? undefined : { fontFamily: 'var(--sans)' }}>{a}</div></div>);
}

function Twin({ kind, trace, other }: { kind: 'ref' | 'adv'; trace: any; other: any }) {
  const i = trace.proposal.intent, o = kind === 'adv' ? other.proposal.intent : trace.proposal.intent;
  const blocked = trace.simulation_result !== 'EXECUTED';
  const extras = [...(trace.context.tool_results ?? []).map((t: any) => `tool ${t.tool}: ${t.output}`), ...(trace.context.messages ?? []).map((m: any) => `message from ${m.sender}: ${m.body}`)];
  return (
    <div className={`twin ${kind}`}>
      <div className="twin-head">
        {kind === 'ref' ? <ShieldCheck size={16} style={{ color: 'var(--green)' }} /> : <FileWarning size={16} style={{ color: 'var(--red)' }} />}
        <strong>{kind === 'ref' ? 'REFERENCE · authorized input' : 'ADVERSARIAL · attacker-controlled input'}</strong>
        <span style={{ marginLeft: 'auto' }}><Badge tone={blocked ? 'red' : 'green'}>{trace.simulation_result}</Badge></span>
      </div>
      <div className="twin-body">
        <div><div className="eyebrow">Input content</div><InvoiceView text={trace.context.invoice} reference={kind === 'adv' ? other.context.invoice : undefined} /></div>
        {extras.map((x, n) => <div key={n} className="notice">{x}</div>)}
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="Recipient" a={i.recipient} b={o.recipient} />
          <Field label="Amount (NEAR)" a={near(i.amount, 6)} b={near(o.amount, 6)} />
          <Field label="Authorization" a={i.authorization_id} b={o.authorization_id} />
          <Field label="Purpose" a={i.purpose_id} b={o.purpose_id} />
          <Field label="Invoice fingerprint" a={short(i.invoice_fingerprint, 12, 8)} b={short(o.invoice_fingerprint, 12, 8)} />
          <Field label="Intent hash" a={short(trace.intent_hash, 12, 8)} b={kind === 'adv' ? short(other.intent_hash, 12, 8) : undefined} />
        </div>
        <div><div className="eyebrow">Policy result</div><Checks checks={trace.policy_results} onlyFailed /></div>
        <div><div className="eyebrow">Vault lifecycle (replayed)</div>
          <div className="timeline">
            {trace.lifecycle.map((s: any, n: number) => {
              const bad = ['REJECTED', 'FAILED'].includes(s.outcome);
              return (<div className="tl" key={n}><div className={`dot ${bad ? 'bad' : s.outcome === 'DENIED' || s.outcome === 'SKIPPED' ? 'warn' : 'ok'}`} />
                <div><div className="title">{s.step}<Badge tone={bad ? 'red' : s.outcome === 'DENIED' ? 'amber' : 'green'}>{s.outcome}</Badge><span className="subtle tiny mono">{s.actor}</span></div>
                  <div className="detail">{s.codes?.length ? <span className="mono" style={{ color: 'var(--red)' }}>{s.codes.join(', ')}</span> : null} {s.detail}</div></div></div>);
            })}
          </div>
        </div>
        {trace.proposal.notes?.length ? <div><div className="eyebrow">Agent notes</div><ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{trace.proposal.notes.map((n: string, k: number) => <li key={k}>{n}</li>)}</ul></div> : null}
      </div>
    </div>
  );
}

export function TwinViewer({ run }: { run: any }) {
  if (!run?.reference || !run?.adversarial) return <Panel><Empty>Select a run in the Attack Laboratory or run the pipeline first.</Empty></Panel>;
  const blockedBy = run.adversarial.violations ?? [];
  const variations: any[] = run.variations ?? [];
  return (
    <>
      <Verdict decision={run.adversarial.simulation_result === 'EXECUTED' || run.decision === 'ALLOW' ? 'ALLOW' : 'BLOCK'}
        title={run.scenario?.title ?? `Pipeline ${run.id ?? ''}`}
        detail={blockedBy.length ? `Same immutable mandate, different input. Blocking invariants: ${blockedBy.join(', ')}` : 'Same immutable mandate; the adversarial input did not change the outcome.'} />
      <Provenance items={modeBadges(run)} />
      <div className="twins">
        <Twin kind="ref" trace={run.reference} other={run.adversarial} />
        <Twin kind="adv" trace={run.adversarial} other={run.reference} />
      </div>
      <Panel eyebrow="Red-team replay" title={`${variations.filter((v) => !v.eligible).length}/${variations.length} counterfactual variations blocked`}>
        <div className="scroll-x"><table className="table"><thead><tr><th>Variation</th><th>Kind</th><th>Challenged</th><th>Agent fooled?</th><th>Blocked by</th></tr></thead><tbody>
          {variations.map((v) => (
            <tr key={v.id}>
              <td><div style={{ fontWeight: 600 }}>{v.description}</div><div className="subtle tiny mono">{v.id}</div></td>
              <td><Badge>{v.kind}</Badge></td><td className="mono tiny">{v.challenged_invariant}</td>
              <td>{v.agent_followed_injection === null || v.agent_followed_injection === undefined ? <span className="subtle">n/a</span> : v.agent_followed_injection ? <Badge tone="amber">followed</Badge> : <Badge tone="green">resisted</Badge>}</td>
              <td>{v.eligible ? <Badge tone="red">NOT BLOCKED</Badge> : <span className="mono tiny" style={{ color: 'var(--red)' }}>{v.violations.join(', ')}</span>}</td>
            </tr>
          ))}
        </tbody></table></div>
      </Panel>
    </>
  );
}
