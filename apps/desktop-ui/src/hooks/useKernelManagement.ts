import { useEffect, useCallback } from 'react';
import { controllerClient } from '../services/controller.client';
import { useUIStore, RuntimeType } from '../store/ui.store';
import { CellData, ProjectFile } from '../types';

interface UseKernelManagementReturn {
  handleConnectKernel: (runtime: RuntimeType) => Promise<void>;
  handleRestartKernel: () => Promise<void>;
  handleRunAll: (cells: CellData[], updateCells: (cells: CellData[]) => void) => Promise<void>;
}

export const useKernelManagement = (activeFileId: string | null, activeFile?: ProjectFile): UseKernelManagementReturn => {
  const {
    setKernelStatus, setKernelId, setKernelMetrics,
    clearKernelMetrics, setRuntimeType, recordMetricSnapshot, runtimeType
  } = useUIStore();

  // Derive the compute device from the selected runtime
  // GPU runtime → CUDA (cells run on VRAM), CPU runtime → CPU (cells run on RAM)
  const device = runtimeType === 'gpu' ? 'cuda' : 'cpu';

  // Metrics polling - records notebook kernel process metrics only (not app-wide)
  useEffect(() => {
    const pollMetrics = async () => {
      try {
        const rawMetrics: any = await controllerClient.getKernelMetrics(activeFileId || 'default');

        console.log('[useKernelManagement] Realtime Metrics:', rawMetrics);

        if (rawMetrics.available || rawMetrics.status === 'running') {
          setKernelMetrics({
            pid: rawMetrics.pid,
            memoryMb: rawMetrics.memory_mb, // process memory
            cpuPercent: rawMetrics.cpu_percent,
            diskMb: rawMetrics.disk_mb,
            gpuMemoryMb: rawMetrics.gpu_memory_mb,
            systemMemoryUsedMb: rawMetrics.system_memory_used_mb,
            systemMemoryTotalMb: rawMetrics.system_memory_total_mb
          });
          // Ensure we don't pass undefined for diskMb if it's not present
          recordMetricSnapshot(rawMetrics.disk_mb ?? undefined);
        } else {
          clearKernelMetrics();
        }
      } catch {
        // Silently ignore — kernel may not be running yet
        clearKernelMetrics();
      }
    };

    pollMetrics();
    const interval = setInterval(pollMetrics, 1000);
    return () => clearInterval(interval);
  }, [activeFileId, setKernelMetrics, clearKernelMetrics, recordMetricSnapshot]);

  const handleConnectKernel = useCallback(async (runtime: RuntimeType) => {
    try {
      setRuntimeType(runtime);
      setKernelStatus('connecting');
      const language = activeFile?.language || 'python';
      await controllerClient.startKernel(activeFileId || undefined, language);
      setKernelId('default');
      setKernelStatus('idle');
    } catch (error) {
      console.error('Failed to connect kernel:', error);
      setKernelStatus('disconnected');
    }
  }, [setKernelStatus, setKernelId, setRuntimeType, activeFileId, activeFile]);

  const handleRestartKernel = useCallback(async () => {
    try {
      setKernelStatus('busy');
      const language = activeFile?.language || 'python';
      await controllerClient.restartKernel(activeFileId || undefined, language);
      setKernelStatus('idle');
    } catch (error) {
      console.error('Failed to restart kernel:', error);
      setKernelStatus('disconnected');
    }
  }, [setKernelStatus, activeFileId, activeFile]);

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
          device,  // ← 'cpu' or 'cuda' — routes execution to RAM or VRAM
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
  }, [activeFileId, device]);

  return {
    handleConnectKernel,
    handleRestartKernel,
    handleRunAll,
  };
};
