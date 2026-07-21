import { contextBridge, ipcRenderer } from 'electron';
import type { PreviewFrame, StudioApi, StudioState } from './shared/contracts';

const api: StudioApi = {
  getState: () => ipcRenderer.invoke('studio:get-state'),
  navigate: (url) => ipcRenderer.invoke('studio:navigate', url),
  history: (action) => ipcRenderer.invoke('studio:history', action),
  selectScenario: (scenarioId) => ipcRenderer.invoke('studio:select-scenario', scenarioId),
  runScenario: (scenarioId) => ipcRenderer.invoke('studio:run', scenarioId),
  pauseRun: () => ipcRenderer.invoke('studio:pause'),
  resumeRun: () => ipcRenderer.invoke('studio:resume'),
  stepRun: (scenarioId) => ipcRenderer.invoke('studio:step', scenarioId),
  stopRun: () => ipcRenderer.invoke('studio:stop'),
  refresh: () => ipcRenderer.invoke('studio:refresh'),
  previewClick: (point) => ipcRenderer.invoke('studio:preview-click', point),
  previewKey: (payload) => ipcRenderer.invoke('studio:preview-key', payload),
  onState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: StudioState) => listener(state);
    ipcRenderer.on('studio:state', wrapped);
    return () => ipcRenderer.removeListener('studio:state', wrapped);
  },
  onFrame: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, frame: PreviewFrame) => listener(frame);
    ipcRenderer.on('studio:frame', wrapped);
    return () => ipcRenderer.removeListener('studio:frame', wrapped);
  },
};

contextBridge.exposeInMainWorld('agruneStudio', api);
