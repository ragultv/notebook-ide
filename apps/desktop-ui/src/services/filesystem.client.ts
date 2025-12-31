// Filesystem Client - Local file operations for desktop app
// Uses File System Access API for browser/Electron compatibility

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

// Convert notebook to .ipynb format
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

// Parse .ipynb format to notebook
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
    cells: cells.length > 0 ? cells : [{
      id: uuidv4(),
      type: 'code',
      content: '',
    }],
  };
}

export const filesystemClient = {
  // Open file picker and load notebook
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
      if (e.name === 'AbortError') return null; // User cancelled
      console.error('Error opening notebook:', e);
      throw e;
    }
  },
  
  // Save notebook to existing handle or show save picker
  async saveNotebook(notebook: NotebookFile): Promise<NotebookFile> {
    try {
      let handle = notebook.handle;
      
      if (!handle) {
        // @ts-ignore - File System Access API
        handle = await window.showSaveFilePicker({
          suggestedName: notebook.name,
          types: [{
            description: 'Jupyter Notebook',
            accept: { 'application/x-ipynb+json': ['.ipynb'] },
          }],
        });
      }
      
      const writable = await handle!.createWritable();
      const content = JSON.stringify(toIpynbFormat(notebook), null, 2);
      await writable.write(content);
      await writable.close();
      
      return { ...notebook, handle, path: handle!.name };
    } catch (e: any) {
      if (e.name === 'AbortError') return notebook; // User cancelled
      console.error('Error saving notebook:', e);
      throw e;
    }
  },
  
  // Save notebook with new name/location
  async saveNotebookAs(notebook: NotebookFile): Promise<NotebookFile> {
    return this.saveNotebook({ ...notebook, handle: undefined });
  },
  
  // Check if File System Access API is available
  isSupported(): boolean {
    return 'showOpenFilePicker' in window;
  },
  
  // Export notebook to JSON string
  exportToJson(notebook: NotebookFile): string {
    return JSON.stringify(toIpynbFormat(notebook), null, 2);
  },
  
  // Import notebook from JSON string
  importFromJson(json: string, name: string): NotebookFile {
    const data = JSON.parse(json);
    return fromIpynbFormat(data, name);
  },
};

export default filesystemClient;
