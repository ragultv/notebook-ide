export interface ElectronRuntimeApi {
  selectFolder?: () => Promise<string | null>;
  openNotebook?: () => Promise<{ path: string; content: string; name: string } | null>;
  saveNotebook?: (payload: { path: string; content: string }) => Promise<{ path: string }>;
  saveNotebookAs?: (payload: { suggestedName: string; content: string }) => Promise<{ path: string } | null>;
}

export interface DesktopRuntimeConfig {
  controllerUrl?: string;
}

declare global {
  interface Window {
    __ELECTRON__?: boolean;
    __OPREL_RUNTIME__?: DesktopRuntimeConfig;
    electronAPI?: ElectronRuntimeApi;
  }
}

export function getRuntimeConfig(): DesktopRuntimeConfig {
  if (typeof window === 'undefined') {
    return {};
  }

  return window.__OPREL_RUNTIME__ ?? {};
}

export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && !!window.__ELECTRON__;
}
