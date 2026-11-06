'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { evidenceFile } from '../lib/data';
import { near, short } from '../lib/format';
import { Badge, Checks, Hash, InvoiceView, Panel, TxLink, Verdict } from './ui';

const STEPS = ['Authorized mandate', 'Invoice injection', 'Agent compromise', 'Adversarial replay', 'Security verdict', 'On-chain block', 'Legitimate execution', 'Conclusion'];

function Tx({ step }: { step: any }) {
  if (!step) return null;
  const e = step.evidence ?? {};
  return (
    <div className="item">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}><strong style={{ fontSize: 13 }}>{step.label}</strong><Badge tone={e.succeeded ? 'green' : 'red'}>{e.succeeded ? 'success' : 'rejected'}</Badge>{e.transaction_hash ? <Badge tone="cyan">real testnet tx</Badge> : <Badge tone="amber">rejected before broadcast</Badge>}</div>
        <div className="row tiny" style={{ marginTop: 4 }}>{e.transaction_hash ? <TxLink hash={e.transaction_hash} /> : <span className="mono subtle">{step.note ?? 'no transaction'}</span>}
          {e.failure && <span className="mono" style={{ color: 'var(--red)' }}>{String(e.failure).replace('Smart contract panicked: ', 'panicked: ')}</span>}</div>
      </div>
    </div>
  );
}

