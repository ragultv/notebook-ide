import { useEffect, useCallback, useState } from 'react';
import { controllerClient } from '../services/controller.client';
import { useUIStore, RuntimeType } from '../store/ui.store';
import { CellData } from '../types';

export type KernelLanguage = 'python' | 'mojo';

interface UseKernelManagementReturn {
  handleConnectKernel: (language: KernelLanguage, runtime: RuntimeType, pythonPath?: string) => Promise<void>;
  handleRestartKernel: () => Promise<void>;
  handleRunAll: (cells: CellData[], updateCells: (cells: CellData[]) => void) => Promise<void>;
  pythonVersions: Array<{ path: string; version: string }>;
  selectedPythonPath: string | null;
  setSelectedPythonPath: (path: string) => void;
  kernelLanguage: KernelLanguage;
  setKernelLanguage: (lang: KernelLanguage) => void;
}

export const useKernelManagement = (activeFileId: string | null): UseKernelManagementReturn => {
  const {
    setKernelStatus, setKernelId, setKernelMetrics,
    clearKernelMetrics, setRuntimeType, recordMetricSnapshot, runtimeType,
    kernelLanguage, setKernelLanguage
  } = useUIStore();

  const [pythonVersions, setPythonVersions] = useState<Array<{ path: string; version: string }>>([]);
  const [selectedPythonPath, setSelectedPythonPath] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<KernelLanguage>(kernelLanguage);

  // Keep local notebook language in sync with global store language
  useEffect(() => {
    setSelectedLanguage(kernelLanguage);
  }, [kernelLanguage]);

  // Persist selected language per notebook
  useEffect(() => {
    if (!activeFileId) return;
    const stored = localStorage.getItem(`notebook_language_${activeFileId}`);
    if (stored === 'python' || stored === 'mojo') {
      setSelectedLanguage(stored);
      setKernelLanguage(stored);
    }
  }, [activeFileId, setKernelLanguage]);

  useEffect(() => {
    if (!activeFileId) return;
    localStorage.setItem(`notebook_language_${activeFileId}`, selectedLanguage);
    setKernelLanguage(selectedLanguage);
  }, [activeFileId, selectedLanguage, setKernelLanguage]);

  // Persist selected python per notebook (so reopening uses same venv)
  useEffect(() => {
    if (!activeFileId) return;
    const stored = localStorage.getItem(`notebook_python_${activeFileId}`);
    if (stored) {
      setSelectedPythonPath(stored);
    }
  }, [activeFileId]);

  useEffect(() => {
    if (!activeFileId || !selectedPythonPath) return;
    localStorage.setItem(`notebook_python_${activeFileId}`, selectedPythonPath);
  }, [activeFileId, selectedPythonPath]);

  // Derive the compute device from the selected runtime
  // GPU runtime → CUDA (cells run on VRAM), CPU runtime → CPU (cells run on RAM)
  const device = runtimeType === 'gpu' ? 'cuda' : 'cpu';

  // Fetch available Python interpreters (for kernel selection)
  useEffect(() => {
    const fetchPythonVersions = async () => {
      try {
        const resp = await controllerClient.getPythonVersions();
        const versions = (resp as any).versions as Array<{ path: string; version: string }>;
        setPythonVersions(versions);
        if (versions.length > 0) {
          setSelectedPythonPath(prev => prev || versions[0].path);
        }
      } catch (e) {
        console.warn('Failed to load python versions', e);
      }
    };

    fetchPythonVersions();
  }, []);

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

  const handleConnectKernel = useCallback(async (language: KernelLanguage, runtime: RuntimeType, pythonPath?: string) => {
    try {
      // Save selected language and runtime
      setKernelLanguage(language);
      setRuntimeType(runtime);

      setKernelStatus('connecting');

      if (language === 'mojo') {
        // Start the mojo container for this notebook
        // In browser builds, process.cwd() isn't available. Let the backend choose a default.
        await controllerClient.startMojo(activeFileId || 'default');
      } else {
        // Python kernel
        await controllerClient.startKernel(pythonPath);
      }

      setKernelId('default');
      setKernelStatus('idle');
    } catch (error) {
      console.error('Failed to connect kernel:', error);
      setKernelStatus('disconnected');
    }
  }, [setKernelStatus, setKernelId, setKernelLanguage, setRuntimeType, activeFileId]);

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
        let result;
        if (selectedLanguage === 'mojo') {
          result = await controllerClient.runMojoCell(notebookId, cell.content);
        } else {
          result = await controllerClient.runCell({
            cellId: cell.id,
            code: cell.content,
            notebookId,
            device,  // ← 'cpu' or 'cuda' — routes execution to RAM or VRAM
          });
        }

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
    pythonVersions,
    selectedPythonPath,
    setSelectedPythonPath,
    kernelLanguage,
    setKernelLanguage,
  };
};
