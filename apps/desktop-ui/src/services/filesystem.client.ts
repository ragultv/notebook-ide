// Filesystem Client - Local file operations for desktop app
// Uses the backend API for reliable saving (no browser gesture restriction).
// File System Access API is used ONLY for open-file (which IS from a user click).

import { v4 as uuidv4 } from 'uuid';

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

// ── .ipynb serialisation ──────────────────────────────────────────────────────

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
    cells: notebook.cells.map(cell => ({
      cell_type: cell.type,
      id: cell.id,
      metadata: {},
      source: cell.content.split('\n').map((line, i, arr) =>
        i < arr.length - 1 ? line + '\n' : line
      ),
      ...(cell.type === 'code' ? {
        execution_count: cell.executionCount ?? null,
        outputs: cell.output ? [{
          output_type: 'stream',
          name: 'stdout',
          text: cell.output.split('\n').map((line, i, arr) =>
            i < arr.length - 1 ? line + '\n' : line
          ),
        }] : [],
      } : {}),
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

// ── Backend-based save (no user-gesture requirement) ─────────────────────────

const BACKEND_URL = 'http://localhost:8000';

async function saveViaBackend(path: string, content: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/files/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Server error ${res.status}`);
  }
}

// ── Download fallback for "Save As" when backend path is unknown ──────────────

function downloadAsFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Must be in the DOM briefly for Firefox
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const filesystemClient = {
  /**
   * Open a .ipynb file via the File System Access API picker.
   * This IS triggered by a user click so no gesture restriction applies.
   */
  async openNotebook(): Promise<NotebookFile | null> {
    try {
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
    } catch (e: any) {
      if (e.name === 'AbortError') return null;
      console.error('Error opening notebook:', e);
      throw e;
    }
  },

  /**
   * Save notebook.
   *
   * Strategy (in order):
   *  1. If we have a `path` from the backend filesystem → save via backend API
   *     (works from auto-save timers, no user gesture needed).
   *  2. If we have a FileSystemFileHandle → write through it (user already granted).
   *  3. Otherwise → trigger a browser <a download> to let the user download the file.
   *     We do NOT call showSaveFilePicker here because it requires a user gesture and
   *     would fail when called from auto-save.
   */
  async saveNotebook(notebook: NotebookFile): Promise<NotebookFile> {
    const content = JSON.stringify(toIpynbFormat(notebook), null, 2);

    // ── Option 1: backend path is known (opened via file explorer) ──
    if (notebook.path) {
      try {
        await saveViaBackend(notebook.path, content);
        return notebook;
      } catch (e) {
        console.warn('Backend save failed, trying handle fallback:', e);
      }
    }

    // ── Option 2: File System Access API handle is available ──
    if (notebook.handle) {
      try {
        const writable = await (notebook.handle as any).createWritable();
        await writable.write(content);
        await writable.close();
        return notebook;
      } catch (e: any) {
        if (e.name === 'AbortError') return notebook;
        console.warn('Handle write failed, falling back to download:', e);
      }
    }

    // ── Option 3: No path/handle — download the file ──
    // This works from ANY context (user gesture or timer) because we're not
    // calling showSaveFilePicker.
    downloadAsFile(notebook.name, content);
    return notebook;
  },

  /**
   * Save As — always triggers a fresh download so the user can pick a location.
   * Called only from "Save As" menu items which come from user clicks.
   */
  async saveNotebookAs(notebook: NotebookFile): Promise<NotebookFile> {
    const content = JSON.stringify(toIpynbFormat(notebook), null, 2);

    // Try showSaveFilePicker first (only works from user gesture, which "Save As" is)
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
      } catch (e: any) {
        if (e.name === 'AbortError') return notebook; // user cancelled
        // Fall through to download approach
        console.warn('showSaveFilePicker failed:', e);
      }
    }

    // Fallback: download
    downloadAsFile(notebook.name, content);
    return notebook;
  },

  isSupported(): boolean {
    return 'showOpenFilePicker' in window;
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
