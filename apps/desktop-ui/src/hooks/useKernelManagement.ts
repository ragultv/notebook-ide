import { useState, useEffect, useCallback } from 'react';
import { controllerClient } from '../services/controller.client';
import { useUIStore } from '../store/ui.store';
import { CellData } from '../types';

interface UseKernelManagementReturn {
  handleConnectKernel: () => Promise<void>;
  handleRestartKernel: () => Promise<void>;
  handleRunAll: (cells: CellData[], updateCells: (cells: CellData[]) => void) => Promise<void>;
}

export const useKernelManagement = (activeFileId: string | null): UseKernelManagementReturn => {
  const { setKernelStatus, setKernelId, setKernelMetrics, clearKernelMetrics } = useUIStore();

  // Kernel metrics polling
  useEffect(() => {
    if (!activeFileId) {
      clearKernelMetrics();
      return;
    }

    const pollMetrics = async () => {
      try {
        const metrics = await controllerClient.getKernelMetrics(activeFileId);
        setKernelMetrics(metrics);
      } catch (error) {
        console.error('Failed to fetch kernel metrics:', error);
        clearKernelMetrics();
      }
    };

    pollMetrics();
    const interval = setInterval(pollMetrics, 2000);

    return () => clearInterval(interval);
  }, [activeFileId, setKernelMetrics, clearKernelMetrics]);

  const handleConnectKernel = useCallback(async () => {
    try {
      setKernelStatus('connecting');
      await controllerClient.startKernel();
      setKernelId('default');
      setKernelStatus('idle');
    } catch (error) {
      console.error('Failed to connect kernel:', error);
      setKernelStatus('disconnected');
    }
  }, [setKernelStatus, setKernelId]);

  const handleRestartKernel = useCallback(async () => {
    try {
      setKernelStatus('busy');
      await controllerClient.restartKernel();
      setKernelStatus('idle');
    } catch (error) {
      console.error('Failed to restart kernel:', error);
      setKernelStatus('disconnected');
    }
  }, [setKernelStatus]);

  const handleRunAll = useCallback(async (cells: CellData[], updateCells: (cells: CellData[]) => void) => {
    const codeCells = cells.filter(c => c.type === 'code' && c.content.trim());
    
    if (codeCells.length === 0) return;

    const notebookId = activeFileId || 'default';
    let updatedCells = [...cells];

    for (const cell of codeCells) {
      const cellIndex = updatedCells.findIndex(c => c.id === cell.id);
      if (cellIndex === -1) continue;

      updatedCells[cellIndex] = { ...updatedCells[cellIndex], status: 'running' as const };
      updateCells([...updatedCells]);

      try {
        const result = await controllerClient.runCell({
          cellId: cell.id,
          code: cell.content,
          notebookId,
        });
        
        updatedCells[cellIndex] = {
          ...updatedCells[cellIndex],
          status: result.success ? 'success' as const : 'error' as const,
          output: result.output,
          outputs: result.outputs,
          error: result.error,
          executionCount: result.executionCount,
          duration: result.duration,
        };
        updateCells([...updatedCells]);

        if (!result.success) break;
      } catch (error) {
        updatedCells[cellIndex] = {
          ...updatedCells[cellIndex],
          status: 'error' as const,
          error: (error as Error).message,
        };
        updateCells([...updatedCells]);
        break;
      }
    }
  }, [activeFileId]);

  return {
    handleConnectKernel,
    handleRestartKernel,
    handleRunAll,
  };
};
