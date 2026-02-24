// Kernel and execution types
export interface KernelMetrics {
  cpuPercent: number;
  memoryMB: number;
  diskMb?: number;
  gpuMemoryMb?: number;
  executionCount: number;
  isAlive: boolean;
}

export interface ExecutionResult {
  cellId: string;
  notebookId: string;
  success: boolean;
  output?: string;
  outputs?: Array<{
    type: string;
    data: string;
    mimeType?: string;
  }>;
  error?: string;
  executionCount: number;
  duration?: number;
}
