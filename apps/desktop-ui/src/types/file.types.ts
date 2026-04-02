import { CellData } from './cell.types';

export type FileType = 'notebook' | 'image' | 'data' | 'other' | 'settings' | 'visualization';

export type NotebookLanguage = 'python' | 'julia';

export interface ProjectFile {
  id: string;
  name: string;
  type: string;
  file?: File;
  cells?: CellData[];
  path?: string;
  language?: NotebookLanguage;
}

export interface Tab {
  id: string;
  title: string;
  type: FileType;
  path?: string;
  isDirty?: boolean;
  data?: {
    isObjectUrl?: boolean;
  };
}

export interface NotebookFile extends ProjectFile {
  cells: CellData[];
  type: 'application/x-ipynb+json';
}

export interface IpynbCell {
  cell_type: 'code' | 'markdown';
  source: string | string[];
  outputs?: unknown[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

export interface IpynbFormat {
  cells: IpynbCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}
