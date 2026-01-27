import { useState, useCallback } from 'react';
import { CellData } from '../types';

interface UseCellOperationsReturn {
  activeCellId: string | null;
  setActiveCellId: React.Dispatch<React.SetStateAction<string | null>>;
  handleAddCellFromAI: (content: string, type: 'code' | 'markdown') => void;
  handleDeleteCellFromAI: (index: number) => void;
  handleMoveCellFromAI: (fromIndex: number, toIndex: number) => void;
  handleEditCellFromAI: (index: number, content: string, type?: 'code' | 'markdown') => void;
}

export const useCellOperations = (
  activeCells: CellData[],
  updateCells: (cells: CellData[] | ((prev: CellData[]) => CellData[])) => void
): UseCellOperationsReturn => {
  const [activeCellId, setActiveCellId] = useState<string | null>(null);

  const handleAddCellFromAI = useCallback((content: string, type: 'code' | 'markdown') => {
    const newCell: CellData = {
      id: crypto.randomUUID(),
      type,
      content,
      status: 'idle',
    };
    // Use functional update to always get latest cells state
    updateCells(prev => [...prev, newCell]);
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

