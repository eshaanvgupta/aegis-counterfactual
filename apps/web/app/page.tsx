'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Boxes, Crosshair, FileCheck2, FlaskConical, GitCompareArrows, Landmark, LayoutDashboard, Menu, Network, Play, RefreshCw, Shield, TerminalSquare } from 'lucide-react';
import { detectMode, loadDashboard, REFRESH_INTERVAL_MS, type Dashboard, type Mode } from './lib/data';
import { MissionControl } from './components/mission';
import { CommandCenter } from './components/command';
import { SwarmView, TwinViewer } from './components/analysis';
import { AttackLab } from './components/lab';
import { PolicyVault } from './components/vault';
import { EvidenceExplorer } from './components/evidence';
import { DemoMode } from './components/demo';
import { LiveProbe } from './components/probe';
import { Badge } from './components/ui';

const VIEWS = [
  { id: 'mission', label: 'Mission Control', icon: LayoutDashboard, title: 'Mission Control', sub: 'Live vault state, budget, and the on-chain ledger of every attempt.' },
  { id: 'probe', label: 'Live Contract Probe', icon: Crosshair, title: 'Live Contract Probe', sub: 'Attack the deployed NEAR vault yourself. Every edit is judged by the real contract, live.' },
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
  const [syncError, setSyncError] = useState('');
  const refreshing = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async (requestedMode?: Mode) => {
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    try {
      const nextMode = requestedMode && requestedMode !== 'loading' ? requestedMode : await detectMode();
      const nextData = await loadDashboard(nextMode);
      if (mounted.current) {
        setMode(nextMode);
        setData(nextData);
        setSyncError('');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mounted.current) {
        setSyncError(message);
        setData((current) => current ?? ({ mode: 'UNKNOWN', source: 'PUBLIC_TESTNET_RPC', principals: {}, chain: null, chain_error: message } as Dashboard));
      }
    } finally {
      refreshing.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  useEffect(() => {
    const sync = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(sync, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', sync);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', sync); };
  }, [refresh]);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash === 'demo') setDemo(true);
    else if (VIEWS.some((v) => v.id === hash)) setView(hash as View);
  }, []);
  const go = (id: View) => { setView(id); setMenu(false); try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ } window.scrollTo({ top: 0 }); };
  const select = (r: any) => setRun(r);
  const current = VIEWS.find((v) => v.id === view)!;
  const network = data?.mode === 'TESTNET' ? 'NEAR testnet' : data?.mode === 'LOCAL' ? 'Local simulation' : data?.mode ?? '…';

  const source = mode === 'live' ? 'dynamic services · auto-sync' : data?.chain_error ? 'verified evidence · RPC retrying' : 'live chain · auto-sync';
  const refreshed = data?.refreshed_at
    ? `${new Date(data.refreshed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })} UTC`
    : 'sync pending';
  const rpcHost = data?.rpc_url ? (() => { try { return new URL(data.rpc_url).host; } catch { return data.rpc_url; } })() : null;

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
          <div className="row" style={{ gap: 6 }}><Boxes size={12} /> <span>Live on NEAR testnet</span></div>
          <div className="tiny subtle">The agent proposes. The vault decides, from invariants the owner wrote.</div>
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
            <span className="mode-extra" title={rpcHost ? `Current NEAR RPC: ${rpcHost}` : undefined}>{mode === 'loading' ? <Badge>connecting…</Badge> : <Badge tone={mode === 'live' ? 'green' : data?.chain_error ? 'amber' : 'cyan'}>{source}</Badge>}</span>
            <span className="sync-meta mode-extra" aria-live="polite">{refreshed}{rpcHost ? ` · ${rpcHost}` : ''}</span>
            <Badge tone="violet">{network}</Badge>
            <button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh vault state" title={`Refresh now · automatic every ${Math.round(REFRESH_INTERVAL_MS / 1000)}s`} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
            <button className="btn primary sm" onClick={() => setDemo(true)}><Play size={13} />Demo</button>
          </div>
        </header>
        <div className="content">
          {syncError && data && <div className="sync-strip" role="status"><strong>Automatic sync is retrying.</strong> The last verified view remains available. <span>{syncError}</span></div>}
          {view === 'mission' && (
            <button className="probe-cta" onClick={() => go('probe')}>
              <Crosshair size={18} />
              <span><strong>Attack the deployed contract yourself.</strong> Write a prompt injection, poison a tool result or swap the invoice. The live NEAR vault evaluates every edit in real time.</span>
              <ArrowRight size={16} />
            </button>
          )}
          {view === 'mission' && <MissionControl data={data} />}
          {view === 'probe' && <LiveProbe />}
          {view === 'command' && <CommandCenter mode={mode} data={data} onProbe={() => go('probe')} onRun={(r) => { select(r); void refresh(mode); }} />}
          {view === 'swarm' && <SwarmView run={run} />}
          {view === 'twin' && <TwinViewer run={run} />}
          {view === 'lab' && <AttackLab mode={mode} selected={run} onSelect={select} />}
          {view === 'vault' && <PolicyVault mode={mode} data={data} refresh={() => { void refresh(mode); }} />}
          {view === 'evidence' && <EvidenceExplorer run={run} />}
        </div>
      </main>
      {demo && <DemoMode onProbe={() => { setDemo(false); go('probe'); }} onClose={() => { setDemo(false); if (window.location.hash === '#demo') history.replaceState(null, '', '#'); }} />}
    </div>
  );
}
