import { useState, useCallback } from 'react';
import { CellData } from '../types';

interface UseCellOperationsReturn {
  activeCellId: string | null;
  setActiveCellId: React.Dispatch<React.SetStateAction<string | null>>;
  handleAddCellFromAI: (content: string, type: 'code' | 'markdown', id?: string) => void;
  handleDeleteCellFromAI: (index: number) => void;
  handleMoveCellFromAI: (fromIndex: number, toIndex: number) => void;
  handleEditCellFromAI: (index: number, content: string, type?: 'code' | 'markdown') => void;
}

export const useCellOperations = (
  activeCells: CellData[],
  updateCells: (cells: CellData[] | ((prev: CellData[]) => CellData[])) => void
): UseCellOperationsReturn => {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);

  const handleAddCellFromAI = useCallback((content: string, type: 'code' | 'markdown', id?: string) => {
    const newCell: CellData = {
      // Use server-provided ID if given (Bug 3 fix — keeps ID in sync with agent)
      id: id ?? crypto.randomUUID(),
      type,
      content,
      status: 'idle',
    };
    updateCells(prev => {
      // When a notebook is created or opened with 0 cells on disk, the UI initializes with
      // a single empty placeholder cell. Replace it instead of leaving an empty cell at the top.
      if (prev.length === 1 && (!prev[0].content || prev[0].content.trim() === '')) {
        return [newCell];
      }
      return [...prev, newCell];
    });
  }, [updateCells]);

  const handleDeleteCellFromAI = useCallback((index: number) => {
    // Use functional update to always get latest cells state
    updateCells(prev => prev.filter((_, i) => i !== index));
  }, [updateCells]);

  const handleMoveCellFromAI = useCallback((fromIndex: number, toIndex: number) => {
    // Use functional update to always get latest cells state
    updateCells(prev => {
      const newCells = [...prev];
      const [movedCell] = newCells.splice(fromIndex, 1);
      newCells.splice(toIndex, 0, movedCell);
      return newCells;
    });
  }, [updateCells]);

  const handleEditCellFromAI = useCallback((index: number, content: string, type?: 'code' | 'markdown') => {
    // Use functional update to always get latest cells state
    updateCells(prev => prev.map((cell, i) =>
      i === index ? { ...cell, content, ...(type && { type }) } : cell
    ));
  }, [updateCells]);

  return {
    activeCellId,
    setActiveCellId,
    handleAddCellFromAI,
    handleDeleteCellFromAI,
    handleMoveCellFromAI,
    handleEditCellFromAI,
  };
};

