import { v4 as uuidv4 } from 'uuid';
import { CONTROLLER_BASE_URL } from './controller.client';
import { isElectronRuntime } from '../runtime';

export interface NotebookFile {
  id: string;
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
  cells: Array<{
    id: string;
    type: 'code' | 'markdown';
    content: string;
    output?: string;
    executionCount?: number | null;
  }>;
}

function toIpynbFormat(notebook: NotebookFile): object {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
    },
    cells: notebook.cells.map((cell) => ({
      cell_type: cell.type,
      id: cell.id,
      metadata: {},
      source: cell.content.split('\n').map((line, index, lines) => (
        index < lines.length - 1 ? `${line}\n` : line
      )),
      ...(cell.type === 'code'
        ? {
            execution_count: cell.executionCount ?? null,
            outputs: cell.output
              ? [{
                  output_type: 'stream',
                  name: 'stdout',
                  text: cell.output.split('\n').map((line, index, lines) => (
                    index < lines.length - 1 ? `${line}\n` : line
                  )),
                }]
              : [],
          }
        : {}),
    })),
  };
}

function fromIpynbFormat(data: any, name: string, handle?: FileSystemFileHandle): NotebookFile {
  const cells = (data.cells || []).map((cell: any) => ({
    id: cell.id || uuidv4(),
    type: cell.cell_type as 'code' | 'markdown',
    content: Array.isArray(cell.source) ? cell.source.join('') : (cell.source || ''),
    output: cell.outputs?.[0]?.text
      ? (Array.isArray(cell.outputs[0].text) ? cell.outputs[0].text.join('') : cell.outputs[0].text)
      : undefined,
    executionCount: cell.execution_count ?? null,
  }));

  return {
    id: uuidv4(),
    name,
    handle,
    cells: cells.length > 0 ? cells : [{ id: uuidv4(), type: 'code', content: '' }],
  };
}

async function saveViaBackend(path: string, content: string): Promise<void> {
  const res = await fetch(`${CONTROLLER_BASE_URL}/files/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Server error ${res.status}`);
  }
}

function downloadAsFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const filesystemClient = {
  async openNotebook(): Promise<NotebookFile | null> {
    try {
      if (isElectronRuntime()) {
        const payload = await window.electronAPI?.openNotebook?.();
        if (!payload) {
          return null;
        }

        const data = JSON.parse(payload.content);
        return {
          ...fromIpynbFormat(data, payload.name),
          path: payload.path,
        };
      }

      // @ts-ignore - File System Access API
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'Jupyter Notebook',
          accept: { 'application/x-ipynb+json': ['.ipynb'] },
        }],
        multiple: false,
      });

      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      return fromIpynbFormat(data, file.name, handle);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return null;
      }
      console.error('Error opening notebook:', error);
      throw error;
    }
  },

  async saveNotebook(notebook: NotebookFile): Promise<NotebookFile> {
    const content = JSON.stringify(toIpynbFormat(notebook), null, 2);

    if (isElectronRuntime()) {
      if (notebook.path) {
        const saved = await window.electronAPI?.saveNotebook?.({ path: notebook.path, content });
        if (!saved?.path) {
          throw new Error('Failed to save notebook through Electron runtime');
        }
        return { ...notebook, path: saved.path };
      }

      const saved = await window.electronAPI?.saveNotebookAs?.({
        suggestedName: notebook.name,
        content,
      });
      return saved?.path ? { ...notebook, path: saved.path } : notebook;
    }

    if (notebook.path) {
      try {
        await saveViaBackend(notebook.path, content);
        return notebook;
      } catch (error) {
        console.warn('Backend save failed, trying handle fallback:', error);
      }
    }

    if (notebook.handle) {
      try {
        const writable = await (notebook.handle as any).createWritable();
        await writable.write(content);
        await writable.close();
        return notebook;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          return notebook;
        }
        console.warn('Handle write failed, falling back to download:', error);
      }
    }

    downloadAsFile(notebook.name, content);
    return notebook;
  },

  async saveNotebookAs(notebook: NotebookFile): Promise<NotebookFile> {
    const content = JSON.stringify(toIpynbFormat(notebook), null, 2);

    if (isElectronRuntime()) {
      const saved = await window.electronAPI?.saveNotebookAs?.({
        suggestedName: notebook.name,
        content,
      });
      return saved?.path ? { ...notebook, path: saved.path } : notebook;
    }

    if ('showSaveFilePicker' in window) {
      try {
        // @ts-ignore
        const handle = await window.showSaveFilePicker({
          suggestedName: notebook.name,
          types: [{
            description: 'Jupyter Notebook',
            accept: { 'application/x-ipynb+json': ['.ipynb'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return { ...notebook, handle };
      } catch (error: any) {
        if (error.name === 'AbortError') {
          return notebook;
        }
        console.warn('showSaveFilePicker failed:', error);
      }
    }

    downloadAsFile(notebook.name, content);
    return notebook;
  },

  isSupported(): boolean {
    return isElectronRuntime() || 'showOpenFilePicker' in window;
  },

  exportToJson(notebook: NotebookFile): string {
    return JSON.stringify(toIpynbFormat(notebook), null, 2);
  },

  importFromJson(json: string, name: string): NotebookFile {
    const data = JSON.parse(json);
    return fromIpynbFormat(data, name);
  },
};

export default filesystemClient;
