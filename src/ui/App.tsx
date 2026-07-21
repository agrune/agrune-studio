import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  Braces,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Code2,
  Command,
  Eye,
  FileCode2,
  Gauge,
  Hand,
  Keyboard,
  Layers3,
  ListFilter,
  LoaderCircle,
  MousePointer2,
  Network,
  PanelTop,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  SkipForward,
  Sparkles,
  TerminalSquare,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type {
  PreviewFrame,
  RunStatus,
  ScenarioDefinition,
  ScenarioStep,
  StepStatus,
  StudioState,
} from '../shared/contracts';

type InspectorTab = 'activity' | 'console' | 'network';

function BrandMark(): JSX.Element {
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M14 2.4 25 8.6v10.8L14 25.6 3 19.4V8.6L14 2.4Z" fill="currentColor" opacity=".16" />
      <path d="m8.3 18.7 5.7-12 5.7 12M10.1 15.2h7.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) return '—';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

function hostname(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function stepKindLabel(step: ScenarioStep): string {
  const labels: Record<ScenarioStep['kind'], string> = {
    open: 'NAV',
    click: 'CLICK',
    fill: 'FILL',
    'expect-text': 'ASSERT',
    'expect-target': 'ASSERT',
    wait: 'WAIT',
  };
  return labels[step.kind];
}

function statusLabel(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    idle: 'Ready',
    running: 'Running',
    paused: 'Paused',
    passed: 'Passed',
    failed: 'Failed',
    stopped: 'Stopped',
  };
  return labels[status];
}

function StepStateIcon({ status }: { status: StepStatus }): JSX.Element {
  if (status === 'running') return <LoaderCircle size={14} className="spin" />;
  if (status === 'passed') return <Check size={14} />;
  if (status === 'failed') return <X size={14} />;
  if (status === 'skipped') return <SkipForward size={13} />;
  return <span className="queued-dot" />;
}

function AppSkeleton(): JSX.Element {
  return (
    <div className="app-loading">
      <BrandMark />
      <span>Preparing the control room</span>
    </div>
  );
}

export function App(): JSX.Element {
  const [state, setState] = useState<StudioState | null>(null);
  const [frame, setFrame] = useState<PreviewFrame | null>(null);
  const [address, setAddress] = useState('');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('activity');
  const [takeover, setTakeover] = useState(false);
  const addressFocused = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void window.agruneStudio.getState().then((next) => {
      if (active) {
        setState(next);
        setAddress(next.browser.url);
      }
    });
    const unsubscribeState = window.agruneStudio.onState((next) => {
      setState(next);
      if (!addressFocused.current) setAddress(next.browser.url);
    });
    const unsubscribeFrame = window.agruneStudio.onFrame(setFrame);
    return () => {
      active = false;
      unsubscribeState();
      unsubscribeFrame();
    };
  }, []);

  const selectedScenario = useMemo(
    () => state?.scenarios.find((scenario) => scenario.id === state.selectedScenarioId),
    [state],
  );

  const filteredScenarios = useMemo(() => {
    const query = scenarioFilter.trim().toLowerCase();
    if (!state || !query) return state?.scenarios ?? [];
    return state.scenarios.filter((scenario) =>
      [scenario.title, scenario.intent, ...scenario.tags].some((value) => value.toLowerCase().includes(query)),
    );
  }, [scenarioFilter, state]);

  if (!state || !selectedScenario) return <AppSkeleton />;

  const isActiveRun = state.run.status === 'running' || state.run.status === 'paused';
  const steps = state.run.scenarioId === selectedScenario.id && state.run.steps.length
    ? selectedScenario.steps.map((step, index) => ({ step, run: state.run.steps[index] }))
    : selectedScenario.steps.map((step) => ({ step, run: undefined }));
  const passedSteps = state.run.steps.filter((step) => step.status === 'passed').length;
  const progress = state.run.steps.length ? (passedSteps / state.run.steps.length) * 100 : 0;

  async function submitAddress(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setTakeover(false);
    setState(await window.agruneStudio.navigate(address));
  }

  async function toggleTakeover(): Promise<void> {
    const next = !takeover;
    if (next && state!.run.status === 'running') setState(await window.agruneStudio.pauseRun());
    setTakeover(next);
    if (next) requestAnimationFrame(() => previewRef.current?.focus());
  }

  async function handlePreviewClick(event: React.MouseEvent<HTMLDivElement>): Promise<void> {
    if (!takeover || !frame) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    await window.agruneStudio.previewClick({
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    });
  }

  async function handlePreviewKey(event: React.KeyboardEvent<HTMLDivElement>): Promise<void> {
    if (!takeover || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    await window.agruneStudio.previewKey({
      key: event.key,
      ...(event.key.length === 1 ? { text: event.key } : {}),
    });
  }

  async function runSelected(): Promise<void> {
    setTakeover(false);
    setState(await window.agruneStudio.runScenario(selectedScenario!.id));
  }

  return (
    <div className="studio-shell">
      <header className="titlebar">
        <div className="titlebar-brand no-drag">
          <BrandMark />
          <span>Agrune</span>
          <span className="brand-product">Studio</span>
        </div>
        <div className="titlebar-context">
          <span>{state.workspace.name}</span>
          <ChevronRight size={13} />
          <span>{selectedScenario.title}</span>
        </div>
        <div className="titlebar-status no-drag">
          <span className={`engine-led ${state.engine.status}`} />
          <span>{state.engine.message}</span>
          <kbd>⌘ K</kbd>
        </div>
      </header>

      <div className="studio-grid">
        <nav className="rail" aria-label="Primary">
          <div className="rail-top">
            <button className="rail-button active" title="Runs" aria-label="Runs"><Radio size={19} /></button>
            <button className="rail-button" title="Recorder" aria-label="Recorder"><MousePointer2 size={19} /></button>
            <button className="rail-button" title="Manifests" aria-label="Manifests"><Braces size={19} /></button>
            <button className="rail-button" title="Artifacts" aria-label="Artifacts"><Box size={19} /></button>
          </div>
          <div className="rail-bottom">
            <div className="rail-health" title={`${state.browser.targetCount} targets resolved`}>
              <Gauge size={18} />
              <span>{state.browser.targetCount}</span>
            </div>
            <button className="rail-button" title="Command palette" aria-label="Command palette"><Command size={18} /></button>
          </div>
        </nav>

        <aside className="scenario-sidebar">
          <section className="workspace-card">
            <div className="eyebrow">Workspace</div>
            <div className="workspace-heading">
              <span className="workspace-avatar">AD</span>
              <div>
                <strong>{state.workspace.name}</strong>
                <span>{state.workspace.path}</span>
              </div>
              <button className="icon-button tiny" aria-label="Workspace options"><Layers3 size={15} /></button>
            </div>
            <div className="workspace-endpoint">
              <span className={state.browser.connected ? 'online-dot' : 'offline-dot'} />
              <code>{hostname(state.workspace.baseUrl)}</code>
            </div>
          </section>

          <section className="scenario-list-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Test library</span>
                <h2>Scenarios</h2>
              </div>
              <span className="count-badge">{state.scenarios.length}</span>
            </div>
            <label className="search-field">
              <Search size={14} />
              <input
                value={scenarioFilter}
                onChange={(event) => setScenarioFilter(event.target.value)}
                placeholder="Filter scenarios"
              />
              <span>⌘F</span>
            </label>
            <div className="scenario-list">
              {filteredScenarios.map((scenario, index) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  index={index}
                  selected={scenario.id === selectedScenario.id}
                  runStatus={state.run.scenarioId === scenario.id ? state.run.status : 'idle'}
                  onSelect={() => void window.agruneStudio.selectScenario(scenario.id).then(setState)}
                />
              ))}
            </div>
          </section>

          <section className="manifest-summary">
            <div className="manifest-ring" style={{ '--coverage': `${Math.min(100, state.browser.targetCount)}%` } as React.CSSProperties}>
              <Braces size={16} />
            </div>
            <div>
              <strong>Manifest surface</strong>
              <span>{state.browser.groupCount} groups · {state.browser.targetCount} targets</span>
            </div>
            <ShieldCheck size={17} className="manifest-shield" />
          </section>
        </aside>

        <main className="browser-stage">
          <form className="browser-toolbar" onSubmit={submitAddress}>
            <div className="browser-nav">
              <button type="button" className="icon-button" onClick={() => void window.agruneStudio.history('back').then(setState)} aria-label="Back"><ArrowLeft size={16} /></button>
              <button type="button" className="icon-button" onClick={() => void window.agruneStudio.history('forward').then(setState)} aria-label="Forward"><ArrowRight size={16} /></button>
              <button type="button" className="icon-button" onClick={() => void window.agruneStudio.history('reload').then(setState)} aria-label="Reload"><RefreshCw size={15} className={state.browser.loading ? 'spin' : ''} /></button>
            </div>
            <label className="address-field">
              <span className={state.browser.connected ? 'connection-mark connected' : 'connection-mark'} />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onFocus={() => { addressFocused.current = true; }}
                onBlur={() => { addressFocused.current = false; }}
                spellCheck={false}
              />
              <span className="address-meta">{state.browser.viewport.width} × {state.browser.viewport.height}</span>
            </label>
            <button
              type="button"
              className={`takeover-button ${takeover ? 'active' : ''}`}
              onClick={() => void toggleTakeover()}
            >
              {takeover ? <Keyboard size={15} /> : <Hand size={15} />}
              {takeover ? 'You have control' : 'Take control'}
            </button>
          </form>

          <section className={`preview-well ${takeover ? 'takeover' : ''}`}>
            <div className="preview-ambient" />
            {frame ? (
              <div
                ref={previewRef}
                className="preview-surface"
                style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
                tabIndex={takeover ? 0 : -1}
                onClick={(event) => void handlePreviewClick(event)}
                onKeyDown={(event) => void handlePreviewKey(event)}
              >
                <img src={frame.dataUrl} alt="Live browser controlled by Agrune" draggable={false} />
                {state.browser.activeTarget && !takeover && (
                  <TargetOverlay state={state} />
                )}
                {takeover && (
                  <div className="takeover-overlay">
                    <MousePointer2 size={15} />
                    DIRECT CONTROL · click and type in this frame
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-preview">
                <div className="empty-radar">
                  <span /><span /><span />
                  <Bot size={27} />
                </div>
                <span className="eyebrow">Live browser</span>
                <h1>Nothing is running yet.</h1>
                <p>Start a scenario or open the workspace. The exact page controlled by Agrune will appear here.</p>
                <button className="primary-button" onClick={() => void window.agruneStudio.navigate(state.workspace.baseUrl).then(setState)}>
                  <Zap size={16} /> Open demo workspace
                </button>
              </div>
            )}

            <div className="preview-status-strip">
              <span className={`live-pulse ${state.run.status}`} />
              <strong>{isActiveRun ? `BOT ${state.run.status.toUpperCase()}` : state.browser.connected ? 'BROWSER LIVE' : 'BROWSER IDLE'}</strong>
              <span>{state.browser.title || hostname(state.browser.url)}</span>
              {frame && <time>{formatClock(frame.timestamp)}</time>}
            </div>
          </section>

          <section className="run-dock">
            <div className="run-identity">
              <span className="run-index">{String(state.scenarios.findIndex((item) => item.id === selectedScenario.id) + 1).padStart(2, '0')}</span>
              <div>
                <span className="eyebrow">Selected scenario</span>
                <strong>{selectedScenario.title}</strong>
              </div>
            </div>
            <div className="run-progress-block">
              <div className="run-progress-copy">
                <span>{state.run.status === 'idle' ? `${selectedScenario.steps.length} steps` : `${passedSteps} / ${state.run.steps.length} passed`}</span>
                <span>{state.run.startedAt ? formatDuration((state.run.finishedAt ?? Date.now()) - state.run.startedAt) : formatDuration(selectedScenario.estimatedMs)}</span>
              </div>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            </div>
            <div className="run-controls">
              {state.run.status === 'running' ? (
                <button className="secondary-button" onClick={() => void window.agruneStudio.pauseRun().then(setState)}><Pause size={15} /> Pause</button>
              ) : state.run.status === 'paused' ? (
                <button className="secondary-button" onClick={() => void window.agruneStudio.resumeRun().then(setState)}><Play size={15} /> Resume</button>
              ) : null}
              <button
                className="icon-text-button"
                disabled={state.run.status === 'running'}
                onClick={() => void window.agruneStudio.stepRun(selectedScenario.id).then(setState)}
              ><SkipForward size={15} /> Step</button>
              {isActiveRun && (
                <button className="stop-button" onClick={() => void window.agruneStudio.stopRun().then(setState)} aria-label="Stop run"><CircleStop size={17} /></button>
              )}
              {!isActiveRun && (
                <button className="primary-button run-button" onClick={() => void runSelected()}>
                  <Play size={16} fill="currentColor" /> Run scenario
                </button>
              )}
            </div>
          </section>
        </main>

        <aside className="inspector">
          <header className="inspector-header">
            <div>
              <span className="eyebrow">Run inspector</span>
              <h2>Execution</h2>
            </div>
            <span className={`run-status ${state.run.status}`}>
              <span />{statusLabel(state.run.status)}
            </span>
          </header>

          <section className="scenario-intent">
            <div className="intent-icon"><Sparkles size={16} /></div>
            <p>{selectedScenario.intent}</p>
          </section>

          <section className="step-stack">
            <div className="step-stack-heading">
              <span>Steps</span>
              <span>{steps.length}</span>
            </div>
            <div className="steps-scroll">
              {steps.map(({ step, run }, index) => (
                <div
                  className={`step-row ${run?.status ?? 'queued'} ${state.run.currentStepIndex === index && isActiveRun ? 'current' : ''}`}
                  key={step.id}
                >
                  <div className="step-rail">
                    <span className="step-status-icon"><StepStateIcon status={run?.status ?? 'queued'} /></span>
                    {index < steps.length - 1 && <span className="step-line" />}
                  </div>
                  <div className="step-copy">
                    <div>
                      <span className="step-kind">{stepKindLabel(step)}</span>
                      <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <strong>{step.label}</strong>
                    {'target' in step && <code>{step.target}</code>}
                    {run?.error && <span className="step-error">{run.error}</span>}
                  </div>
                  <span className="step-duration">{formatDuration(run?.durationMs)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="signal-panel">
            <div className="signal-tabs" role="tablist">
              <button className={inspectorTab === 'activity' ? 'active' : ''} onClick={() => setInspectorTab('activity')}><Activity size={13} /> Activity</button>
              <button className={inspectorTab === 'console' ? 'active' : ''} onClick={() => setInspectorTab('console')}><TerminalSquare size={13} /> Console <span>{state.diagnostics.console.length}</span></button>
              <button className={inspectorTab === 'network' ? 'active' : ''} onClick={() => setInspectorTab('network')}><Network size={13} /> Net <span>{state.diagnostics.network.length}</span></button>
            </div>
            <div className="signal-content">
              {inspectorTab === 'activity' && <ActivityFeed state={state} />}
              {inspectorTab === 'console' && <ConsoleFeed state={state} />}
              {inspectorTab === 'network' && <NetworkFeed state={state} />}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  index,
  selected,
  runStatus,
  onSelect,
}: {
  scenario: ScenarioDefinition;
  index: number;
  selected: boolean;
  runStatus: RunStatus;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button className={`scenario-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="scenario-card-top">
        <span className="scenario-number">{String(index + 1).padStart(2, '0')}</span>
        <div className={`scenario-state ${runStatus}`}>
          {runStatus === 'passed' ? <Check size={11} /> : runStatus === 'failed' ? <TriangleAlert size={11} /> : <span />}
        </div>
      </div>
      <strong>{scenario.title}</strong>
      <p>{scenario.intent}</p>
      <div className="scenario-meta">
        <span><ListFilter size={11} /> {scenario.steps.length}</span>
        <span><Clock3 size={11} /> ~{Math.ceil(scenario.estimatedMs / 1000)}s</span>
        <span className="scenario-tag">{scenario.tags[0]}</span>
      </div>
    </button>
  );
}

function TargetOverlay({ state }: { state: StudioState }): JSX.Element | null {
  const target = state.browser.activeTarget;
  if (!target) return null;
  const left = ((target.x - target.width / 2) / target.viewportWidth) * 100;
  const top = ((target.y - target.height / 2) / target.viewportHeight) * 100;
  const width = (target.width / target.viewportWidth) * 100;
  const height = (target.height / target.viewportHeight) * 100;
  return (
    <div className="target-overlay" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}>
      <span className="target-corner top-left" />
      <span className="target-corner top-right" />
      <span className="target-corner bottom-left" />
      <span className="target-corner bottom-right" />
      <span className="target-label"><Bot size={12} /> {target.label}</span>
    </div>
  );
}

function EmptySignal({ icon, title, copy }: { icon: JSX.Element; title: string; copy: string }): JSX.Element {
  return (
    <div className="empty-signal">
      {icon}
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  );
}

function ActivityFeed({ state }: { state: StudioState }): JSX.Element {
  return (
    <div className="feed-list">
      {state.activity.slice(0, 18).map((entry) => (
        <div className={`activity-entry ${entry.tone}`} key={entry.id}>
          <span className="activity-node" />
          <div>
            <strong>{entry.title}</strong>
            {entry.detail && <p>{entry.detail}</p>}
          </div>
          <time>{formatClock(entry.timestamp)}</time>
        </div>
      ))}
    </div>
  );
}

function ConsoleFeed({ state }: { state: StudioState }): JSX.Element {
  if (!state.diagnostics.console.length) {
    return <EmptySignal icon={<Code2 size={19} />} title="Console is clean" copy="Messages from the tested page will land here." />;
  }
  return (
    <div className="console-list">
      {state.diagnostics.console.slice().reverse().map((item, index) => (
        <div className={`console-entry ${item.level}`} key={`${item.timestamp}-${index}`}>
          <span>{item.level.slice(0, 1).toUpperCase()}</span>
          <code>{item.text}</code>
          <time>{formatClock(item.timestamp)}</time>
        </div>
      ))}
    </div>
  );
}

function NetworkFeed({ state }: { state: StudioState }): JSX.Element {
  if (!state.diagnostics.network.length) {
    return <EmptySignal icon={<PanelTop size={19} />} title="No requests yet" copy="Non-static browser traffic will appear during a run." />;
  }
  return (
    <div className="network-list">
      {state.diagnostics.network.slice().reverse().map((item, index) => (
        <div className={`network-entry ${item.failureText ? 'failed' : ''}`} key={`${item.timestamp}-${index}`}>
          <span className="network-method">{item.method}</span>
          <code title={item.url}>{hostname(item.url)}</code>
          <span className="network-status">{item.failureText ? 'ERR' : item.status ?? '…'}</span>
        </div>
      ))}
    </div>
  );
}
