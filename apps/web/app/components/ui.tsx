'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, type ReactNode } from 'react';
import { Check, CircleAlert, Copy, ExternalLink, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { EXPLORER } from '../lib/data';
import { human, short } from '../lib/format';

export function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' | 'plain' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Panel({ title, eyebrow, action, children, className = '' }: { title?: ReactNode; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || eyebrow || action) && (
        <div className="panel-head">
          <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}{title && <h2>{title}</h2>}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, unit, hint, glow, meter }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode; glow?: string; meter?: number }) {
  return (
    <div className="panel stat" style={glow ? ({ '--glow': glow } as React.CSSProperties) : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}{unit && <small>{unit}</small>}</div>
      {meter !== undefined && <div className="meter"><i style={{ width: `${meter}%` }} /></div>}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="icon-btn" aria-label={`Copy ${label}`} title={`Copy ${label}`}
      onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function Hash({ value, label = 'value' }: { value?: string | null; label?: string }) {
  if (!value) return <span className="subtle mono tiny">not recorded</span>;
  return <span className="hash"><code title={value}>{value}</code><CopyButton value={value} label={label} /></span>;
}

export function TxLink({ hash, label }: { hash?: string | null; label?: string }) {
  if (!hash) return <span className="subtle tiny mono">no transaction</span>;
  return <a className="txlink" href={`${EXPLORER}/txns/${hash}`} target="_blank" rel="noreferrer">{label ?? short(hash, 10, 8)}<ExternalLink size={11} /></a>;
}

export function AccountLink({ id }: { id?: string | null }) {
  if (!id) return <span className="subtle">—</span>;
  return <a className="txlink" href={`${EXPLORER}/address/${id}`} target="_blank" rel="noreferrer">{id}<ExternalLink size={11} /></a>;
}

export function Checks({ checks, onlyFailed = false }: { checks: { invariant: string; passed: boolean; detail: string }[]; onlyFailed?: boolean }) {
  const shown = onlyFailed ? checks.filter((c) => !c.passed) : checks;
  if (!shown.length) return <div className="muted small">Every deterministic invariant passes.</div>;
  return (
    <div className="checks">
      {shown.map((c) => (
        <div key={c.invariant} className={`check ${c.passed ? 'pass' : 'fail'}`}>
          {c.passed ? <Check size={15} /> : <X size={15} />}
          <div><div className="code">{c.invariant}</div><div className="why">{c.detail}</div></div>
          <span className={`tiny mono ${c.passed ? 'subtle' : ''}`} style={{ color: c.passed ? undefined : 'var(--red)' }}>{c.passed ? 'PASS' : 'FAIL'}</span>
        </div>
      ))}
    </div>
  );
}

export function Verdict({ decision, title, detail }: { decision: 'ALLOW' | 'BLOCK' | 'WARN'; title: ReactNode; detail?: ReactNode }) {
  const cls = decision === 'ALLOW' ? 'allow' : decision === 'BLOCK' ? 'block' : 'warn';
  const Icon = decision === 'ALLOW' ? ShieldCheck : decision === 'BLOCK' ? ShieldAlert : CircleAlert;
  return (
    <div className={`verdict ${cls}`}>
      <div className="ic"><Icon size={22} /></div>
      <div><h3>{title}</h3>{detail && <p>{detail}</p>}</div>
    </div>
  );
}

export function Provenance({ items }: { items: { label: string; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' | 'plain' }[] }) {
  return <div className="provenance">{items.map((i) => <Badge key={i.label} tone={i.tone ?? 'plain'}>{i.label}</Badge>)}</div>;
}

export function modeBadges(run: any) {
  const items: { label: string; tone: any }[] = [];
  const inference = run?.receipt?.inference_mode ?? run?.mode;
  if (inference) items.push({ label: inference === 'OFFLINE_HEURISTIC' ? 'Deterministic agent · reproducible' : inference === 'REAL_LLM_INFERENCE' ? 'LLM agent' : inference, tone: 'violet' });
  const exec = run?.receipt?.execution_mode ?? run?.execution_mode;
  if (exec) items.push({ label: exec === 'TESTNET' ? 'Real NEAR testnet' : 'Vault simulation · same invariants', tone: exec === 'TESTNET' ? 'cyan' : 'plain' });
  return items;
}

export function InvoiceView({ text, reference }: { text: string; reference?: string }) {
  const refLines = new Set((reference ?? text).split('\n'));
  const lines = text.replace(/\n$/, '').split('\n');
  const render = (line: string) => {
    const parts: ReactNode[] = [];
    let buffer = '';
    let hidden = '';
    for (const ch of line) {
      const code = ch.codePointAt(0)!;
      if (code >= 0xe0000 && code <= 0xe007f) { if (buffer) { parts.push(buffer); buffer = ''; } hidden += String.fromCodePoint(code - 0xe0000); continue; }
      if (hidden) { parts.push(<span key={parts.length} className="hidden-ch" title="Invisible Unicode tag characters">⟦hidden: {hidden}⟧</span>); hidden = ''; }
      if (/[​-‏⁠-⁤﻿]/.test(ch)) { parts.push(buffer); buffer = ''; parts.push(<span key={parts.length} className="hidden-ch">·</span>); continue; }
      buffer += ch;
    }
    if (hidden) parts.push(<span key={parts.length} className="hidden-ch" title="Invisible Unicode tag characters">⟦hidden: {hidden}⟧</span>);
    if (buffer) parts.push(buffer);
    return parts;
  };
  return (
    <div className="code-view">
      {lines.map((line, i) => (
        <div key={i} className={`ln ${reference !== undefined && !refLines.has(line) ? 'added' : ''}`}>
          <span className="n">{i + 1}</span><span className="t">{render(line) }</span>
        </div>
      ))}
    </div>
  );
}

export function Findings({ findings, role }: { findings: any[]; role?: string }) {
  const shown = role ? findings.filter((f) => f.role === role) : findings;
  if (!shown.length) return <div className="muted small">No findings.</div>;
  return (
    <div className="stack">
      {shown.map((f, i) => (
        <div key={i} className={`finding ${f.severity}`}>
          <div className="h">
            <Badge tone={f.severity === 'critical' ? 'red' : f.severity === 'warning' ? 'amber' : 'cyan'}>{f.severity}</Badge>
            <span>{f.title}</span>
            <span className="subtle tiny mono">{f.code}</span>
          </div>
          <div className="d">{f.detail}</div>
          {(f.channel || f.location) && <div className="subtle tiny mono">{[f.channel, f.location, f.invariant].filter(Boolean).join(' · ')}</div>}
          {f.excerpt && <div className="x">{f.excerpt}</div>}
        </div>
      ))}
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><div>{children}</div>{action}</div>;
}

export function codesOf(steps: any[] = []): string[] {
  return [...new Set(steps.flatMap((s) => s.codes ?? s.chain?.violated_invariants ?? []))];
}

export const titleCase = human;
