import React from 'react';

export type CellType = 'code' | 'markdown';

export type CellStatus = 'idle' | 'running' | 'success' | 'error' | 'pending';

// Rich output types - like Jupyter
export type OutputType = 'text' | 'image' | 'html' | 'error' | 'stream';

export interface CellOutput {
  type: OutputType;
  data: string; // text content or base64 for images
  mimeType?: string; // e.g., 'image/png', 'text/html'
  stream?: 'stdout' | 'stderr'; // for stream outputs
}

export interface CellData {
  id: string;
  type: CellType;
  content: string;
  output?: string; // Keep for backward compatibility
  outputs?: CellOutput[]; // Rich outputs array
  status: CellStatus;
  executionCount?: number | null;
  error?: string;
  duration?: number; // Execution time in seconds
}

export interface ProjectFile {
  id: string;
  name: string;
  type: string;
  file?: File; // Optional because initial default file might not have a File object
  cells?: CellData[]; // Store the notebook structure if it is a notebook
}

export interface NotebookState {
  cells: CellData[];
  activeCellId: string | null;
}

export interface SidebarSection {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
  content: React.ReactNode;
}