export function DemoMode({ onClose, onProbe }: { onClose: () => void; onProbe?: () => void }) {
  const [step, setStep] = useState(0);
  const [ev, setEv] = useState<any>(null);
  const [blocked, setBlocked] = useState<any>(null);
  const [allowed, setAllowed] = useState<any>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    Promise.all([evidenceFile('testnet-evidence.json'), evidenceFile('receipts/testnet-blocked.json'), evidenceFile('receipts/testnet-allowed.json')])
      .then(([a, b, c]) => { setEv(a); setBlocked(b); setAllowed(c); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  const flow = (id: string) => ev?.flows.find((f: any) => f.id === id);
  const find = (id: string, text: string) => flow(id)?.steps.find((s: any) => s.label.toLowerCase().includes(text));
  const adv = blocked?.evidence?.adversarial, ref = blocked?.evidence?.reference;
  const findings = blocked?.security_findings ?? [];
  const variations = blocked?.evidence?.variations ?? [];

  const stages: React.ReactNode[] = !ev || !blocked ? [<p key="l" className="lede">Loading recorded testnet evidence…</p>] : [
    <>
      <h2>The owner authorizes exactly one payment. The agent never sees this key.</h2>
      <p className="lede">Mandate <b>{ev.mandate.id}</b>: {ev.mandate.amount_near} NEAR to <b>{ev.principals.recipient}</b> for <b>{ev.mandate.purpose_id}</b>, bound to the SHA-256 of the authorized invoice. Written on-chain by the OWNER key, in its own process.</p>
      <div className="grid g2"><Panel title="Authorized invoice"><InvoiceView text={ev.mandate.invoice} /></Panel>
        <Panel title="On-chain mandate"><dl className="kv"><dt>Invoice SHA-256</dt><dd><Hash value={ev.mandate.invoice_sha256} /></dd><dt>Vault</dt><dd className="mono">{ev.vault}</dd><dt>Agent</dt><dd className="mono">{ev.principals.agent}</dd><dt>Attestor</dt><dd className="mono">{ev.principals.attestor}</dd></dl><div style={{ marginTop: 12 }}><Tx step={flow('owner-mandate')?.steps[0]} /></div></Panel></div>
    </>,
    <>
      <h2>An attacker slips an instruction into the invoice.</h2>
      <p className="lede">The invoice is untrusted data. The highlighted line is the injection: it tries to redirect the payment and inflate it tenfold.</p>
      <Panel title="Invoice as received by the agent"><InvoiceView text={adv.context.invoice} reference={ref.context.invoice} /></Panel>
    </>,
    <>
      <h2>The AI agent is compromised. It proposes paying the attacker.</h2>
      <p className="lede">This is intentional: the agent is untrusted. Its proposal was submitted on-chain and recorded as evidence of the attempted action.</p>
      <div className="grid g2">
        <Panel title="Agent proposal"><dl className="kv"><dt>Recipient</dt><dd className="mono" style={{ color: 'var(--red)' }}>{adv.proposal.intent.recipient}</dd><dt>Amount</dt><dd className="mono" style={{ color: 'var(--red)' }}>{near(adv.proposal.intent.amount, 4)} NEAR</dd><dt>Intent hash</dt><dd><Hash value={blocked.intent_hash} /></dd><dt>Mode</dt><dd><Badge tone="amber">{adv.proposal.mode}</Badge></dd></dl></Panel>
        <Panel title="Agent trace">{adv.proposal.notes.map((n: string, i: number) => <div key={i} className="item small">{n}</div>)}<div style={{ marginTop: 10 }}><Tx step={find('attack-invoice-injection', 'submits')} /></div></Panel>
      </div>
    </>,
    <>
      <h2>Counterfactual replay: same mandate, two inputs.</h2>
      <p className="lede">The replay engine runs the authorized invoice and the attacked invoice through the same agent and the same immutable mandate, then mutates every field to show what each invariant catches.</p>
      <div className="twins">
        <div className="twin ref"><div className="twin-head"><strong>REFERENCE</strong><span style={{ marginLeft: 'auto' }}><Badge tone="green">{ref.simulation_result}</Badge></span></div><div className="twin-body"><dl className="kv"><dt>Recipient</dt><dd className="mono">{ref.proposal.intent.recipient}</dd><dt>Amount</dt><dd className="mono">{near(ref.proposal.intent.amount)} NEAR</dd><dt>Violations</dt><dd>none</dd></dl></div></div>
        <div className="twin adv"><div className="twin-head"><strong>ADVERSARIAL</strong><span style={{ marginLeft: 'auto' }}><Badge tone="red">{adv.simulation_result}</Badge></span></div><div className="twin-body"><dl className="kv"><dt>Recipient</dt><dd className="mono" style={{ color: 'var(--red)' }}>{adv.proposal.intent.recipient}</dd><dt>Amount</dt><dd className="mono" style={{ color: 'var(--red)' }}>{near(adv.proposal.intent.amount)} NEAR</dd><dt>Violations</dt><dd className="mono tiny" style={{ color: 'var(--red)' }}>{adv.violations.join(', ')}</dd></dl></div></div>
      </div>
      <Verdict decision="ALLOW" title={`${variations.filter((v: any) => !v.eligible).length}/${variations.length} counterfactual variations blocked`} detail="Every single-field mutation and every injection the agent followed was rejected by at least one deterministic invariant." />
    </>,
    <>
      <h2>Security verdict: BLOCK — decided by invariants, explained by the swarm.</h2>
      <p className="lede">Three specialist investigators produced {findings.length} schema-validated findings. They explain; they do not authorize. The receipt binds the exact intent hash to all evidence under one Merkle root.</p>
      <div className="grid g2">
        <Panel title="Failed invariants"><Checks checks={blocked.deterministic_policy_results} onlyFailed /></Panel>
        <Panel title="Top findings">{findings.filter((f: any) => f.severity === 'critical').slice(0, 5).map((f: any, i: number) => <div key={i} className="item small"><Badge tone="red">{f.role}</Badge> {f.title}</div>)}<div style={{ marginTop: 10 }} className="kv"><span className="subtle tiny">Evidence root</span><Hash value={blocked.evidence_merkle_root_or_hash} /></div></Panel>
      </div>
    </>,
    <>
      <h2>On-chain: the vault refuses — even when the attestor key itself tries to approve.</h2>
      <p className="lede">The independent attestor denies on-chain. The agent insists and executes anyway: the contract panics. Then a deliberately compromised attestor forces an approval of a redirected payment: the contract re-checks the mandate and rejects it.</p>
      <div className="stack">
        <Tx step={find('attack-invoice-injection', 'denies')} />
        <Tx step={find('attack-invoice-injection', 'insists')} />
        <Tx step={find('attack-compromised-attestor', 'forces')} />
        <Tx step={find('attack-compromised-attestor', 'without any approval')} />
        <Tx step={find('replay', 're-execute')} />
        <Tx step={find('access-key-boundary', 'create_authorization')} />
      </div>
    </>,
    <>
      <h2>The legitimate payment goes through, on NEAR testnet.</h2>
      <p className="lede">Same agent, authentic invoice. Every invariant passes; the attestor approves the exact intent hash; the vault reserves budget, transfers 0.05 NEAR, and settles in its private callback.</p>
      <div className="stack">
        <Tx step={find('legitimate-payment', 'submits')} />
        <Tx step={find('legitimate-payment', 'approves')} />
        <Tx step={find('legitimate-payment', 'executes')} />
        <div className="item small">{flow('legitimate-payment')?.steps[3]?.label}</div>
        <div className="item small">Receipt <code>{short(allowed?.intent_hash, 12, 8)}</code>: {flow('legitimate-payment')?.steps.find((s: any) => s.label.includes('verify'))?.label}</div>
      </div>
    </>,
    <div style={{ display: 'grid', gap: 26, placeItems: 'start', paddingTop: 30 }}>
      <div className="final-message"><span className="a">The AI was compromised.</span><br /><span className="b">The financial authorization boundary was not.</span></div>
      <p className="lede">The deployed contract rejected every proposal outside the owner&apos;s mandate and executed the authorized one: {ev.summary.as_expected}/{ev.summary.steps} steps as expected across {ev.summary.transactions} real testnet transactions, each verifiable on the explorer.</p>
      {onProbe && <button className="btn primary" onClick={onProbe}>Now attack the live contract yourself<ArrowRight size={14} /></button>}
    </div>,
  ];

  return (
    <div className="demo" role="dialog" aria-label="Live demonstration">
      <div className="demo-top">
        <strong className="mono tiny" style={{ letterSpacing: '0.14em' }}>LIVE DEMONSTRATION</strong>
        <div className="demo-steps">{STEPS.map((s, i) => <button key={s} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => setStep(i)}>{String(i + 1).padStart(2, '0')} {s}</button>)}</div>
        <button className="icon-btn" onClick={onClose} aria-label="Exit demonstration"><X size={16} /></button>
      </div>
      <div className="demo-body">
        <AnimatePresence mode="wait">
          <motion.div key={step} className="demo-stage" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -10 }} transition={{ duration: 0.28 }}>
            <div className="row"><Badge tone="cyan">Step {step + 1} of {STEPS.length}</Badge><Badge tone="cyan">Real NEAR testnet evidence</Badge>{(step === 3 || step === 4) && <Badge tone="violet">deterministic analysis · reproducible</Badge>}</div>
            {stages[step] ?? stages[0]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="demo-foot">
        <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft size={14} />Back</button>
        <span className="subtle tiny">← → to navigate · Esc to exit</span>
        <button className="btn primary" onClick={() => (step === STEPS.length - 1 ? onClose() : setStep((s) => s + 1))}>{step === STEPS.length - 1 ? 'Finish' : 'Next'}<ArrowRight size={14} /></button>
      </div>
    </div>
  );
}
