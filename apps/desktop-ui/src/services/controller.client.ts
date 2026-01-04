// Controller Client - HTTP interface to FastAPI backend
// Handles execution, kernel management, and AI requests

const BASE_URL = 'http://localhost:8000';

// Types
export interface ExecutionRequest {
  cellId: string;
  code: string;
  notebookId: string;  // Required for notebook isolation
}

// Rich output types - like Jupyter
export interface RichOutput {
  type: 'text' | 'image' | 'html' | 'error' | 'stream';
  data: string;
  mimeType?: string;
  stream?: 'stdout' | 'stderr';
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

export interface AIRequest {
  prompt: string;
  context?: {
    notebookName?: string;
    cells?: Array<{ type: string; content: string }>;
  };
}

export interface ErrorFixRequest {
  cellIndex: number;
  error: string;
  cellContent: string;
  context?: {
    notebookName?: string;
    cells?: Array<{ type: string; content: string }>;
  };
}

export interface AIResponse {
  text: string;
  operations?: Array<{
    type: string;
    params: Record<string, any>;
  }>;
}

// HTTP helper
async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || `HTTP ${res.status}`);
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

  // Code Execution
  async runCell(req: ExecutionRequest): Promise<ExecutionResult> {
    return request('/execution/run_cell', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  // Streaming code execution - SSE for real-time output
  runCellStream(
    req: ExecutionRequest,
    onOutput: (output: RichOutput) => void,
    onComplete: (result: ExecutionResult) => void,
    onError: (error: string) => void
  ): () => void {
    const abortController = new AbortController();

    fetch(`${BASE_URL}/execution/run_cell_stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: abortController.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        onError(error.detail || `HTTP ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'output') {
                onOutput(data.output);
              } else if (data.type === 'complete') {
                onComplete(data.result);
              } else if (data.type === 'error') {
                onError(data.error);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    }).catch((e) => {
      if (e.name !== 'AbortError') {
        onError(e.message || 'Stream failed');
      }
    });

    // Return cancel function
    return () => abortController.abort();
  },

  async runAll(cells: ExecutionRequest[]): Promise<ExecutionResult[]> {
    return request('/execution/run_all', {
      method: 'POST',
      body: JSON.stringify({ cells }),
    });
  },

  async interrupt(): Promise<{ status: string }> {
    return request('/execution/interrupt', { method: 'POST' });
  },

  // AI Assistant
  async askAI(req: AIRequest): Promise<AIResponse> {
    return request('/ai/assist', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  // Error Fixing - Analyze and fix cell execution errors
  async fixError(req: ErrorFixRequest): Promise<AIResponse> {
    return request('/ai/fix_error', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  // ===== File System API =====

  // Get current project
  async getCurrentProject(): Promise<{ project: ProjectInfo | null }> {
    return request('/files/project');
  },

  // Open a project folder
  async openProject(path: string, name: string): Promise<{ status: string; project: ProjectInfo }> {
    return request('/files/project/open', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    });
  },

  // Create a new project
  async createProject(path: string, name: string): Promise<{ status: string; project: ProjectInfo }> {
    return request('/files/project/create', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    });
  },

  // List files in a directory
  async listFiles(path?: string): Promise<{ path: string; items: FileItem[] }> {
    const url = path ? `/files/list?path=${encodeURIComponent(path)}` : '/files/list';
    return request(url);
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

    const res = await fetch(`${BASE_URL}/files/upload`, {
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

    const res = await fetch(`${BASE_URL}/files/upload-multiple`, {
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
  async saveNotebook(path: string, content: object): Promise<{ status: string; path: string; size: number }> {
    return request('/files/notebook/save', {
      method: 'POST',
      body: JSON.stringify({ path, content: JSON.stringify(content) }),
    });
  },

  // Open notebook
  async openNotebook(path: string): Promise<{ path: string; name: string; content: NotebookContent }> {
    return request(`/files/notebook/open?path=${encodeURIComponent(path)}`);
  },

  // Get recent projects
  async getRecentProjects(): Promise<{ recent: Array<{ path: string; name: string; opened: string }> }> {
    return request('/files/recent');
  },

  // Add to recent projects
  async addRecentProject(path: string, name: string): Promise<{ status: string }> {
    return request('/files/recent/add', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    });
  },

  // ===== AI Model Management API =====

  // Get all available AI providers and models
  async getProviders(): Promise<{ providers: Record<string, ProviderInfo>; current: ModelSelection }> {
    return request('/ai/models/providers');
  },

  // Select a model
  async selectModel(provider: string, model: string): Promise<{ success: boolean; current: ModelSelection }> {
    return request('/ai/models/select', {
      method: 'POST',
      body: JSON.stringify({ provider, model }),
    });
  },

  // Get current model
  async getCurrentModel(): Promise<ModelSelection> {
    return request('/ai/models/current');
  },

  // Set provider API key
  async setProviderApiKey(provider: string, apiKey: string): Promise<{ success: boolean }> {
    return request('/ai/models/api-key', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
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
}

export interface ProviderInfo {
  name: string;
  models: ModelInfo[];
  available: boolean;
}

export interface ModelSelection {
  provider: string;
  model: string;
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
