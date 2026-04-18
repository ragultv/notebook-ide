import { MemorySnapshot } from '../../../../packages/shared-types/memory';

// Controller Client - HTTP interface to FastAPI backend
// Handles execution, kernel management, and AI requests

const BASE_URL = 'http://127.0.0.1:3001';

// Types
export interface ExecutionRequest {
  cellId: string;
  code: string;
  notebookId: string;  // Required for notebook isolation
  device?: 'cpu' | 'cuda';  // Target compute device for this execution
  language?: 'python' | 'julia'; // Target kernel language
}

// Rich output types - like Jupyter
export interface RichOutput {
  type: 'text' | 'image' | 'html' | 'error' | 'stream' | 'input_request' | 'terminal_output';
  data?: string;
  mimeType?: string;
  stream?: 'stdout' | 'stderr';
  prompt?: string;
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

export type AIMode = 'ask' | 'agent' | 'plan';

export interface AIRequest {
  prompt: string;
  sessionId?: string | null;
  mode?: AIMode;
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
  tokenInfo?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  sessionId?: string;
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
  async startKernel(notebookId?: string, language?: 'python' | 'julia'): Promise<KernelInfo> {
    return request('/kernels/start', {
      method: 'POST',
      body: JSON.stringify({ notebookId, language }),
    });
  },

  async stopKernel(notebookId?: string): Promise<{ status: string }> {
    return request('/kernels/stop', { method: 'POST', body: JSON.stringify({ notebookId }) });
  },

  async restartKernel(notebookId?: string, language?: 'python' | 'julia'): Promise<KernelInfo> {
    return request('/kernels/restart', {
      method: 'POST',
      body: JSON.stringify({ notebookId, language }),
    });
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

  // Memory Visualization
  async getMemorySnapshot(notebookId: string, method: 'umap' | 'pca' = 'umap'): Promise<MemorySnapshot> {
    const params = new URLSearchParams({ notebookId, method });
    return request(`/api/memory/snapshot?${params.toString()}`);
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

  async interrupt(notebookId: string): Promise<{ status: string }> {
    return request('/execution/interrupt', {
      method: 'POST',
      body: JSON.stringify({ notebookId })
    });
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

  // AI Assistant
  async askAI(req: AIRequest): Promise<AIResponse> {
    return request('/ai/assist', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  /**
   * Streaming AI Assistant (SSE). Callbacks are invoked as events arrive.
   * onPlanReady: for plan mode, operations are ready but not executed; user confirms first.
   * Pass signal for cancellation.
   */
  async askAIStream(
    req: AIRequest,
    callbacks: {
      onChunk: (delta: string) => void;
      onOperations?: (operations: Array<{ type: string; params: Record<string, any> }>) => void;
      onPlanReady?: (operations: Array<{ type: string; params: Record<string, any> }>) => void;
      onDone: (payload: { sessionId?: string; tokenInfo?: AIResponse['tokenInfo'] }) => void;
      onError: (message: string) => void;
    },
    signal?: AbortSignal
  ): Promise<void> {
    const res = await fetch(`${BASE_URL}/ai/assist/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) {
      const err = await res.text();
      callbacks.onError(err || `HTTP ${res.status}`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response body');
      return;
    }
    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const raw of events) {
          let event = '';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            if (event === 'chunk' && payload.delta != null) callbacks.onChunk(payload.delta);
            else if (event === 'operations' && Array.isArray(payload.operations) && callbacks.onOperations) callbacks.onOperations(payload.operations);
            else if (event === 'plan_ready' && Array.isArray(payload.operations) && callbacks.onPlanReady) callbacks.onPlanReady(payload.operations);
            else if (event === 'done') callbacks.onDone(payload);
            else if (event === 'error' && payload.message) callbacks.onError(payload.message);
          } catch (_) { }
        }
      }
      if (buf.trim()) {
        let event = '';
        let data = '';
        for (const line of buf.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (data) {
          try {
            const payload = JSON.parse(data);
            if (event === 'plan_ready' && Array.isArray(payload.operations) && callbacks.onPlanReady) callbacks.onPlanReady(payload.operations);
            else if (event === 'done') callbacks.onDone(payload);
            else if (event === 'error' && payload.message) callbacks.onError(payload.message);
          } catch (_) { }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') callbacks.onError('Cancelled');
      else callbacks.onError(e?.message ?? 'Stream failed');
    }
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

  // Get all available AI providers and models (includes both cloud and local)
  async getProviders(): Promise<{ providers: Record<string, ProviderInfo>; current: ModelSelection; selectedModels: SelectedModel[] }> {
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

  // Toggle model selection for chat dropdown
  async toggleModelSelection(provider: string, modelId: string, selected: boolean): Promise<{ success: boolean; selectedModels: SelectedModel[] }> {
    return request('/ai/models/toggle-selection', {
      method: 'POST',
      body: JSON.stringify({ provider, modelId, selected }),
    });
  },

  // Get selected models for chat dropdown
  async getSelectedModels(): Promise<{ selectedModels: SelectedModel[] }> {
    return request('/ai/models/selected');
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

  // Chat history
  async getChatSessions(): Promise<{ sessions: Array<{ id: string; notebook_name: string | null; created_at: number; last_activity_at: number; messageCount: number }> }> {
    return request('/ai/chat/sessions');
  },

  async getChatMessages(sessionId: string): Promise<{ messages: Array<{ id: number; session_id: string; role: 'user' | 'assistant' | 'system'; content: string; token_estimate: number | null; created_at: number }> }> {
    return request(`/ai/chat/sessions/${encodeURIComponent(sessionId)}/messages`);
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

export interface SelectedModel {
  provider: string;
  modelId: string;
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
