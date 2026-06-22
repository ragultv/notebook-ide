/**
 * OctoML — Electron Preload Script
 *
 * Exposes a narrow, well-typed IPC surface to the renderer process.
 * The renderer never has access to Node.js or Electron internals directly.
 */

import { contextBridge, ipcRenderer } from 'electron';

// ── Type definitions (shared with renderer) ────────────────────────────────────

export interface OctoMLAPI {
  // ── Native dialogs ──────────────────────────────────────────────────────────
  /** Open a native OS folder-picker dialog. Returns selected path or null. */
  showFolderDialog(): Promise<string | null>;
  /** Open a native OS file-picker dialog. Returns selected paths or null. */
  showOpenFileDialog(options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[] | null>;
  /** Open the given OS path in the system file manager (Windows Explorer, Finder, etc.). */
  openInExplorer(osPath: string): Promise<{ success: boolean; error?: string }>;

  // ── App info ────────────────────────────────────────────────────────────────
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;

  // ── Controller server ───────────────────────────────────────────────────────
  getServerPort(): Promise<number>;
  isServerReady(): Promise<boolean>;

  // ── Window controls ─────────────────────────────────────────────────────────
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  isMaximized(): Promise<boolean>;
  openSettingsWindow(): void;

  // ── Event listeners ─────────────────────────────────────────────────────────
  onServerLog(callback: (log: string) => void): () => void;
  onServerError(callback: (error: string) => void): () => void;
}

// ── API implementation ────────────────────────────────────────────────────────

const octomlAPI: OctoMLAPI = {
  // Dialogs
  showFolderDialog: () => ipcRenderer.invoke('dialog:showFolder'),
  showOpenFileDialog: (options) => ipcRenderer.invoke('dialog:showOpenFile', options),
  openInExplorer: (osPath) => ipcRenderer.invoke('shell:openPath', osPath),

  // App info
  getVersion:  () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Server
  getServerPort: () => ipcRenderer.invoke('server:getPort'),
  isServerReady: () => ipcRenderer.invoke('server:isReady'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow:    () => ipcRenderer.send('window:close'),
  isMaximized:    () => ipcRenderer.invoke('window:isMaximized'),
  openSettingsWindow: () => ipcRenderer.send('window:openSettings'),

  // Event listeners (return unsubscribe function)
  onServerLog: (callback) => {
    const listener = (_event: any, log: string) => callback(log);
    ipcRenderer.on('server:log', listener);
    return () => ipcRenderer.removeListener('server:log', listener);
  },
  onServerError: (callback) => {
    const listener = (_event: any, error: string) => callback(error);
    ipcRenderer.on('server:error', listener);
    return () => ipcRenderer.removeListener('server:error', listener);
  },
};

// Expose to renderer as window.octoml
contextBridge.exposeInMainWorld('octoml', octomlAPI);
