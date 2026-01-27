// Project and file explorer types
export interface ProjectInfo {
  rootPath: string;
  name: string;
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileItem[];
}

export interface CSVPreview {
  headers: string[];
  rows: string[][];
}
