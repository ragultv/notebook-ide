import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ProjectFile, CellData } from '../types';
import { filesystemClient, NotebookFile } from '../services/filesystem.client';
import { controllerClient } from '../services/controller.client';
import { useAutosave } from './useAutosave';
import { v4 as uuidv4 } from 'uuid';

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
  /** P2-3: Autosave state — lastSaved timestamp, isSaving flag, saveNow() */
  autosave: ReturnType<typeof import('./useAutosave').useAutosave>;
  updateActiveNotebookCells: (cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  updateNotebookCellsById: (notebookId: string, cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  handleNewNotebook: (nameOrCells?: string | CellData[], initialCells?: CellData[], path?: string) => string | null;
  handleOpenFile: () => Promise<void>;
  handleOpenNotebook: (virtualPath: string, name: string) => Promise<void>;
  handleSaveFile: () => Promise<void>;
}

const STORAGE_KEY_NOTEBOOK = 'notebook-ide-current-notebook';

export const useNotebookManagement = (defaultFileId: string): UseNotebookManagementReturn => {
  const [files, setFiles] = useState<ProjectFile[]>([]);

  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(null);
  const [currentNotebookPath, setCurrentNotebookPath] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const activeFile = useMemo(() => files.find(f => f.id === activeFileId), [files, activeFileId]);
  const activeCells = useMemo(() => activeFile?.cells || [], [activeFile]);

  // P2-3: Debounced autosave — 3-second window after last cell change.
  // Builds a minimal NotebookFile for the saver from the active ProjectFile.
  const notebookForAutosave = useMemo<NotebookFile | null>(() => {
    if (!activeFile) return null;
    return {
      id:     activeFile.id,
      name:   activeFile.name,
      path:   activeFile.path || undefined,
      cells:  activeCells.map(c => ({
        id:             c.id,
        type:           c.type,
        content:        c.content,
        output:         c.output,
        outputs:        c.outputs,
        executionCount: c.executionCount ?? null,
      })),
    };
  }, [activeFile, activeCells]);

  const autosave = useAutosave(
    notebookForAutosave,
    activeCells,
    hasUnsavedChanges,
    useCallback(() => setHasUnsavedChanges(false), [])
  );

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

  const updateNotebookCellsById = useCallback((notebookId: string, cells: CellData[] | ((prev: CellData[]) => CellData[])) => {
    setFiles(prev => prev.map(f => {
      if (f.id === notebookId) {
        const newCells = typeof cells === 'function' ? cells(f.cells || []) : cells;
        return { ...f, cells: newCells };
      }
      return f;
    }));
    setHasUnsavedChanges(true);
  }, []);

  const handleNewNotebook = useCallback((nameOrCells?: string | CellData[], initialCellsParam?: CellData[], path?: string) => {
    const newId = crypto.randomUUID();

    let name: string | undefined;
    let initialCells: CellData[] | undefined = initialCellsParam;

    if (typeof nameOrCells === 'string') {
      name = nameOrCells;
    } else if (Array.isArray(nameOrCells)) {
      initialCells = nameOrCells;
    }

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
    } else if (!fileName.endsWith('.ipynb')) {
      fileName = `${fileName}.ipynb`;
    }

    // Use provided cells or default to one empty cell
    const cells = initialCells && initialCells.length > 0
      ? initialCells
      : [{
        id: crypto.randomUUID(),
        type: 'code' as const,
        content: '',
        status: 'idle' as const,
      }];

    const newFile: ProjectFile = {
      id: newId,
      name: fileName,
      type: 'application/x-ipynb+json',
      cells: cells
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newId);
    activeFileIdRef.current = newId;
    setCurrentNotebookPath(path || null);
    setHasUnsavedChanges(true); // new notebooks have unsaved initial cell
    return newId;
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

  /**
   * Open a notebook from the project file tree via virtual path.
   * Used by FileExplorer when user clicks a .ipynb file.
   */
  const handleOpenNotebook = useCallback(async (virtualPath: string, name: string) => {
    // Check if already open — if so, just activate it
    const existing = files.find(f => f.path === virtualPath);
    if (existing) {
      setActiveFileId(existing.id);
      activeFileIdRef.current = existing.id;
      return;
    }
    try {
      const result = await controllerClient.openNotebook(virtualPath);
      const cellsData: CellData[] = (result.content?.cells || []).map((c: any) => ({
        id:             c.id || uuidv4(),
        type:           c.type === 'markdown' ? 'markdown' : 'code',
        content:        c.content || '',
        status:         'idle' as const,
        executionCount: c.executionCount ?? null,
        output:         c.output,
        outputs:        c.outputs && c.outputs.length > 0 ? c.outputs : undefined,
      }));
      const fileId = result.notebookId || uuidv4();
      const projectFile: ProjectFile = {
        id:   fileId,
        name: result.name || name,
        path: virtualPath,
        type: 'application/x-ipynb+json',
        cells: cellsData.length > 0 ? cellsData : [{
          id: uuidv4(), type: 'code', content: '', status: 'idle'
        }],
      };
      setFiles(prev => {
        const dup = prev.find(f => f.path === virtualPath);
        return dup ? prev : [...prev, projectFile];
      });
      setActiveFileId(fileId);
      activeFileIdRef.current = fileId;
      setCurrentNotebookPath(virtualPath);
      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('[useNotebookManagement] Failed to open notebook:', err);
    }
  }, [files]);


  const handleSaveFile = useCallback(async () => {
    if (!activeFile?.cells) return;

    try {
      const notebookData: NotebookFile = {
        id: activeFile.id,
        name: activeFile.name,
        // Include the virtual path so filesystemClient saves silently via the
        // backend (Option 1) — without this, new notebooks without a handle
        // fall through to the browser download dialog (Option 3).
        path: activeFile.path || undefined,
        cells: activeFile.cells.map(cell => ({
          id: cell.id,
          type: cell.type,
          content: cell.content,
          output: cell.output,
          outputs: cell.outputs,
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
    autosave,
    updateActiveNotebookCells,
    updateNotebookCellsById,
    handleNewNotebook,
    handleOpenFile,
    handleOpenNotebook,
    handleSaveFile,

  };
};
