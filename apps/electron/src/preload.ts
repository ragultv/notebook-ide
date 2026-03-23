import { contextBridge, ipcRenderer } from 'electron';

function getArgumentValue(prefix: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

contextBridge.exposeInMainWorld('__ELECTRON__', true);
contextBridge.exposeInMainWorld('__OPREL_RUNTIME__', {
  controllerUrl: getArgumentValue('--oprel-controller-url='),
});
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  openNotebook: () => ipcRenderer.invoke('dialog:open-notebook'),
  saveNotebook: (payload: { path: string; content: string }) => ipcRenderer.invoke('file:save-notebook', payload),
  saveNotebookAs: (payload: { suggestedName: string; content: string }) => ipcRenderer.invoke('file:save-notebook-as', payload),
});
