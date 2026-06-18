import { useEffect, useCallback } from 'react';
import { controllerClient } from '../services/controller.client';
import { useUIStore, RuntimeType } from '../store/ui.store';
import { CellData } from '../types';

interface UseKernelManagementReturn {
  handleConnectKernel: (runtime: RuntimeType) => Promise<void>;
  handleRestartKernel: () => Promise<void>;
  handleRunAll: (cells: CellData[], updateCells: (cells: CellData[]) => void) => Promise<void>;
}

export const useKernelManagement = (activeFileId: string | null): UseKernelManagementReturn => {
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
    const interval = setInterval(pollMetrics, 3000); // Poll metrics every 3 seconds
    return () => clearInterval(interval);
  }, [activeFileId, setKernelMetrics, clearKernelMetrics, recordMetricSnapshot]);

  const handleConnectKernel = useCallback(async (runtime: RuntimeType) => {
    try {
      setRuntimeType(runtime);
      setKernelStatus('connecting');
      // The backend kernel will use the selected runtime for all subsequent cell runs
      await controllerClient.startKernel();
      setKernelId('default');
      setKernelStatus('idle');
    } catch (error) {
      console.error('Failed to connect kernel:', error);
      setKernelStatus('disconnected');
    }
  }, [setKernelStatus, setKernelId, setRuntimeType]);

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
    // Dispatch custom event to trigger sequential execution inside Notebook's WS Context
    window.dispatchEvent(new CustomEvent('notebook:run-all', {
      detail: { notebookId }
    }));
  }, [activeFileId]);

  return {
    handleConnectKernel,
    handleRestartKernel,
    handleRunAll,
  };
};
