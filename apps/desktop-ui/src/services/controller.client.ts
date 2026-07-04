
// Controller Client - HTTP interface to FastAPI backend
// Handles execution, kernel management, and AI requests

export const BASE_URL = 'http://127.0.0.1:3001';

// Types
export interface ExecutionRequest {
  cellId: string;
  code: string;
  notebookId: string;  // Required for notebook isolation
  device?: 'cpu' | 'cuda';  // Target compute device for this execution
}

// Rich output types - like Jupyter
export interface RichOutput {
  type: 'text' | 'image' | 'html' | 'error' | 'stream' | 'widget' | 'result' | 'display';
  data: string | Record<string, any>;  // Can be string or MIME bundle object
  mimeType?: string;
  stream?: 'stdout' | 'stderr';
  // Widget-specific fields
  commId?: string;
  targetName?: string;
}

export interface ExecutionResult {
  cellId: string;
  success: boolean;
  output?: string;
  outputs?: RichOutput[]; // Rich outputs array
  error?: string;
  executionCount: number;
  duration?: number;
}

export interface KernelInfo {
  id: string;
  status: 'idle' | 'busy' | 'error';
  executionCount: number;
}

export interface KernelMetrics {
  notebook_id: string;
  available: boolean;
  pid?: number;
  memory_mb?: number;
  memory_percent?: number;
  cpu_percent?: number;
  status?: string;
  error?: string;
}

export interface AllKernelMetrics {
  kernels: Record<string, {
    pid?: number;
    memory_mb?: number;
    cpu_percent?: number;
    status: string;
  }>;
  total_count: number;
  running_count: number;
}


// HTTP helper
async function safeFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, opts);
  } catch (err: any) {
    if (
      err?.message === 'Failed to fetch' ||
      err?.name === 'TypeError' ||
      err?.message?.includes('NetworkError') ||
      err?.message?.includes('ECONNREFUSED') ||
      err?.message?.includes('fetch')
    ) {
      throw new Error('Backend server offline: Cannot connect to local execution engine (port 3001). Please ensure server is running.');
    }
    throw err;
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const defaultHeaders: any = opts.body ? { 'Content-Type': 'application/json' } : {};
  const res = await safeFetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      ...defaultHeaders,
      ...opts.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    let errMsg = `HTTP ${res.status}`;
    if (typeof error === 'string') {
      errMsg = error;
    } else if (error && typeof error === 'object') {
      if (error.message) errMsg = typeof error.message === 'string' ? error.message : JSON.stringify(error.message);
      else if (error.error) errMsg = typeof error.error === 'string' ? error.error : JSON.stringify(error.error);
      else if (error.detail) errMsg = typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail);
    }
    throw new Error(errMsg);
  }

  return res.json();
}

