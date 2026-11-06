'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import { Boxes, FileCheck2, FlaskConical, GitCompareArrows, Landmark, LayoutDashboard, Menu, Network, Play, RefreshCw, Shield, TerminalSquare } from 'lucide-react';
import { detectMode, loadDashboard, type Dashboard, type Mode } from './lib/data';
import { MissionControl } from './components/mission';
import { CommandCenter } from './components/command';
import { SwarmView, TwinViewer } from './components/analysis';
import { AttackLab } from './components/lab';
import { PolicyVault } from './components/vault';
import { EvidenceExplorer } from './components/evidence';
import { DemoMode } from './components/demo';
import { Badge } from './components/ui';

const VIEWS = [
  { id: 'mission', label: 'Mission Control', icon: LayoutDashboard, title: 'Mission Control', sub: 'Live vault state, budget, and the on-chain ledger of every attempt.' },
  { id: 'command', label: 'Agent Command', icon: TerminalSquare, title: 'Agent Command Center', sub: 'Hand the agent untrusted input and watch the authorization boundary decide.' },
  { id: 'swarm', label: 'Security Swarm', icon: Network, title: 'Security Swarm', sub: 'Three specialist investigators explain the decision. They do not authorize.' },
  { id: 'twin', label: 'Counterfactual Twin', icon: GitCompareArrows, title: 'Counterfactual Twin', sub: 'Same mandate, two inputs: authorized versus attacker-controlled.' },
  { id: 'lab', label: 'Attack Laboratory', icon: FlaskConical, title: 'Attack Laboratory', sub: '23 reproducible attack and control scenarios across 18 threat categories.' },
  { id: 'vault', label: 'Policy Vault', icon: Landmark, title: 'Policy Vault', sub: 'Owner policy, business mandates, and custody — written only by the owner key.' },
  { id: 'evidence', label: 'Evidence Explorer', icon: FileCheck2, title: 'Evidence Explorer', sub: 'Verify Counterfactual Verification Receipts independently, in your browser.' },
] as const;
type View = (typeof VIEWS)[number]['id'];

export default function Home() {
  const [mode, setMode] = useState<Mode>('loading');
  const [view, setView] = useState<View>('mission');
  const [data, setData] = useState<Dashboard | null>(null);
  const [run, setRun] = useState<any>(null);
  const [demo, setDemo] = useState(false);
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (m: Mode = mode) => {
    if (m === 'loading') return;
    setLoading(true);
    try { setData(await loadDashboard(m)); } catch (e) { setData((d) => d ?? ({ mode: 'UNKNOWN', source: 'PUBLIC_TESTNET_RPC', principals: {}, chain: null, chain_error: e instanceof Error ? e.message : String(e) } as Dashboard)); }
    setLoading(false);
  }, [mode]);

  useEffect(() => { detectMode().then((m) => { setMode(m); refresh(m); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === 'demo') setDemo(true);
    else if (VIEWS.some((v) => v.id === hash)) setView(hash as View);
  }, []);
  const go = (id: View) => { setView(id); setMenu(false); try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ } window.scrollTo({ top: 0 }); };
  const select = (r: any) => setRun(r);
  const current = VIEWS.find((v) => v.id === view)!;
  const network = data?.mode === 'TESTNET' ? 'NEAR testnet' : data?.mode === 'LOCAL' ? 'Local simulation' : data?.mode ?? '…';

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden />
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Shield size={18} /></div>
          <div><div className="brand-name">AEGIS <span>//</span></div><div className="brand-sub">Counterfactual</div></div>
        </div>
        <nav className="nav" aria-label="Sections">
          <div className="nav-label">Workstation</div>
          {VIEWS.map((v, i) => {
            const Icon = v.icon;
            return <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => go(v.id)}><Icon size={15} />{v.label}<span className="k">{i + 1}</span></button>;
          })}
          <div className="nav-label">Presentation</div>
          <button onClick={() => { setDemo(true); setMenu(false); }}><Play size={15} />Live demonstration</button>
        </nav>
        <div className="sidebar-foot">
          <div className="row" style={{ gap: 6 }}><Boxes size={12} /> <span>Testnet only · no mainnet funds</span></div>
          <div className="tiny subtle">The AI can be wrong. The vault decides from deterministic invariants the owner wrote.</div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setMenu((m) => !m)} aria-label="Toggle navigation"><Menu size={16} /></button>
          <div style={{ minWidth: 0 }}>
            <h1>{current.title}</h1>
            <p>{current.sub}</p>
          </div>
          <div className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            <span className="mode-extra">{mode === 'loading' ? <Badge>connecting…</Badge> : mode === 'live' ? <Badge tone="green">live services</Badge> : <Badge tone="cyan">recorded evidence · live RPC</Badge>}</span>
            <Badge tone="violet">{network}</Badge>
            <button className="icon-btn" onClick={() => refresh()} aria-label="Refresh vault state" disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
            <button className="btn primary sm" onClick={() => setDemo(true)}><Play size={13} />Demo</button>
          </div>
        </header>
        <div className="content">
          {view === 'mission' && <MissionControl data={data} />}
          {view === 'command' && <CommandCenter mode={mode} data={data} onRun={(r) => { select(r); refresh(); }} />}
          {view === 'swarm' && <SwarmView run={run} />}
          {view === 'twin' && <TwinViewer run={run} />}
          {view === 'lab' && <AttackLab mode={mode} selected={run} onSelect={select} />}
          {view === 'vault' && <PolicyVault mode={mode} data={data} refresh={() => refresh()} />}
          {view === 'evidence' && <EvidenceExplorer run={run} />}
        </div>
      </main>
      {demo && <DemoMode onClose={() => { setDemo(false); if (window.location.hash === '#demo') history.replaceState(null, '', '#'); }} />}
    </div>
  );
}
