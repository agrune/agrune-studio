export type EngineStatus = 'idle' | 'starting' | 'ready' | 'error';
export type RunStatus = 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped';
export type StepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

export type ScenarioStep =
  | { id: string; kind: 'open'; label: string; url: string }
  | { id: string; kind: 'click'; label: string; target: string }
  | { id: string; kind: 'fill'; label: string; target: string; value: string; sensitive?: boolean }
  | { id: string; kind: 'expect-text'; label: string; value: string }
  | { id: string; kind: 'expect-target'; label: string; target: string }
  | { id: string; kind: 'wait'; label: string; durationMs: number };

export interface ScenarioDefinition {
  id: string;
  title: string;
  intent: string;
  tags: string[];
  estimatedMs: number;
  steps: ScenarioStep[];
}

export interface StepRunState {
  id: string;
  status: StepStatus;
  startedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
}

export interface BrowserTargetFocus {
  targetId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface StudioState {
  engine: {
    status: EngineStatus;
    message: string;
  };
  workspace: {
    name: string;
    path: string;
    baseUrl: string;
  };
  browser: {
    connected: boolean;
    loading: boolean;
    url: string;
    title: string;
    viewport: { width: number; height: number };
    targetCount: number;
    groupCount: number;
    activeTarget?: BrowserTargetFocus;
    lastFrameAt?: number;
  };
  scenarios: ScenarioDefinition[];
  selectedScenarioId: string;
  run: {
    id?: string;
    status: RunStatus;
    scenarioId?: string;
    startedAt?: number;
    finishedAt?: number;
    currentStepIndex: number;
    steps: StepRunState[];
    error?: string;
  };
  diagnostics: {
    console: Array<{ level: string; text: string; timestamp: number }>;
    network: Array<{ method: string; url: string; status?: number; failureText?: string; timestamp: number }>;
  };
  activity: ActivityEntry[];
}

export interface PreviewFrame {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
}

export type BrowserHistoryAction = 'back' | 'forward' | 'reload';

export interface StudioApi {
  getState: () => Promise<StudioState>;
  navigate: (url: string) => Promise<StudioState>;
  history: (action: BrowserHistoryAction) => Promise<StudioState>;
  selectScenario: (scenarioId: string) => Promise<StudioState>;
  runScenario: (scenarioId: string) => Promise<StudioState>;
  pauseRun: () => Promise<StudioState>;
  resumeRun: () => Promise<StudioState>;
  stepRun: (scenarioId: string) => Promise<StudioState>;
  stopRun: () => Promise<StudioState>;
  refresh: () => Promise<StudioState>;
  previewClick: (point: { x: number; y: number }) => Promise<void>;
  previewKey: (payload: { key: string; text?: string }) => Promise<void>;
  onState: (listener: (state: StudioState) => void) => () => void;
  onFrame: (listener: (frame: PreviewFrame) => void) => () => void;
}
