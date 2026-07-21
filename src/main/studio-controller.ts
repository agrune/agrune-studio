import type { BrowserSession, PageSnapshot } from 'agrune';
import type {
  ActivityEntry,
  BrowserHistoryAction,
  BrowserTargetFocus,
  PreviewFrame,
  ScenarioDefinition,
  ScenarioStep,
  StudioState,
} from '../shared/contracts';
import { DEFAULT_SCENARIOS, DEMO_URL } from '../shared/default-scenarios';

type StatePublisher = (state: StudioState) => void;
type FramePublisher = (frame: PreviewFrame) => void;

const FRAME_INTERVAL_MS = 650;
const SETTLE_MS = 180;
const MAX_ACTIVITY = 80;
const MAX_DIAGNOSTICS = 120;

function createInitialState(): StudioState {
  return {
    engine: { status: 'idle', message: 'Engine is waiting' },
    workspace: {
      name: 'Agrune Demo',
      path: '../demo',
      baseUrl: DEMO_URL,
    },
    browser: {
      connected: false,
      loading: false,
      url: DEMO_URL,
      title: '',
      viewport: { width: 1280, height: 720 },
      targetCount: 0,
      groupCount: 0,
    },
    scenarios: DEFAULT_SCENARIOS,
    selectedScenarioId: DEFAULT_SCENARIOS[0]!.id,
    run: {
      status: 'idle',
      currentStepIndex: -1,
      steps: [],
    },
    diagnostics: { console: [], network: [] },
    activity: [
      {
        id: 'boot-0',
        timestamp: Date.now(),
        tone: 'neutral',
        title: 'Studio initialized',
        detail: 'The browser engine will stay local to this desktop app.',
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneState(state: StudioState): StudioState {
  return structuredClone(state);
}

export class StudioController {
  private session: BrowserSession | null = null;
  private state = createInitialState();
  private frameTimer: NodeJS.Timeout | null = null;
  private frameInFlight = false;
  private previewActive = true;
  private runLoopActive = false;
  private stopRequested = false;
  private stepPermits = 0;
  private gateResolvers: Array<() => void> = [];
  private activityCounter = 0;

  constructor(
    private readonly publishState: StatePublisher,
    private readonly publishFrame: FramePublisher,
  ) {}

  getState(): StudioState {
    return cloneState(this.state);
  }

  async initialize(): Promise<StudioState> {
    await this.ensureSession().catch(() => undefined);
    return this.getState();
  }

  async shutdown(): Promise<void> {
    this.stopRequested = true;
    this.releaseGate();
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
    await this.session?.stop().catch(() => undefined);
    this.session = null;
  }

  setPreviewActive(active: boolean): void {
    this.previewActive = active;
    if (!active) {
      if (this.frameTimer) clearInterval(this.frameTimer);
      this.frameTimer = null;
      return;
    }
    this.startFrameLoop();
    if (this.state.browser.connected) void this.captureFrame();
  }

  async navigate(rawUrl: string): Promise<StudioState> {
    const url = this.normalizeUrl(rawUrl);
    this.state.browser.loading = true;
    this.state.browser.url = url;
    this.emitState();

    try {
      const session = await this.ensureSession();
      if (session.tabCount === 0) await session.open(url);
      else await session.navigate(url);
      this.state.browser.connected = true;
      this.addActivity('info', 'Browser navigated', url);
      await this.afterBrowserMutation();
    } catch (error) {
      this.state.browser.loading = false;
      this.state.browser.connected = Boolean(this.session?.tabCount);
      this.addActivity('error', 'Navigation failed', errorMessage(error));
      await this.captureFrame();
      this.emitState();
    }
    return this.getState();
  }

  async history(action: BrowserHistoryAction): Promise<StudioState> {
    if (!this.session || this.session.tabCount === 0) return this.getState();
    this.state.browser.loading = true;
    this.emitState();
    try {
      await this.session[action]();
      this.addActivity('neutral', action === 'reload' ? 'Page reloaded' : `History: ${action}`);
      await this.afterBrowserMutation();
    } catch (error) {
      this.addActivity('error', 'Browser command failed', errorMessage(error));
      this.state.browser.loading = false;
      this.emitState();
    }
    return this.getState();
  }

  selectScenario(scenarioId: string): StudioState {
    if (this.scenarioById(scenarioId)) {
      this.state.selectedScenarioId = scenarioId;
      if (!this.runLoopActive) {
        this.state.run = { status: 'idle', currentStepIndex: -1, steps: [] };
      }
      this.emitState();
    }
    return this.getState();
  }

  runScenario(scenarioId: string): StudioState {
    if (this.runLoopActive) return this.getState();
    const scenario = this.scenarioById(scenarioId);
    if (!scenario) return this.getState();
    this.beginRun(scenario, false);
    return this.getState();
  }

  stepRun(scenarioId: string): StudioState {
    if (!this.runLoopActive) {
      const scenario = this.scenarioById(scenarioId);
      if (!scenario) return this.getState();
      this.beginRun(scenario, true);
      return this.getState();
    }
    if (this.state.run.status === 'paused') {
      this.stepPermits += 1;
      this.releaseGate();
      this.emitState();
    }
    return this.getState();
  }

  pauseRun(): StudioState {
    if (this.state.run.status === 'running') {
      this.state.run.status = 'paused';
      this.addActivity('warning', 'Run paused', 'The bot will pause before the next step.');
      this.emitState();
    }
    return this.getState();
  }

  resumeRun(): StudioState {
    if (this.state.run.status === 'paused') {
      this.state.run.status = 'running';
      this.stepPermits = 0;
      this.addActivity('info', 'Run resumed');
      this.releaseGate();
      this.emitState();
    }
    return this.getState();
  }

  stopRun(): StudioState {
    if (this.runLoopActive) {
      this.stopRequested = true;
      this.state.run.status = 'stopped';
      this.state.run.finishedAt = Date.now();
      this.state.browser.activeTarget = undefined;
      this.addActivity('warning', 'Run stopped', 'Remaining steps were skipped.');
      this.releaseGate();
      this.emitState();
    }
    return this.getState();
  }

  async refresh(): Promise<StudioState> {
    await this.refreshSignals();
    await this.captureFrame();
    this.emitState();
    return this.getState();
  }

  async previewClick(point: { x: number; y: number }): Promise<void> {
    if (!this.session || this.session.tabCount === 0) return;
    const page = this.session.page();
    const viewport = page.viewportSize() ?? this.state.browser.viewport;
    await page.mouse.click(point.x * viewport.width, point.y * viewport.height);
    this.addActivity('info', 'Manual pointer input', `${Math.round(point.x * viewport.width)}, ${Math.round(point.y * viewport.height)}`);
    await this.afterBrowserMutation();
  }

  async previewKey(payload: { key: string; text?: string }): Promise<void> {
    if (!this.session || this.session.tabCount === 0) return;
    const keyboard = this.session.page().keyboard;
    if (payload.text && payload.text.length === 1) await keyboard.insertText(payload.text);
    else await keyboard.press(payload.key);
    await this.afterBrowserMutation();
  }

  private async ensureSession(): Promise<BrowserSession> {
    if (this.session) return this.session;
    this.state.engine = { status: 'starting', message: 'Starting Playwright engine…' };
    this.emitState();
    try {
      const { BrowserSession: Session } = await import('agrune');
      const session = new Session(true);
      await session.start();
      this.session = session;
      this.state.engine = { status: 'ready', message: 'Playwright engine ready' };
      this.addActivity('success', 'Engine ready', 'Chromium is managed by the desktop process.');
      this.startFrameLoop();
      this.emitState();
      return session;
    } catch (error) {
      this.state.engine = { status: 'error', message: errorMessage(error) };
      this.addActivity('error', 'Engine failed to start', errorMessage(error));
      this.emitState();
      throw error;
    }
  }

  private beginRun(scenario: ScenarioDefinition, singleStep: boolean): void {
    this.runLoopActive = true;
    this.stopRequested = false;
    this.stepPermits = singleStep ? 1 : 0;
    this.state.selectedScenarioId = scenario.id;
    this.state.run = {
      id: `run-${Date.now()}`,
      status: singleStep ? 'paused' : 'running',
      scenarioId: scenario.id,
      startedAt: Date.now(),
      currentStepIndex: 0,
      steps: scenario.steps.map((step) => ({ id: step.id, status: 'queued' })),
    };
    this.addActivity('info', singleStep ? 'Step mode armed' : 'Scenario started', scenario.title);
    this.emitState();
    void this.executeScenario(scenario);
  }

  private async executeScenario(scenario: ScenarioDefinition): Promise<void> {
    try {
      await this.ensureSession();
      for (let index = 0; index < scenario.steps.length; index += 1) {
        await this.waitForPermission();
        if (this.stopRequested) break;

        const step = scenario.steps[index]!;
        const stepState = this.state.run.steps[index]!;
        this.state.run.currentStepIndex = index;
        stepState.status = 'running';
        stepState.startedAt = Date.now();
        await this.focusTargetForStep(step);
        this.emitState();

        try {
          await this.executeStep(step);
          stepState.status = 'passed';
          stepState.durationMs = Date.now() - stepState.startedAt;
          this.addActivity('success', step.label, `${stepState.durationMs} ms`);
        } catch (error) {
          stepState.status = 'failed';
          stepState.durationMs = Date.now() - stepState.startedAt;
          stepState.error = errorMessage(error);
          this.state.run.status = 'failed';
          this.state.run.error = errorMessage(error);
          this.addActivity('error', `${step.label} failed`, errorMessage(error));
          break;
        }

        await this.refreshSignals();
        await this.captureFrame();
        this.emitState();
      }

      if (this.stopRequested) {
        for (const step of this.state.run.steps) {
          if (step.status === 'queued') step.status = 'skipped';
        }
        this.state.run.status = 'stopped';
      } else if (this.state.run.status !== 'failed') {
        this.state.run.status = 'passed';
        this.addActivity('success', 'Scenario passed', scenario.title);
      }
    } catch (error) {
      this.state.run.status = 'failed';
      this.state.run.error = errorMessage(error);
      this.addActivity('error', 'Run could not start', errorMessage(error));
    } finally {
      this.state.run.finishedAt = Date.now();
      this.state.browser.activeTarget = undefined;
      this.runLoopActive = false;
      this.stepPermits = 0;
      this.releaseGate();
      this.emitState();
      await this.refreshSignals();
      await this.captureFrame();
      this.emitState();
    }
  }

  private async waitForPermission(): Promise<void> {
    while (this.state.run.status === 'paused' && this.stepPermits === 0 && !this.stopRequested) {
      await new Promise<void>((resolve) => this.gateResolvers.push(resolve));
    }
    if (this.state.run.status === 'paused' && this.stepPermits > 0) this.stepPermits -= 1;
  }

  private releaseGate(): void {
    const pending = this.gateResolvers.splice(0);
    for (const resolve of pending) resolve();
  }

  private async executeStep(step: ScenarioStep): Promise<void> {
    const session = await this.ensureSession();
    switch (step.kind) {
      case 'open':
        this.state.browser.loading = true;
        this.emitState();
        if (session.tabCount === 0) await session.open(step.url);
        else await session.navigate(step.url);
        this.state.browser.connected = true;
        break;
      case 'click':
        await session.click(undefined, step.target);
        break;
      case 'fill':
        await session.fill(undefined, step.target, step.value);
        break;
      case 'expect-target': {
        const snapshot = await session.snapshot();
        const target = snapshot.targets.find((candidate) => candidate.targetId === step.target);
        if (!target?.domResolved || !target.visible) {
          throw new Error(`Target is not visible: ${step.target}`);
        }
        break;
      }
      case 'expect-text':
        await session.page().getByText(step.value, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
        break;
      case 'wait':
        await session.page().waitForTimeout(step.durationMs);
        break;
    }
    await session.page().waitForTimeout(SETTLE_MS);
  }

  private async focusTargetForStep(step: ScenarioStep): Promise<void> {
    if (!('target' in step) || !this.session || this.session.tabCount === 0) {
      this.state.browser.activeTarget = undefined;
      return;
    }
    const snapshot = await this.session.snapshot().catch(() => null);
    if (!snapshot) return;
    this.applyTargetFocus(snapshot, step.target, step.label);
    await this.captureFrame();
  }

  private applyTargetFocus(snapshot: PageSnapshot, targetId: string, label: string): void {
    const target = snapshot.targets.find((candidate) => candidate.targetId === targetId);
    const viewport = this.session?.page().viewportSize() ?? this.state.browser.viewport;
    if (!target?.center || !target.size) {
      this.state.browser.activeTarget = undefined;
      return;
    }
    const focus: BrowserTargetFocus = {
      targetId,
      label,
      x: target.center.x,
      y: target.center.y,
      width: target.size.w,
      height: target.size.h,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    };
    this.state.browser.activeTarget = focus;
  }

  private async afterBrowserMutation(): Promise<void> {
    await this.session?.page().waitForTimeout(SETTLE_MS).catch(() => undefined);
    this.state.browser.loading = false;
    await this.refreshSignals();
    await this.captureFrame();
    this.emitState();
  }

  private async refreshSignals(): Promise<void> {
    const session = this.session;
    if (!session || session.tabCount === 0) {
      this.state.browser.connected = false;
      return;
    }

    const page = session.page();
    this.state.browser.connected = true;
    this.state.browser.loading = false;
    this.state.browser.url = page.url();
    this.state.browser.title = await page.title().catch(() => '');
    this.state.browser.viewport = page.viewportSize() ?? this.state.browser.viewport;

    const snapshot = await session.snapshot().catch(() => null);
    this.state.browser.targetCount = snapshot?.targets.length ?? 0;
    this.state.browser.groupCount = snapshot?.groups.length ?? 0;

    this.state.diagnostics.console = session
      .consoleMessages(undefined, { level: 'debug', all: false })
      .slice(-MAX_DIAGNOSTICS)
      .map((item) => ({ level: item.level, text: item.text, timestamp: item.timestamp }));
    this.state.diagnostics.network = session
      .networkRequests(undefined, { includeStatic: false, all: false })
      .slice(-MAX_DIAGNOSTICS)
      .map((item) => ({
        method: item.method,
        url: item.url,
        status: item.status,
        failureText: item.failureText,
        timestamp: item.timestamp,
      }));
  }

  private startFrameLoop(): void {
    if (this.frameTimer || !this.previewActive) return;
    this.frameTimer = setInterval(() => {
      if (this.state.browser.connected) void this.captureFrame();
    }, FRAME_INTERVAL_MS);
  }

  private async captureFrame(): Promise<void> {
    if (this.frameInFlight || !this.session || this.session.tabCount === 0) return;
    this.frameInFlight = true;
    try {
      const page = this.session.page();
      const viewport = page.viewportSize() ?? this.state.browser.viewport;
      const buffer = await page.screenshot({ type: 'jpeg', quality: 72, animations: 'disabled' });
      const timestamp = Date.now();
      this.state.browser.lastFrameAt = timestamp;
      this.publishFrame({
        dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        width: viewport.width,
        height: viewport.height,
        timestamp,
      });
    } catch {
      // Navigation can invalidate a frame. The next interval will recover naturally.
    } finally {
      this.frameInFlight = false;
    }
  }

  private normalizeUrl(rawUrl: string): string {
    const value = rawUrl.trim();
    if (!value) return this.state.workspace.baseUrl;
    const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are supported.');
    return parsed.toString();
  }

  private scenarioById(scenarioId: string): ScenarioDefinition | undefined {
    return this.state.scenarios.find((scenario) => scenario.id === scenarioId);
  }

  private addActivity(tone: ActivityEntry['tone'], title: string, detail?: string): void {
    this.activityCounter += 1;
    this.state.activity.unshift({
      id: `activity-${Date.now()}-${this.activityCounter}`,
      timestamp: Date.now(),
      tone,
      title,
      ...(detail ? { detail } : {}),
    });
    this.state.activity = this.state.activity.slice(0, MAX_ACTIVITY);
  }

  private emitState(): void {
    this.publishState(this.getState());
  }
}