// Controller Client
export const controllerClient = {
  // Health check
  async health(): Promise<{ status: string }> {
    return request('/');
  },

  // Kernel Management
  async startKernel(): Promise<KernelInfo> {
    return request('/kernels/start', { method: 'POST' });
  },

  async stopKernel(): Promise<{ status: string }> {
    return request('/kernels/stop', { method: 'POST' });
  },

  async restartKernel(): Promise<KernelInfo> {
    return request('/kernels/restart', { method: 'POST' });
  },

  async getKernelStatus(): Promise<KernelInfo> {
    return request('/kernels/status');
  },

  // Get kernel metrics (PID, memory, CPU) for a specific notebook
  async getKernelMetrics(notebookId: string): Promise<KernelMetrics> {
    return request(`/kernels/metrics/${encodeURIComponent(notebookId)}`);
  },

  // Get metrics for all running kernels
  async getAllKernelMetrics(): Promise<AllKernelMetrics> {
    return request('/kernels/metrics');
  },


  async sendInput(notebookId: string, value: string): Promise<{ success: boolean }> {
    return request('/execution/input', {
      method: 'POST',
      body: JSON.stringify({ notebookId, value })
    });
  },

  async resizeTerminal(notebookId: string, cols: number, rows: number): Promise<{ success: boolean }> {
    return request('/execution/resize', {
      method: 'POST',
      body: JSON.stringify({ notebookId, cols, rows })
    });
  },

  // Code Completion
  async getCompletions(req: { code: string; cursorPos: number; notebookId: string; contextCode?: string }): Promise<{ completions: any[] }> {
    return request('/execution/complete', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },



  // Read file content

  async readFile(path: string): Promise<{ path: string; content: string; size: number }> {
    return request(`/files/read?path=${encodeURIComponent(path)}`);
  },

  // Save file content
  async saveFile(path: string, content: string): Promise<{ status: string; path: string; size: number }> {
    return request('/files/save', {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  },

  // Upload a file
  async uploadFile(file: File, destination: string): Promise<{ status: string; path: string; name: string; size: number }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', destination);

    const res = await safeFetch(`${BASE_URL}/files/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return res.json();
  },

  // Upload multiple files
  async uploadFiles(files: File[], destination: string): Promise<{ results: Array<{ status: string; name: string; path?: string; error?: string }> }> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    formData.append('destination', destination);

    const res = await safeFetch(`${BASE_URL}/files/upload-multiple`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(error.detail || `HTTP ${res.status}`);
    }

    return res.json();
  },

  // Delete file or folder
  async deleteFile(path: string): Promise<{ status: string; deleted: string }> {
    return request(`/files/delete?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  },

  // Resolve virtual path to OS absolute path (for "Open in Explorer")
  async resolveOsPath(virtualPath: string): Promise<{ osPath: string }> {
    return request(`/files/resolve-os-path?path=${encodeURIComponent(virtualPath)}`);
  },

  // Get the OS absolute path of the current project root
  async getProjectOsRoot(): Promise<{ osPath: string }> {
    return request('/files/project/os-root');
  },

  // Create folder
  async createFolder(path: string, name: string): Promise<{ status: string; path: string }> {
    return request('/files/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    });
  },

  // Rename file or folder
  async renameFile(oldPath: string, newPath: string): Promise<{ status: string; oldPath: string; newPath: string }> {
    return request('/files/rename', {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    });
  },

  // Save notebook
  async saveNotebook(notebookId: string): Promise<{ success: boolean; notebookId: string }> {
    return request('/notebooks/save', {
      method: 'POST',
      body: JSON.stringify({ notebookId }),
    });
  },

  // Open notebook
  async openNotebook(path: string): Promise<{ path: string; name: string; content: NotebookContent; notebookId: string }> {
    const res = await request<{
      notebookId: string;
      path: string;
      name: string;
      notebook: any;
      persistedOutputs?: Record<string, any[]>;
    }>('/notebooks/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });

    // Convert standard ipynb format to the frontend's expected format
    const cells = (res.notebook?.cells || []).map((cell: any, idx: number) => {
      const rawOutputs = cell.outputs || [];
      const parsedOutputs: any[] = rawOutputs.map((out: any) => {
        if (out.output_type === 'stream') {
          return { type: 'stream', stream: out.name || 'stdout', data: Array.isArray(out.text) ? out.text.join('') : (out.text || '') };
        } else if (out.output_type === 'execute_result') {
          return { type: 'result', data: out.data };
        } else if (out.output_type === 'display_data') {
          return { type: 'display', data: out.data };
        } else if (out.output_type === 'error') {
          return { type: 'error', data: `${out.ename}: ${out.evalue}\n${(out.traceback || []).join('\n')}` };
        }
        return { type: 'text', data: JSON.stringify(out) };
      });

      let outputText = '';
      for (const out of parsedOutputs) {
        if (out.type === 'stream' || out.type === 'error') {
          outputText += out.data;
        } else if (out.type === 'result' || out.type === 'display') {
          if (out.data && out.data['text/plain']) {
            const textArr = out.data['text/plain'];
            outputText += Array.isArray(textArr) ? textArr.join('') : textArr;
          }
        }
      }

      return {
        id: cell.id || `cell-${idx}`,
        type: cell.cell_type === 'markdown' ? 'markdown' : 'code',
        content: Array.isArray(cell.source) ? cell.source.join('') : (cell.source || ''),
        output: outputText || undefined,
        executionCount: cell.execution_count ?? null,
        outputs: parsedOutputs.length > 0 ? parsedOutputs : undefined,
      };
    });

    return {
      notebookId: res.notebookId,
      path: res.path,
      name: res.name,
      content: {
        cells: cells.length > 0 ? cells : [{ id: 'default-cell', type: 'code', content: '' }],
        metadata: res.notebook?.metadata || {},
      },
    };
  },

  // Get recent projects
  async getRecentProjects(): Promise<{ recent: Array<{ path: string; name: string; opened: string; lastNotebook?: string }> }> {
    return request('/files/recent');
  },

  // ─── New Provider API (SQLite-backed, /api/providers/*) ─────────────────

  /** List all providers (built-in + custom) with has_key + model_count. */
  async listProviders(): Promise<ProviderEntry[]> {
    return request('/api/providers');
  },

  /** Save an API key for a built-in or custom provider. */
  async saveProviderKey(providerId: string, apiKey: string): Promise<void> {
    await request(`/api/providers/${encodeURIComponent(providerId)}/key`, {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey }),
    });
  },

  /** Remove the API key for a provider. */
  async removeProviderKey(providerId: string): Promise<void> {
    await request(`/api/providers/${encodeURIComponent(providerId)}/key`, { method: 'DELETE' });
  },

  /** Fetch models from the provider API and store them in the DB. */
  async fetchProviderModels(providerId: string): Promise<{ count: number }> {
    return request(`/api/providers/${encodeURIComponent(providerId)}/fetch-models`, { method: 'POST' });
  },

  /** Get all fetched models for a specific provider. */
  async getProviderModels(providerId: string): Promise<ProviderModelEntry[]> {
    return request(`/api/providers/${encodeURIComponent(providerId)}/models`);
  },

  /** Get all models across all providers. */
  async getAllProviderModels(): Promise<Array<ProviderModelEntry & { provider_name: string }>> {
    return request('/api/providers/models');
  },

  /** Get only enabled models (for the chat model selector). */
  async getEnabledModels(): Promise<EnabledModelEntry[]> {
    return request('/api/providers/models/enabled');
  },

  /** Enable or disable a model. */
  async toggleProviderModel(providerId: string, modelId: string, enabled: boolean): Promise<void> {
    await request('/api/providers/models/toggle', {
      method: 'POST',
      body: JSON.stringify({ provider_id: providerId, model_id: modelId, enabled }),
    });
  },

  /** Add a custom (user-defined) provider. */
  async addCustomProvider(p: { id: string; name: string; type: string; base_url: string; api_key?: string }): Promise<ProviderEntry> {
    return request('/api/providers', {
      method: 'POST',
      body: JSON.stringify(p),
    });
  },

  /** Delete a custom provider (built-in providers cannot be deleted). */
  async deleteCustomProvider(providerId: string): Promise<void> {
    await request(`/api/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
  },

  // ─── Legacy Dynamic Providers API ───────────────────────────────────────

  async loadProviders(): Promise<ProviderConfig[]> {
    const response = await safeFetch(`${BASE_URL}/providers`);
    if (!response.ok) {
      console.error('Failed to load providers:', await response.text());
      return [];
    }
    const data = await response.json();
    return data.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      apiKey: row.api_key || '',
      baseUrl: row.base_url || '',
      enabled: row.enabled,
      enabledModelIds: row.enabled_model_ids || [],
      availableModelIds: row.available_model_ids || [],
      lastFetched: row.last_fetched
    }));
  },

  async saveProvider(p: ProviderConfig): Promise<ProviderConfig> {
    const row = {
      id: p.id,
      name: p.name,
      type: p.type,
      api_key: p.apiKey,
      base_url: p.baseUrl || '',
      enabled: p.enabled,
      enabled_model_ids: p.enabledModelIds,
      available_model_ids: p.availableModelIds,
      last_fetched: p.lastFetched || null
    };

    const response = await safeFetch(`${BASE_URL}/providers/${encodeURIComponent(p.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
    });

    if (!response.ok) throw new Error(`Failed to save provider: HTTP ${response.status}`);
    
    const ret = await response.json();
    return {
      id: ret.id,
      name: ret.name,
      type: ret.type,
      apiKey: ret.api_key || '',
      baseUrl: ret.base_url || '',
      enabled: ret.enabled,
      enabledModelIds: ret.enabled_model_ids || [],
      availableModelIds: ret.available_model_ids || [],
      lastFetched: ret.last_fetched
    };
  },

  async deleteProvider(id: string): Promise<void> {
    await safeFetch(`${BASE_URL}/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  // fetchProviderModels removed — use new fetchProviderModels above (POST /api/providers/:id/fetch-models)

  // ─── Settings / Configuration ─────────────────────────────────────────────────────

  // Get current open project
  async getProject(): Promise<{ project: { path: string; name: string } | null }> {
    return request('/files/project');
  },

  // Open an existing project by OS path
  async openProject(projectPath: string, name?: string): Promise<{ status: string; project: any; manifest: any }> {
    return request('/files/project/open', {
      method: 'POST',
      body: JSON.stringify({ path: projectPath, name }),
    });
  },

  // Create a new project with folder scaffold
  async createProject(projectPath: string, name: string, pythonPath?: string): Promise<{ status: string; project: any; manifest: any }> {
    return request('/files/project/create', {
      method: 'POST',
      body: JSON.stringify({ path: projectPath, name, pythonPath }),
    });
  },

  // Close the current project
  async closeProject(): Promise<{ status: string }> {
    return request('/files/project/close', { method: 'POST' });
  },

  // Get project manifest (octo.json)
  async getProjectMetadata(): Promise<{ manifest: any }> {
    return request('/files/project/metadata');
  },

  // Update project manifest
  async updateProjectMetadata(updates: Record<string, any>): Promise<{ manifest: any }> {
    return request('/files/project/metadata', {
      method: 'POST',
      body: JSON.stringify(updates),
    });
  },

  // Get full file tree (virtual paths)
  async getFileTree(): Promise<{ tree: any[]; projectRoot: string }> {
    return request('/files/tree');
  },

  // List contents of a virtual directory
  async listFiles(virtualPath: string = '/'): Promise<{ path: string; items: any[] }> {
    return request(`/files/list?path=${encodeURIComponent(virtualPath)}`);
  },

  // Move a file within the project
  async moveFile(srcPath: string, dstFolder: string): Promise<{ status: string; srcPath: string; newPath: string }> {
    return request('/files/move', {
      method: 'POST',
      body: JSON.stringify({ srcPath, dstFolder }),
    });
  },

  // Create a new file with optional content (virtual path)
  async createFile(virtualPath: string, content: string = ''): Promise<{ status: string; path: string }> {
    return request('/files/create-file', {
      method: 'POST',
      body: JSON.stringify({ path: virtualPath, content }),
    });
  },


  // Preview CSV file
  async previewCSV(path: string, limit: number = 100): Promise<TablePreviewData> {
    return request(`/files/preview/csv?path=${encodeURIComponent(path)}&limit=${limit}`);
  },

  // Preview Excel file
  async previewExcel(path: string, sheet?: string, limit: number = 100): Promise<TablePreviewData> {
    let url = `/files/preview/excel?path=${encodeURIComponent(path)}&limit=${limit}`;
    if (sheet) url += `&sheet=${encodeURIComponent(sheet)}`;
    return request(url);
  },

};

// Additional types for file system
export interface ProjectInfo {
  path: string;
  name: string;
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  extension?: string;
}

export interface NotebookContent {
  cells: Array<{
    id: string;
    type: string;
    content: string;
  }>;
  metadata?: {
    name?: string;
    created?: string;
    modified?: string;
  };
}

// AI Model types
export interface ModelInfo {
  id: string;
  name: string;
  context: number;
  isLocal?: boolean;  // True if model is running locally (e.g., Ollama)
}

export interface ProviderInfo {
  name: string;
  models: ModelInfo[];
  available: boolean;
  isLocal?: boolean;  // True if provider runs locally (e.g., Ollama)
}

export interface ModelSelection {
  provider: string;
  model: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  enabledModelIds: string[];
  availableModelIds: string[];
  lastFetched?: string;
}

export interface SelectedModel {
  provider: string;
  model: string;
  name: string;
}

// ── New provider types ────────────────────────────────────────────────────────

export interface ProviderEntry {
  id: string;
  name: string;
  type: string;
  base_url: string;
  is_builtin: boolean;
  has_key: boolean;
  model_count: number;
  enabled_count: number;
}

export interface ProviderModelEntry {
  id: number;
  provider_id: string;
  model_id: string;
  model_name: string;
  context_length: number;
  is_enabled: number;
}

export interface EnabledModelEntry {
  id: number;
  provider_id: string;
  model_id: string;
  model_name: string;
  context_length: number;
  is_enabled: number;
  provider_name: string;
}

export interface TablePreviewData {
  path: string;
  headers: string[];
  rows: any[][];
  totalRows: number;
  sheets?: string[];
  currentSheet?: string;
  dtypes?: Record<string, string>;
}

export default controllerClient;
