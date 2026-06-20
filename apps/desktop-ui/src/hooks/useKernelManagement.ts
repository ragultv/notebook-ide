import { useEffect, useCallback } from 'react';
import { controllerClient } from '../services/controller.client';
import { useUIStore, RuntimeType } from '../store/ui.store';
import { CellData } from '../types';

interface UseKernelManagementReturn {
  handleConnectKernel: (runtime: RuntimeType) => Promise<void>;
  handleRestartKernel: () => Promise<void>;
  handleRunAll: (cells: CellData[]) => void;
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

  /**
   * Run All via WS 'run_all' message — single execution path.
   * VS Code equivalent: INotebookExecutionService.executeNotebookCells()
   *   → one unified path through NotebookExecutionService → KernelProxy → kernel
   *
   * This replaces the old window.dispatchEvent approach which created two
   * competing execution paths and race conditions.
   */
  const handleRunAll = useCallback((cells: CellData[]) => {
    const codeCells = cells.filter(c => c.type === 'code' && c.content.trim());
    if (codeCells.length === 0) return;

    const notebookId = activeFileId || 'default';

    // Send run_all message — handled by websocket.ts → ExecutionEngine.runCellsExplicit()
    // This is the canonical execution path (mirrors VS Code's single execution service)
    const ws = (window as any).__notebookWS?.[notebookId];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'run_all',
        notebook_id: notebookId,
        cells: codeCells.map(c => ({ cell_id: c.id, code: c.content })),
      }));
    } else {
      // Fallback: dispatch event for Notebook's WS context to handle
      window.dispatchEvent(new CustomEvent('notebook:run-all', {
        detail: { notebookId }
      }));
    }
  }, [activeFileId]);

  return {
    handleConnectKernel,
    handleRestartKernel,
    handleRunAll,
  };
};
