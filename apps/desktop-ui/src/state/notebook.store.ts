import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

// Types
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

export interface Notebook {
  id: string;
  name: string;
  path?: string;
  cells: Cell[];
  dirty: boolean;
}

interface NotebookState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  activeCellId: string | null;
  
  // Notebook actions
  createNotebook: (name: string, path?: string) => string;
  deleteNotebook: (id: string) => void;
  renameNotebook: (id: string, name: string) => void;
  setActiveNotebook: (id: string | null) => void;
  loadNotebook: (notebook: Notebook) => void;
  markDirty: (id: string, dirty: boolean) => void;
  
  // Cell actions
  addCell: (type: CellType, content?: string, index?: number) => string | null;
  deleteCell: (cellId: string) => void;
  moveCell: (fromIndex: number, toIndex: number) => void;
  updateCellContent: (cellId: string, content: string) => void;
  updateCellType: (cellId: string, type: CellType) => void;
  updateCellStatus: (cellId: string, status: CellStatus, output?: string, error?: string, execCount?: number) => void;
  setActiveCell: (cellId: string | null) => void;
  
  // Selectors (computed)
  getActiveNotebook: () => Notebook | undefined;
  getActiveCells: () => Cell[];
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebooks: [],
  activeNotebookId: null,
  activeCellId: null,
  
  // Create a new notebook
  createNotebook: (name: string, path?: string) => {
    const id = uuidv4();
    const initialCell: Cell = {
      id: uuidv4(),
      type: 'code',
      content: '',
      status: 'idle',
    };
    
    const notebook: Notebook = {
      id,
      name: name.endsWith('.ipynb') ? name : `${name}.ipynb`,
      path,
      cells: [initialCell],
      dirty: false,
    };
    
    set(state => ({
      notebooks: [...state.notebooks, notebook],
      activeNotebookId: id,
      activeCellId: initialCell.id,
    }));
    
    return id;
  },
  
  // Delete notebook
  deleteNotebook: (id: string) => {
    set(state => {
      const remaining = state.notebooks.filter(n => n.id !== id);
      const newActiveId = state.activeNotebookId === id 
        ? (remaining[0]?.id || null)
        : state.activeNotebookId;
      const newActiveCellId = state.activeNotebookId === id
        ? (remaining[0]?.cells[0]?.id || null)
        : state.activeCellId;
        
      return {
        notebooks: remaining,
        activeNotebookId: newActiveId,
        activeCellId: newActiveCellId,
      };
    });
  },
  
  // Rename notebook
  renameNotebook: (id: string, name: string) => {
    set(state => ({
      notebooks: state.notebooks.map(n => 
        n.id === id ? { ...n, name, dirty: true } : n
      ),
    }));
  },
  
  // Set active notebook
  setActiveNotebook: (id: string | null) => {
    set(state => {
      const notebook = state.notebooks.find(n => n.id === id);
      return {
        activeNotebookId: id,
        activeCellId: notebook?.cells[0]?.id || null,
      };
    });
  },
  
  // Load existing notebook
  loadNotebook: (notebook: Notebook) => {
    set(state => {
      const existing = state.notebooks.find(n => n.id === notebook.id);
      if (existing) {
        return {
          notebooks: state.notebooks.map(n => n.id === notebook.id ? notebook : n),
          activeNotebookId: notebook.id,
          activeCellId: notebook.cells[0]?.id || null,
        };
      }
      return {
        notebooks: [...state.notebooks, notebook],
        activeNotebookId: notebook.id,
        activeCellId: notebook.cells[0]?.id || null,
      };
    });
  },
  
  // Mark notebook dirty
  markDirty: (id: string, dirty: boolean) => {
    set(state => ({
      notebooks: state.notebooks.map(n => 
        n.id === id ? { ...n, dirty } : n
      ),
    }));
  },
  
  // Add cell
  addCell: (type: CellType, content = '', index?: number) => {
    const { activeNotebookId, notebooks } = get();
    if (!activeNotebookId) return null;
    
    const cellId = uuidv4();
    const newCell: Cell = {
      id: cellId,
      type,
      content,
      status: 'idle',
    };
    
    set(state => ({
      notebooks: state.notebooks.map(n => {
        if (n.id !== activeNotebookId) return n;
        
        const cells = [...n.cells];
        if (index !== undefined && index >= 0 && index <= cells.length) {
          cells.splice(index, 0, newCell);
        } else {
          cells.push(newCell);
        }
        
        return { ...n, cells, dirty: true };
      }),
      activeCellId: cellId,
    }));
    
    return cellId;
  },
  
  // Delete cell
  deleteCell: (cellId: string) => {
    const { activeNotebookId } = get();
    if (!activeNotebookId) return;
    
    set(state => {
      const notebook = state.notebooks.find(n => n.id === activeNotebookId);
      if (!notebook || notebook.cells.length <= 1) return state; // Keep at least 1 cell
      
      const cellIndex = notebook.cells.findIndex(c => c.id === cellId);
      const newCells = notebook.cells.filter(c => c.id !== cellId);
      const newActiveCellId = state.activeCellId === cellId
        ? (newCells[Math.max(0, cellIndex - 1)]?.id || newCells[0]?.id || null)
        : state.activeCellId;
      
      return {
        notebooks: state.notebooks.map(n => 
          n.id === activeNotebookId ? { ...n, cells: newCells, dirty: true } : n
        ),
        activeCellId: newActiveCellId,
      };
    });
  },
  
  // Move cell
  moveCell: (fromIndex: number, toIndex: number) => {
    const { activeNotebookId } = get();
    if (!activeNotebookId) return;
    
    set(state => ({
      notebooks: state.notebooks.map(n => {
        if (n.id !== activeNotebookId) return n;
        
        const cells = [...n.cells];
        if (fromIndex < 0 || fromIndex >= cells.length) return n;
        if (toIndex < 0 || toIndex >= cells.length) return n;
        
        const [moved] = cells.splice(fromIndex, 1);
        cells.splice(toIndex, 0, moved);
        
        return { ...n, cells, dirty: true };
      }),
    }));
  },
  
  // Update cell content
  updateCellContent: (cellId: string, content: string) => {
    const { activeNotebookId } = get();
    if (!activeNotebookId) return;
    
    set(state => ({
      notebooks: state.notebooks.map(n => {
        if (n.id !== activeNotebookId) return n;
        return {
          ...n,
          cells: n.cells.map(c => c.id === cellId ? { ...c, content } : c),
          dirty: true,
        };
      }),
    }));
  },
  
  // Update cell type
  updateCellType: (cellId: string, type: CellType) => {
    const { activeNotebookId } = get();
    if (!activeNotebookId) return;
    
    set(state => ({
      notebooks: state.notebooks.map(n => {
        if (n.id !== activeNotebookId) return n;
        return {
          ...n,
          cells: n.cells.map(c => c.id === cellId ? { ...c, type } : c),
          dirty: true,
        };
      }),
    }));
  },
  
  // Update cell status (from execution)
  updateCellStatus: (cellId: string, status: CellStatus, output?: string, error?: string, execCount?: number) => {
    const { activeNotebookId } = get();
    if (!activeNotebookId) return;
    
    set(state => ({
      notebooks: state.notebooks.map(n => {
        if (n.id !== activeNotebookId) return n;
        return {
          ...n,
          cells: n.cells.map(c => {
            if (c.id !== cellId) return c;
            return {
              ...c,
              status,
              output: output ?? c.output,
              error: error ?? (status === 'success' ? undefined : c.error),
              executionCount: execCount ?? c.executionCount,
            };
          }),
        };
      }),
    }));
  },
  
  // Set active cell
  setActiveCell: (cellId: string | null) => {
    set({ activeCellId: cellId });
  },
  
  // Selectors
  getActiveNotebook: () => {
    const { notebooks, activeNotebookId } = get();
    return notebooks.find(n => n.id === activeNotebookId);
  },
  
  getActiveCells: () => {
    const notebook = get().getActiveNotebook();
    return notebook?.cells || [];
  },
}));
