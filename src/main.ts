import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { StudioController } from './main/studio-controller';
import type { BrowserHistoryAction } from './shared/contracts';

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
let controller: StudioController | null = null;

if (!app.isPackaged && process.env.AGRUNE_STUDIO_E2E === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9229');
}

function configurePlaywrightBrowserPath(): void {
  const browserPath = app.isPackaged
    ? path.join(process.resourcesPath, '.local-browsers')
    : path.join(app.getAppPath(), 'node_modules', 'playwright-core', '.local-browsers');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
}

function emit(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

function getController(): StudioController {
  if (!controller) throw new Error('Studio controller is not ready');
  return controller;
}

function registerIpc(): void {
  ipcMain.handle('studio:get-state', () => getController().getState());
  ipcMain.handle('studio:navigate', (_event, url: string) => getController().navigate(url));
  ipcMain.handle('studio:history', (_event, action: BrowserHistoryAction) => getController().history(action));
  ipcMain.handle('studio:select-scenario', (_event, scenarioId: string) => getController().selectScenario(scenarioId));
  ipcMain.handle('studio:run', (_event, scenarioId: string) => getController().runScenario(scenarioId));
  ipcMain.handle('studio:pause', () => getController().pauseRun());
  ipcMain.handle('studio:resume', () => getController().resumeRun());
  ipcMain.handle('studio:step', (_event, scenarioId: string) => getController().stepRun(scenarioId));
  ipcMain.handle('studio:stop', () => getController().stopRun());
  ipcMain.handle('studio:refresh', () => getController().refresh());
  ipcMain.handle('studio:preview-click', (_event, point: { x: number; y: number }) => getController().previewClick(point));
  ipcMain.handle('studio:preview-key', (_event, payload: { key: string; text?: string }) => getController().previewKey(payload));
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#10120f',
    title: 'Agrune Studio',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = MAIN_WINDOW_VITE_DEV_SERVER_URL || `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}`;
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  controller = new StudioController(
    (state) => emit('studio:state', state),
    (frame) => emit('studio:frame', frame),
  );
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('focus', () => controller?.setPreviewActive(true));
  mainWindow.on('blur', () => controller?.setPreviewActive(false));
  mainWindow.on('minimize', () => controller?.setPreviewActive(false));
  mainWindow.on('restore', () => controller?.setPreviewActive(true));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  await controller.initialize();
}

configurePlaywrightBrowserPath();
registerIpc();

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('before-quit', () => {
  void controller?.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
