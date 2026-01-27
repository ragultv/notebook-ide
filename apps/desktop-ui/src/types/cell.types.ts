// Cell-related types
export type CellType = 'code' | 'markdown';

export type CellStatus = 'idle' | 'running' | 'success' | 'error' | 'pending';

export type OutputType = 'text' | 'image' | 'html' | 'error' | 'stream';

export interface CellOutput {
  type: OutputType;
  data: string;
  mimeType?: string;
  stream?: 'stdout' | 'stderr';
}

export interface CellData {
  id: string;
  type: CellType;
  content: string;
  output?: string;
  outputs?: CellOutput[];
  status: CellStatus;
  executionCount?: number | null;
  error?: string;
  duration?: number;
}
