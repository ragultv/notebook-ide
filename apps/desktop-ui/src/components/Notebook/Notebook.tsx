/**
 * Notebook.tsx — Notebook Container
 *
 * VS Code equivalent: NotebookEditorWidget.ts
 * (src/vs/workbench/contrib/notebook/browser/notebookEditorWidget.ts)
 *
 * Architecture changes:
 *   OLD: updateCellOutput() was called on every streaming chunk → full reconcile
 *        Run All used window.dispatchEvent → conflicted with WS run_all path
 *   NEW: updateCellOutput only called ONCE on completion (final state)
 *        Run All sends WS 'run_all' message (single path, through ExecutionEngine)
 *        Cell streaming is isolated in CellOutputView — Notebook never sees it
 */

import React, { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Cell } from './Cell';
import { AddCellDivider } from './AddCellDivider';
import { NotebookWSProvider, useNotebookWS } from './NotebookWSContext';
import { CellData, CellOutput } from '../../types';

interface NotebookProps {
    notebookId: string;
    notebookName: string;
    cells: CellData[];
    setCells: React.Dispatch<React.SetStateAction<CellData[]>>;
    activeCellId: string | null;
    setActiveCellId: (id: string | null) => void;
    onFixError?: (cellIndex: number, error: string, cellContent: string, allCells: CellData[], cellId: string) => void;
}

// ── NotebookInner ─────────────────────────────────────────────────────────────

const NotebookInner: React.FC<NotebookProps & {
    cellMoveVersion: number;
    setCellMoveVersion: React.Dispatch<React.SetStateAction<number>>;
}> = ({
    notebookId, notebookName, cells, setCells, activeCellId, setActiveCellId, onFixError,
    cellMoveVersion, setCellMoveVersion,
}) => {
        const { connected } = useNotebookWS();

        // ── Cell mutations ────────────────────────────────────────────────────────

        const addCell = useCallback((index: number, type: 'code' | 'markdown') => {
            const newCell: CellData = { id: uuidv4(), type, content: '', status: 'idle' };
            setCells(prev => {
                const next = [...prev];
                next.splice(index, 0, newCell);
                return next;
            });
            setActiveCellId(newCell.id);
        }, [setCells, setActiveCellId]);

        const updateCell = useCallback((id: string, content: string) => {
            setCells(prev => prev.map(c => c.id === id ? { ...c, content } : c));
        }, [setCells]);

        /**
         * Called ONCE per cell execution on completion.
         * Persists final outputs to shared state (for save/reload).
         * NOT called on streaming chunks — CellOutputView handles those internally.
         *
         * VS Code equivalent: NotebookTextModel.applyEdits() called after execution complete.
         */
        const handleFinalOutput = useCallback((
            id: string,
            outputs: CellOutput[],
            error?: string,
        ) => {
            setCells(prev => prev.map(c => {
                if (c.id !== id) return c;
                return {
                    ...c,
                    outputs: outputs.length > 0 ? outputs : c.outputs,
                    error: error ?? undefined,
                    output: error ? undefined : c.output,
                };
            }));
        }, [setCells]);

        const deleteCell = useCallback((id: string) => {
            setCells(prev => {
                if (prev.length <= 1) return prev;
                const index = prev.findIndex(c => c.id === id);
                const next = prev.filter(c => c.id !== id);
                const newActiveIndex = index > 0 ? index - 1 : 0;
                if (next[newActiveIndex]) setActiveCellId(next[newActiveIndex].id);
                return next;
            });
        }, [setCells, setActiveCellId]);

        const moveCell = useCallback((id: string, direction: 'up' | 'down') => {
            setCells(prev => {
                const index = prev.findIndex(c => c.id === id);
                const next = [...prev];
                if (direction === 'up' && index > 0) {
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                } else if (direction === 'down' && index < prev.length - 1) {
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                }
                return next;
            });
            setCellMoveVersion(v => v + 1);
        }, [setCells, setCellMoveVersion]);

        const moveCellToIndex = useCallback((fromIndex: number, toIndex: number) => {
            if (fromIndex === toIndex) return;
            setCells(prev => {
                const next = [...prev];
                const [moved] = next.splice(fromIndex, 1);
                next.splice(toIndex, 0, moved);
                return next;
            });
            setCellMoveVersion(v => v + 1);
        }, [setCells, setCellMoveVersion]);

        // ── Render ────────────────────────────────────────────────────────────────

        return (
            <div className="flex flex-1 w-full overflow-hidden">
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
                                    onFinalOutput={handleFinalOutput}
                                    onDelete={deleteCell}
                                    onMoveUp={(id) => moveCell(id, 'up')}
                                    onMoveDown={(id) => moveCell(id, 'down')}
                                    onMove={moveCellToIndex}
                                    onFixError={onFixError ? async (idx, err, content) =>
                                        await onFixError(idx, err, content, cells, cell.id) : undefined}
                                    allCells={cells}
                                    connected={connected}
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

// ── Public export ─────────────────────────────────────────────────────────────

export const Notebook: React.FC<NotebookProps> = (props) => {
    const [cellMoveVersion, setCellMoveVersion] = React.useState(0);
    const cellIds = props.cells.map(c => c.id);

    return (
        <NotebookWSProvider notebookId={props.notebookId} cellIds={cellIds}>
            <NotebookInner
                {...props}
                cellMoveVersion={cellMoveVersion}
                setCellMoveVersion={setCellMoveVersion}
            />
        </NotebookWSProvider>
    );
};