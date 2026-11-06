'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { Download, FlaskConical, RotateCcw, ShieldCheck } from 'lucide-react';
import { digest, verifyReceipt } from '@aegis/receipt-verifier';
import { loadReceipts } from '../lib/data';
import { date, near } from '../lib/format';
import { Badge, Checks, Empty, Findings, Hash, Panel, Provenance, TxLink, Verdict, modeBadges } from './ui';

export function EvidenceExplorer({ run }: { run: any }) {
  const [shipped, setShipped] = useState<{ name: string; label: string; receipt: any }[]>([]);
  const [source, setSource] = useState('');
  const [tab, setTab] = useState<'policy' | 'findings' | 'traces' | 'json'>('policy');
  const [tampered, setTampered] = useState<any>(null);
  useEffect(() => { loadReceipts().then((list) => { setShipped(list); if (!run?.receipt && list[0]) setSource(list[0].name); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (run?.receipt) setSource('selected'); }, [run]);
  useEffect(() => setTampered(null), [source]);

  const options = [...(run?.receipt ? [{ name: 'selected', label: `Selected run · ${run.scenario?.title ?? run.id ?? ''}`, receipt: run.receipt }] : []), ...shipped];
  const chosen = options.find((o) => o.name === source) ?? options[0];
  const receipt = tampered ?? chosen?.receipt;
  const verification = useMemo(() => (receipt ? verifyReceipt(receipt) : null), [receipt]);
  if (!receipt) return <Panel><Empty>Loading receipts…</Empty></Panel>;

  const tamper = () => {
    const copy = structuredClone(chosen!.receipt);
    copy.final_decision = copy.final_decision === 'ALLOW' ? 'BLOCK' : 'ALLOW';
    const { receipt_hash: _drop, ...body } = copy;
    copy.receipt_hash = digest(body);
    setTampered(copy);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `cvr-${receipt.intent_hash.slice(0, 12)}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const ok = verification && !verification.errors.length;
  const e = receipt.evidence;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <select className="input" style={{ maxWidth: 520 }} value={chosen?.name} onChange={(ev) => setSource(ev.target.value)}>
          {options.map((o) => <option key={o.name} value={o.name}>{o.label}</option>)}
        </select>
        <div className="row">
          {tampered ? <button className="btn" onClick={() => setTampered(null)}><RotateCcw size={14} />Restore original</button>
            : <button className="btn danger" onClick={tamper}><FlaskConical size={14} />Tamper: flip the verdict & re-hash</button>}
          <button className="btn" onClick={download}><Download size={14} />Download JSON</button>
        </div>
      </div>
      <Verdict decision={!ok ? 'BLOCK' : receipt.final_decision === 'ALLOW' ? 'ALLOW' : 'WARN'}
        title={!ok ? 'Receipt failed independent verification' : `Receipt verified · decision ${receipt.final_decision}`}
        detail={!ok ? verification?.errors.join(' · ') : 'Recomputed in your browser by an independent TypeScript implementation (canonical Borsh, Merkle root, every policy check).'} />
      <div className="row">
        <Badge tone={verification?.integrity === 'INTEGRITY VERIFIED' ? 'green' : 'red'}>{verification?.integrity}</Badge>
        <Badge tone={verification?.policy === 'POLICY VERIFIED' ? 'green' : 'red'}>{verification?.policy}</Badge>
        <Badge tone={receipt.attestation_transaction_hash ? 'cyan' : 'plain'}>{receipt.attestation_transaction_hash ? 'On-chain attestation recorded' : 'Local evidence receipt'}</Badge>
        <Badge tone="violet">Analysis advisory · invariants authorize</Badge>
        {tampered && <Badge tone="red">tampered copy</Badge>}
      </div>
      <Provenance items={modeBadges({ receipt })} />
      <div className="grid g2">
        <Panel eyebrow="Counterfactual Verification Receipt" title="Transaction binding">
          <dl className="kv">
            <dt>Intent hash</dt><dd><Hash value={receipt.intent_hash} label="intent hash" /></dd>
            <dt>Receipt hash</dt><dd><Hash value={receipt.receipt_hash} label="receipt hash" /></dd>
            <dt>Evidence root</dt><dd><Hash value={receipt.evidence_merkle_root_or_hash} label="evidence root" /><div className="subtle tiny">Committed on-chain by the attestor</div></dd>
            <dt>Attestation tx</dt><dd>{receipt.attestation_transaction_hash ? <TxLink hash={receipt.attestation_transaction_hash} /> : <span className="subtle tiny">local evidence receipt (no chain write)</span>}</dd>
            <dt>Attestor</dt><dd className="mono">{receipt.attestor_id}</dd>
            <dt>Recipient · amount</dt><dd className="mono">{receipt.intent.recipient} · {near(receipt.intent.amount, 6)} NEAR</dd>
            <dt>Mandate</dt><dd className="mono">{receipt.authorization_id} (policy v{receipt.policy_version})</dd>
            <dt>Invoice fingerprint</dt><dd><Hash value={receipt.invoice_fingerprint} label="invoice fingerprint" /></dd>
            <dt>Evaluated</dt><dd>{date(receipt.evaluation_timestamp)} · expires {date(receipt.expiration)}</dd>
            <dt>Tests replayed</dt><dd className="small">{receipt.adversarial_test_ids.length} ({receipt.adversarial_test_ids.slice(0, 4).join(', ')}…)</dd>
          </dl>
        </Panel>
        <Panel eyebrow="Verify it yourself" title="Command line">
          <div className="stack small">
            <div className="code-view"><div>pnpm aegis:verify --receipt examples/receipts/{chosen?.name === 'selected' ? '<file>.json' : chosen?.name}{receipt.attestation_transaction_hash ? ' --network' : ''}</div></div>
            <p className="muted">The CLI (Python) and this page (TypeScript) are separate implementations; the test suite proves both agree with the Rust contract on every policy vector.</p>
            <p className="muted">What verification proves: the decision follows deterministically from the bound evidence and, with <code>--network</code>, the vault recorded that exact decision for this intent hash. Findings explain; invariants decide.</p>
            <div className="row"><ShieldCheck size={14} style={{ color: 'var(--green)' }} /><span className="tiny muted">{verification?.verifier} verifier · {verification?.errors.length ?? 0} errors</span></div>
          </div>
        </Panel>
      </div>
      <Panel action={<div className="seg">{(['policy', 'findings', 'traces', 'json'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>} title="Evidence">
        {tab === 'policy' && <Checks checks={receipt.deterministic_policy_results} />}
        {tab === 'findings' && <Findings findings={receipt.security_findings} />}
        {tab === 'traces' && (
          <div className="grid g2">
            {(['reference', 'adversarial'] as const).map((name) => (
              <div key={name} className="stack">
                <div className="eyebrow">{name} · {e[name].simulation_result}</div>
                {e[name].lifecycle.map((s: any, i: number) => <div key={i} className="item"><div><div className="mono tiny" style={{ fontWeight: 600 }}>{s.step} · {s.actor} · {s.outcome}</div><div className="subtle tiny">{s.codes?.join(', ')} {s.detail}</div></div></div>)}
              </div>
            ))}
          </div>
        )}
        {tab === 'json' && <pre className="code-view" style={{ maxHeight: 480 }}>{JSON.stringify(receipt, null, 2)}</pre>}
      </Panel>
    </>
  );
}
