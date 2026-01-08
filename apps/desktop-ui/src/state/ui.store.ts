import { create } from 'zustand';

export type KernelStatus = 'disconnected' | 'connecting' | 'idle' | 'busy' | 'error';

export interface KernelProcessMetrics {
  pid: number | null;
  memoryMb: number | null;
  cpuPercent: number | null;
}

interface UIState {
  // Layout
  sidebarOpen: boolean;
  chatOpen: boolean;

  // Kernel connection
  kernelStatus: KernelStatus;
  kernelId: string | null;
  executionCount: number;

  // Kernel process metrics
  kernelMetrics: KernelProcessMetrics;

  // Actions
  toggleSidebar: () => void;
  toggleChat: () => void;
  setKernelStatus: (status: KernelStatus) => void;
  setKernelId: (id: string | null) => void;
  incrementExecution: () => number;
  resetExecution: () => void;
  setKernelMetrics: (metrics: Partial<KernelProcessMetrics>) => void;
  clearKernelMetrics: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  chatOpen: false,
  kernelStatus: 'disconnected',
  kernelId: null,
  executionCount: 0,
  kernelMetrics: {
    pid: null,
    memoryMb: null,
    cpuPercent: null,
  },

  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set(s => ({ chatOpen: !s.chatOpen })),
  setKernelStatus: (status) => set({ kernelStatus: status }),
  setKernelId: (id) => set({ kernelId: id }),
  incrementExecution: () => {
    const next = get().executionCount + 1;
    set({ executionCount: next });
    return next;
  },
  resetExecution: () => set({ executionCount: 0 }),
  setKernelMetrics: (metrics) => set(s => ({
    kernelMetrics: { ...s.kernelMetrics, ...metrics }
  })),
  clearKernelMetrics: () => set({
    kernelMetrics: { pid: null, memoryMb: null, cpuPercent: null }
  }),
}));

