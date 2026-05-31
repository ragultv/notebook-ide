import React, { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Cell } from './Cell';
import { AddCellDivider } from './AddCellDivider';
import { NotebookWSProvider, useNotebookWS } from './NotebookWSContext';
import { VariablePanel } from '../VariablePanel';
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

// ── NotebookInner: the actual component that uses useNotebookWS context ─────

const NotebookInner: React.FC<NotebookProps & {
  executionCounter: number;
  setExecutionCounter: React.Dispatch<React.SetStateAction<number>>;
  cellMoveVersion: number;
  setCellMoveVersion: React.Dispatch<React.SetStateAction<number>>;
}> = ({
  notebookId, notebookName, cells, setCells, activeCellId, setActiveCellId, onFixError,
  executionCounter, setExecutionCounter, cellMoveVersion, setCellMoveVersion,
}) => {
  const { on, getVariables, kernelStatus } = useNotebookWS();
  const [showVariables, setShowVariables] = useState(false);

  const addCell = useCallback((index: number, type: 'code' | 'markdown') => {
    const newCell: CellData = { id: uuidv4(), type, content: '', status: 'idle' };
    const newCells = [...cells];
    newCells.splice(index, 0, newCell);
    setCells(newCells);
    setActiveCellId(newCell.id);
  }, [cells, setCells, setActiveCellId]);

  const updateCell = useCallback((id: string, content: string) => {
    setCells(prev => prev.map(c => c.id === id ? { ...c, content } : c));
  }, [setCells]);

  const updateCellOutput = useCallback((
    id: string, output: string, status: CellStatus,
    error?: string, execCount?: number, outputs?: CellOutput[], duration?: number,
    streamChunk?: CellOutput
  ) => {
    setCells(prev => prev.map(c => {
      if (c.id !== id) return c;

      // ── Streaming chunk append (Issue 5) ───────────────────────────────────
      // When a stream chunk arrives while running, append it to streamingOutputs
      // in shared state so it survives tab unmount/remount without being cleared.
      if (streamChunk && status === 'running') {
        return {
          ...c,
          status: 'running',
          streamingOutputs: [...(c.streamingOutputs ?? []), streamChunk],
        };
      }

      // ── Running (initial) — set runStartTime, clear previous streaming ─────
      if (status === 'running') {
        return {
          ...c,
          status: 'running',
          output: '',
          outputs: [],
          streamingOutputs: [],
          runStartTime: Date.now(),
          error: undefined,
        };
      }

      // ── Stopping (optimistic) ──────────────────────────────────────────────
      if (status === 'stopping') {
        return { ...c, status: 'stopping' };
      }

      // ── Terminal states (success / error / idle) ───────────────────────────
      const updatedCell = {
        ...c,
        output,
        outputs,
        status,
        error,
        duration,
        // Clear live streaming fields on completion
        streamingOutputs: [] as CellOutput[],
        runStartTime: undefined as number | undefined,
        executionCount: execCount !== undefined
          ? execCount
          : (status === 'success' || status === 'error' ? executionCounter : c.executionCount),
      };
      return updatedCell;
    }));
    if (status === 'success' || status === 'error') setExecutionCounter(prev => prev + 1);
  }, [executionCounter, setCells, setExecutionCounter]);

  const deleteCell = useCallback((id: string) => {
    if (cells.length <= 1) return;
    const index = cells.findIndex(c => c.id === id);
    const newCells = cells.filter(c => c.id !== id);
    setCells(newCells);
    const newActiveIndex = index > 0 ? index - 1 : 0;
    if (newCells[newActiveIndex]) setActiveCellId(newCells[newActiveIndex].id);
  }, [cells, setCells, setActiveCellId]);

  const moveCell = useCallback((id: string, direction: 'up' | 'down') => {
    const index = cells.findIndex(c => c.id === id);
    if (direction === 'up' && index > 0) {
      const newCells = [...cells];
      [newCells[index - 1], newCells[index]] = [newCells[index], newCells[index - 1]];
      setCells(newCells); setCellMoveVersion(v => v + 1);
    } else if (direction === 'down' && index < cells.length - 1) {
      const newCells = [...cells];
      [newCells[index + 1], newCells[index]] = [newCells[index], newCells[index + 1]];
      setCells(newCells); setCellMoveVersion(v => v + 1);
    }
  }, [cells, setCells, setCellMoveVersion]);

  const moveCellToIndex = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const newCells = [...cells];
    const [movedCell] = newCells.splice(fromIndex, 1);
    newCells.splice(toIndex, 0, movedCell);
    setCells(newCells); setCellMoveVersion(v => v + 1);
  }, [cells, setCells, setCellMoveVersion]);

  return (
    <div className="flex flex-1 w-full overflow-hidden">
      {/* Main notebook scroll area */}
      <div
        className="flex-1 overflow-y-auto bg-sim-bg relative custom-scrollbar min-w-0"
        onClick={() => setActiveCellId(null)}
      >


        <div className="max-w-[900px] mx-auto min-h-full p-4 md:p-8 pb-32">
          {cells.map((cell, index) => (
            <React.Fragment key={`${cell.id}-${index}-${cellMoveVersion}`}>
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
          <AddCellDivider
            visible={true}
            onAddCode={() => addCell(cells.length, 'code')}
            onAddText={() => addCell(cells.length, 'markdown')}
          />
        </div>
      </div>


    </div>
  );
};

/** Public export — wraps NotebookInner inside the shared WS context provider. */
export const Notebook: React.FC<NotebookProps> = (props) => {
  const [executionCounter, setExecutionCounter] = React.useState(1);
  const [cellMoveVersion, setCellMoveVersion] = React.useState(0);

  return (
    <NotebookWSProvider notebookId={props.notebookId}>
      <NotebookInner
        {...props}
        executionCounter={executionCounter}
        setExecutionCounter={setExecutionCounter}
        cellMoveVersion={cellMoveVersion}
        setCellMoveVersion={setCellMoveVersion}
      />
    </NotebookWSProvider>
  );
};