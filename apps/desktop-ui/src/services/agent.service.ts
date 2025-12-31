// UI Agent Service - Notebook Management Only
// This agent handles UI-level notebook operations (no execution, no AI calls)

import { useNotebookStore, CellType } from '../state/notebook.store';

export interface AgentOperation {
  type: 'add_cell' | 'delete_cell' | 'move_cell' | 'create_notebook' | 'delete_notebook';
  params: Record<string, any>;
}

// UI Agent - manages notebook structure only
export const notebookAgent = {
  // Create a new notebook
  createNotebook(name: string): string {
    const store = useNotebookStore.getState();
    return store.createNotebook(name);
  },

  // Delete a notebook by ID or name
  deleteNotebook(idOrName: string): void {
    const store = useNotebookStore.getState();
    const notebook = store.notebooks.find(n => n.id === idOrName || n.name === idOrName);
    if (notebook) {
      store.deleteNotebook(notebook.id);
    }
  },

  // Rename a notebook
  renameNotebook(id: string, newName: string): void {
    const store = useNotebookStore.getState();
    store.renameNotebook(id, newName);
  },

  // Add a cell to active notebook
  addCell(type: CellType, content?: string, index?: number): string | null {
    const store = useNotebookStore.getState();
    return store.addCell(type, content, index);
  },

  // Delete a cell by index (1-based for user-facing operations)
  deleteCellByIndex(index: number): void {
    const store = useNotebookStore.getState();
    const cells = store.getActiveCells();
    const arrayIndex = index - 1;
    if (arrayIndex >= 0 && arrayIndex < cells.length) {
      store.deleteCell(cells[arrayIndex].id);
    }
  },

  // Delete cell by ID
  deleteCell(cellId: string): void {
    const store = useNotebookStore.getState();
    store.deleteCell(cellId);
  },

  // Move cell (1-based indices)
  moveCell(fromIndex: number, toIndex: number): void {
    const store = useNotebookStore.getState();
    store.moveCell(fromIndex - 1, toIndex - 1);
  },

  // Process AI operations
  processOperations(operations: AgentOperation[]): void {
    for (const op of operations) {
      switch (op.type) {
        case 'create_notebook':
          this.createNotebook(op.params.name);
          break;
        case 'delete_notebook':
          this.deleteNotebook(op.params.name || '');
          break;
        case 'add_cell':
          this.addCell(op.params.type || 'code', op.params.content || '');
          break;
        case 'delete_cell':
          this.deleteCellByIndex(op.params.cellIndex);
          break;
        case 'move_cell':
          this.moveCell(op.params.fromIndex, op.params.toIndex);
          break;
      }
    }
  },
};

export default notebookAgent;