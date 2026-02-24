import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ProjectFile, CellData } from '../types';
import { filesystemClient, NotebookFile } from '../services/filesystem.client';

const STORAGE_KEY_NOTEBOOK = 'notebook-ide-current-notebook';
const AUTO_SAVE_INTERVAL = 30000;

interface UseNotebookManagementReturn {
  files: ProjectFile[];
  setFiles: React.Dispatch<React.SetStateAction<ProjectFile[]>>;
  activeFileId: string | null;
  setActiveFileId: React.Dispatch<React.SetStateAction<string | null>>;
  activeFileIdRef: React.MutableRefObject<string | null>;
  currentNotebookPath: string | null;
  setCurrentNotebookPath: React.Dispatch<React.SetStateAction<string | null>>;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;
  activeFile: ProjectFile | undefined;
  activeCells: CellData[];
  updateActiveNotebookCells: (cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  handleNewNotebook: (name?: string, initialCells?: CellData[], path?: string) => void;
  handleOpenFile: () => Promise<void>;
  handleSaveFile: () => Promise<void>;
}

export const useNotebookManagement = (defaultFileId: string): UseNotebookManagementReturn => {
  const [files, setFiles] = useState<ProjectFile[]>([
    {
      id: defaultFileId,
      name: 'Untitled.ipynb',
      type: 'application/x-ipynb+json',
      cells: [{
        id: crypto.randomUUID(),
        type: 'code',
        content: '',
        status: 'idle',
      }]
    }
  ]);

  const [activeFileId, setActiveFileId] = useState<string | null>(defaultFileId);
  const activeFileIdRef = useRef<string | null>(defaultFileId);
  const [currentNotebookPath, setCurrentNotebookPath] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const activeFile = useMemo(() => files.find(f => f.id === activeFileId), [files, activeFileId]);
  const activeCells = useMemo(() => activeFile?.cells || [], [activeFile]);

  // Note: Auto-loading saved notebook on mount is not possible due to browser security.
  // File System Access API requires a user gesture to show file picker.
  // Users must manually open files via the "Open File" button.

  // Auto-save
  useEffect(() => {
    if (!hasUnsavedChanges || !currentNotebookPath || !activeFile) return;

    const timer = setInterval(() => {
      handleSaveFile();
    }, AUTO_SAVE_INTERVAL);

    return () => clearInterval(timer);
  }, [hasUnsavedChanges, currentNotebookPath, activeFile]);

  // Save notebook path to localStorage
  useEffect(() => {
    if (currentNotebookPath) {
      localStorage.setItem(STORAGE_KEY_NOTEBOOK, currentNotebookPath);
    }
  }, [currentNotebookPath]);

  const updateActiveNotebookCells = useCallback((cells: CellData[] | ((prev: CellData[]) => CellData[])) => {
    setFiles(prev => prev.map(f => {
      if (f.id === activeFileId) {
        const newCells = typeof cells === 'function' ? cells(f.cells || []) : cells;
        return { ...f, cells: newCells };
      }
      return f;
    }));
    setHasUnsavedChanges(true);
  }, [activeFileId]);

  const handleNewNotebook = useCallback((name?: string, initialCells?: CellData[], path?: string) => {
    const newId = crypto.randomUUID();

    let fileName = name;
    if (!fileName) {
      // Generate unique filename if none provided
      const baseFileName = 'Untitled';
      fileName = `${baseFileName}.ipynb`;
      let counter = 2;

      // Check if filename exists and increment counter
      const existingNames = new Set(files.map(f => f.name));
      while (existingNames.has(fileName)) {
        fileName = `${baseFileName}-${counter}.ipynb`;
        counter++;
      }
    }

    // Ensure .ipynb extension
    if (fileName && !fileName.endsWith('.ipynb')) {
      fileName = `${fileName}.ipynb`;
    }

    const newFile: ProjectFile = {
      id: newId,
      name: fileName!,
      type: 'application/x-ipynb+json',
      path: path,
      cells: initialCells || [{
        id: crypto.randomUUID(),
        type: 'code',
        content: '',
        status: 'idle',
      }]
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newId);
    activeFileIdRef.current = newId;
    setCurrentNotebookPath(path || null);
    setHasUnsavedChanges(false);
  }, [files]);

  const handleOpenFile = useCallback(async () => {
    try {
      const file = await filesystemClient.openNotebook();
      if (file) {
        const projectFile: ProjectFile = {
          ...file,
          type: 'application/x-ipynb+json',
          cells: file.cells.map(cell => ({
            ...cell,
            status: 'idle' as const,
          })),
        };
        setFiles(prev => {
          const exists = prev.find(f => f.id === projectFile.id);
          return exists ? prev : [...prev, projectFile];
        });
        setActiveFileId(projectFile.id);
        activeFileIdRef.current = projectFile.id;
        setCurrentNotebookPath(file.path || file.name);
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!activeFile?.cells) return;

    try {
      const notebookData: NotebookFile = {
        id: activeFile.id,
        name: activeFile.name,
        cells: activeFile.cells.map(cell => ({
          id: cell.id,
          type: cell.type,
          content: cell.content,
          output: cell.output,
          executionCount: cell.executionCount || null,
        })),
      };

      await filesystemClient.saveNotebook(notebookData);
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save file:', error);
      const err = error as Error;
      alert(`Save failed: ${err.message || 'Unknown error'}`);
    }
  }, [activeFile]);

  return {
    files,
    setFiles,
    activeFileId,
    setActiveFileId,
    activeFileIdRef,
    currentNotebookPath,
    setCurrentNotebookPath,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    activeFile,
    activeCells,
    updateActiveNotebookCells,
    handleNewNotebook,
    handleOpenFile,
    handleSaveFile,
  };
};
