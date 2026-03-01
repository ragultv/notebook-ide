import React, { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Cell } from './Cell';
import { AddCellDivider } from './AddCellDivider';
import { NotebookWSProvider } from './NotebookWSContext';
import { CellData, CellStatus, CellOutput } from '../../types';

interface NotebookProps {
  notebookId: string;
  notebookName: string;
  cells: CellData[];
  setCells: React.Dispatch<React.SetStateAction<CellData[]>>;
  activeCellId: string | null;
  setActiveCellId: (id: string | null) => void;
  onFixError?: (cellIndex: number, error: string, cellContent: string, allCells: CellData[], cellId: string) => void;
}

export const Notebook: React.FC<NotebookProps> = ({
  notebookId,
  notebookName,
  cells,
  setCells,
  activeCellId,
  setActiveCellId,
  onFixError,
}) => {
  const [executionCounter, setExecutionCounter] = React.useState(1);
  // cellMoveVersion increments on every move — combined with position in the key,
  // ensures cells are fully unmounted+remounted on reorder (avoids Monaco reconnectPassiveEffects crash).
  const [cellMoveVersion, setCellMoveVersion] = React.useState(0);

  const addCell = useCallback((index: number, type: 'code' | 'markdown') => {
    const newCell: CellData = {
      id: uuidv4(),
      type,
      content: '',
      status: 'idle',
    };
    const newCells = [...cells];
    newCells.splice(index, 0, newCell);
    setCells(newCells);
    setActiveCellId(newCell.id);
  }, [cells, setCells, setActiveCellId]);

  const updateCell = useCallback((id: string, content: string) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, content } : c));
  }, [setCells]);

  const updateCellOutput = useCallback((id: string, output: string, status: CellStatus, error?: string, execCount?: number, outputs?: CellOutput[], duration?: number) => {
    setCells(prev => prev.map(c => {
      if (c.id === id) {
        return {
          ...c,
          output,
          outputs,
          status,
          error,
          duration,
          executionCount: execCount !== undefined ? execCount : (status === 'success' || status === 'error' ? executionCounter : c.executionCount)
        };
      }
      return c;
    }));
    if (status === 'success' || status === 'error') {
      setExecutionCounter(prev => prev + 1);
    }
  }, [executionCounter, setCells]);

  const deleteCell = useCallback((id: string) => {
    if (cells.length <= 1) return; // Prevent deleting last cell
    const index = cells.findIndex(c => c.id === id);
    const newCells = cells.filter(c => c.id !== id);
    setCells(newCells);
    // Set active to the cell above, or below if first
    const newActiveIndex = index > 0 ? index - 1 : 0;
    if (newCells[newActiveIndex]) setActiveCellId(newCells[newActiveIndex].id);
  }, [cells, setCells, setActiveCellId]);

  const moveCell = useCallback((id: string, direction: 'up' | 'down') => {
    const index = cells.findIndex(c => c.id === id);
    if (direction === 'up' && index > 0) {
      const newCells = [...cells];
      [newCells[index - 1], newCells[index]] = [newCells[index], newCells[index - 1]];
      setCells(newCells);
      setCellMoveVersion(v => v + 1);
    } else if (direction === 'down' && index < cells.length - 1) {
      const newCells = [...cells];
      [newCells[index + 1], newCells[index]] = [newCells[index], newCells[index + 1]];
      setCells(newCells);
      setCellMoveVersion(v => v + 1);
    }
  }, [cells, setCells]);

  // Handle Drag and Drop Reordering
  const moveCellToIndex = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newCells = [...cells];
    const [movedCell] = newCells.splice(fromIndex, 1);
    newCells.splice(toIndex, 0, movedCell);
    setCells(newCells);
    setCellMoveVersion(v => v + 1);
  }, [cells, setCells]);

  return (
    <NotebookWSProvider notebookId={notebookId}>
      <div
        className="flex-1 overflow-y-auto bg-sim-bg w-full relative custom-scrollbar"
        onClick={() => setActiveCellId(null)}
      >
        <div className="max-w-[900px] mx-auto min-h-full p-4 md:p-8 pb-32">
          {cells.map((cell, index) => (
            // Key includes position (index) AND move-version so React fully
            // unmounts+remounts Monaco when a cell is moved, instead of calling
            // reconnectPassiveEffects — which crashes Monaco's background tokenizer.
            <React.Fragment key={`${cell.id}-${index}-${cellMoveVersion}`}>
              {/* Divider before cell */}
              <AddCellDivider
                visible={activeCellId === cell.id}
                onAddCode={() => addCell(index, 'code')}
                onAddText={() => addCell(index, 'markdown')}
              />

              <Cell
                cell={cell}
                index={index}
                notebookId={notebookId}
                notebookName={notebookName}
                isActive={activeCellId === cell.id}
                onActivate={() => setActiveCellId(cell.id)}
                onDeactivate={() => setActiveCellId(null)}
                onUpdate={updateCell}
                onOutputUpdate={updateCellOutput}
                onDelete={deleteCell}
                onMoveUp={(id) => moveCell(id, 'up')}
                onMoveDown={(id) => moveCell(id, 'down')}
                onMove={moveCellToIndex}
                onFixError={onFixError ? async (idx, err, content) => await onFixError(idx, err, content, cells, cell.id) : undefined}
                allCells={cells}
              />
            </React.Fragment>
          ))}

          {/* Final Divider */}
          <AddCellDivider
            visible={true}
            onAddCode={() => addCell(cells.length, 'code')}
            onAddText={() => addCell(cells.length, 'markdown')}
          />
        </div>
      </div>
    </NotebookWSProvider>
  );
};