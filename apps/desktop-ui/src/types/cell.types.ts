// Cell-related types
export type CellType = 'code' | 'markdown';

export type CellStatus = 'idle' | 'running' | 'queued' | 'stopping' | 'success' | 'error' | 'pending';

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
  /** Live streaming chunks during execution — persisted in shared state so they
   *  survive notebook tab switches without being lost. Cleared on completion. */
  streamingOutputs?: CellOutput[];
  /** Epoch ms when execution started — used to resume the elapsed timer correctly
   *  after the user switches away and back to this notebook tab. */
  runStartTime?: number;
  status: CellStatus;
  executionCount?: number | null;
  error?: string;
  duration?: number;
}
