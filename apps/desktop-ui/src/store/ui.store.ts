import { create } from 'zustand';

export type KernelStatus = 'disconnected' | 'connecting' | 'idle' | 'busy' | 'error';

export interface KernelProcessMetrics {
  pid: number | null;
  memoryMb: number | null;
  cpuPercent: number | null;
  diskMb: number | null;
  gpuMemoryMb: number | null;
  systemMemoryUsedMb: number | null;
  systemMemoryTotalMb: number | null;
}

export type RuntimeType = 'cpu' | 'gpu';

export interface MetricsSnapshot {
  timestamp: number;
  cpu: number | null;
  memoryMb: number | null;
  diskMb: number | null;
  gpuMemoryMb: number | null;
  systemMemoryUsedMb: number | null;
  systemMemoryTotalMb: number | null;
}

interface UIState {
  // Layout
  sidebarOpen: boolean;
  chatOpen: boolean;
  resourcePanelOpen: boolean;

  // Chat state
  chatInput: string;
  chatAttachments: any[];

  // Kernel connection
  kernelStatus: KernelStatus;
  runtimeType: RuntimeType;
  kernelId: string | null;
  executionCount: number;

  // Kernel process metrics
  kernelMetrics: KernelProcessMetrics;
  metricsHistory: MetricsSnapshot[];

  // Actions
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleResourcePanel: () => void;
  setChatOpen: (open: boolean) => void;
  setResourcePanelOpen: (open: boolean) => void;
  setChatInput: (content: string) => void;
  setChatAttachments: (attachments: any[]) => void;
  addChatAttachment: (attachment: any) => void;
  clearChatAttachments: () => void;
  setKernelStatus: (status: KernelStatus) => void;
  setRuntimeType: (type: RuntimeType) => void;
  setKernelId: (id: string | null) => void;
  incrementExecution: () => number;
  resetExecution: () => void;
  setKernelMetrics: (metrics: Partial<KernelProcessMetrics>) => void;
  recordMetricSnapshot: (diskMb?: number) => void;
  clearKernelMetrics: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarOpen: true,
  chatOpen: false,
  resourcePanelOpen: false,
  chatInput: '',
  chatAttachments: [],
  kernelStatus: 'disconnected',
  runtimeType: 'cpu',
  kernelId: null,
  executionCount: 0,
  kernelMetrics: {
    pid: null,
    memoryMb: null,
    cpuPercent: null,
    diskMb: null,
    gpuMemoryMb: null,
    systemMemoryUsedMb: null,
    systemMemoryTotalMb: null,
  },
  metricsHistory: [],

  toggleSidebar: () => set(s => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set(s => {
    const opening = !s.chatOpen;
    return { chatOpen: opening, resourcePanelOpen: opening ? false : s.resourcePanelOpen };
  }),
  toggleResourcePanel: () => set(s => {
    const opening = !s.resourcePanelOpen;
    return { resourcePanelOpen: opening, chatOpen: opening ? false : s.chatOpen };
  }),
  setChatOpen: (open) => set(s => ({ chatOpen: open, resourcePanelOpen: open ? false : s.resourcePanelOpen })),
  setResourcePanelOpen: (open) => set(s => ({ resourcePanelOpen: open, chatOpen: open ? false : s.chatOpen })),
  setChatInput: (chatInput) => set({ chatInput }),
  setChatAttachments: (chatAttachments) => set({ chatAttachments }),
  addChatAttachment: (attachment) => set(s => ({
    chatAttachments: s.chatAttachments.some(a => a.id === attachment.id)
      ? s.chatAttachments
      : [...s.chatAttachments, attachment]
  })),
  clearChatAttachments: () => set({ chatAttachments: [] }),
  setKernelStatus: (kernelStatus) => set({ kernelStatus }),
  setRuntimeType: (runtimeType) => set({ runtimeType }),
  setKernelId: (id: string | null) => set({ kernelId: id }),
  incrementExecution: () => {
    const next = get().executionCount + 1;
    set({ executionCount: next });
    return next;
  },
  resetExecution: () => set({ executionCount: 0 }),
  setKernelMetrics: (metrics) => set(s => ({
    kernelMetrics: { ...s.kernelMetrics, ...metrics }
  })),
  recordMetricSnapshot: (diskMb) => set(s => {
    const newSnapshot: MetricsSnapshot = {
      timestamp: Date.now(),
      cpu: s.kernelMetrics.cpuPercent,
      memoryMb: s.kernelMetrics.memoryMb,
      diskMb: s.kernelMetrics.diskMb ?? diskMb ?? null,
      gpuMemoryMb: s.kernelMetrics.gpuMemoryMb,
      systemMemoryUsedMb: s.kernelMetrics.systemMemoryUsedMb,
      systemMemoryTotalMb: s.kernelMetrics.systemMemoryTotalMb,
    };
    const history = [...s.metricsHistory, newSnapshot].slice(-30); // Keep last 30 points
    return { metricsHistory: history };
  }),
  clearKernelMetrics: () => set({
    kernelMetrics: { pid: null, memoryMb: null, cpuPercent: null, diskMb: null, gpuMemoryMb: null, systemMemoryUsedMb: null, systemMemoryTotalMb: null },
    metricsHistory: [],
  }),
}));

