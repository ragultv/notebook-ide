// Shared types for Notebook IDE

// Cell Types
export type CellType = 'code' | 'markdown';
export type CellStatus = 'idle' | 'queued' | 'running' | 'success' | 'error';

export interface Cell {
  id: string;
  type: CellType;
  content: string;
  output?: string;
  status: CellStatus;
  executionCount?: number | null;
  error?: string;
}

// Notebook Types
export interface Notebook {
  id: string;
  name: string;
  path?: string;
  cells: Cell[];
  metadata?: NotebookMetadata;
  dirty?: boolean;
}

export interface NotebookMetadata {
  kernelspec?: {
    name: string;
    display_name: string;
  };
  created?: string;
  modified?: string;
}

// Execution Types
export interface ExecutionRequest {
  cellId: string;
  code: string;
  notebookId?: string;
}

export interface ExecutionResult {
  cellId: string;
  success: boolean;
  output?: string;
  error?: string;
  executionCount: number;
  duration?: number;
}

// Kernel Types
export type KernelStatus = 'disconnected' | 'connecting' | 'idle' | 'busy' | 'error';

export interface KernelInfo {
  id: string;
  status: KernelStatus;
  executionCount: number;
  startedAt?: string;
}

// AI Types
export interface AIRequest {
  prompt: string;
  context?: {
    notebookName?: string;
    cells?: Cell[];
    selectedCellId?: string;
  };
}

export interface AIResponse {
  text: string;
  operations?: AIOperation[];
}

export interface AIOperation {
  type: 'add_cell' | 'delete_cell' | 'move_cell' | 'create_notebook' | 'delete_notebook';
  params: Record<string, any>;
}

// File System Types
export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileEntry[];
}
