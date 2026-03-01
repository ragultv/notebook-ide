// Cell-related types
export type CellType = 'code' | 'markdown';

export type CellStatus = 'idle' | 'running' | 'success' | 'error' | 'pending';

export type OutputType = 'text' | 'image' | 'html' | 'error' | 'stream' | 'widget' | 'result' | 'display';

export interface CellOutput {
  type: OutputType;
  data: string | Record<string, any>;  // Can be string or MIME bundle object
  mimeType?: string;
  stream?: 'stdout' | 'stderr';
  // Widget-specific fields
  commId?: string;
  targetName?: string;
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
