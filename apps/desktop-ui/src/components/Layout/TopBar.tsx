import React from 'react';
import { Zap, Sparkles, Power, RotateCcw, FolderOpen, Save, PlayCircle, Cpu, HardDrive, Map, FilePlus } from 'lucide-react';
import { useUIStore, KernelStatus } from '../../store/ui.store';
import { Tab } from '../../types';
import { TabBar } from '../TabBar';

interface TopBarProps {
  onToggleChat: () => void;
  isChatOpen: boolean;
  notebookName: string;
  onNewNotebook: () => void;
  onOpenFile?: () => void;
  onSaveFile?: () => void;
  onConnectKernel?: () => void;
  onRestartKernel?: () => void;
  onRunAll?: () => void;
  onOpenMemoryMap?: () => void;
  tabs: Tab[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
}

const statusColors: Record<KernelStatus, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-sim-red animate-pulse',
  idle: 'bg-green-500',
  busy: 'bg-sim-red animate-pulse',
  error: 'bg-red-600',
};

const TopBarButton: React.FC<{ onClick?: () => void; icon: any; title: string; disabled?: boolean; isActive?: boolean; color?: string }> = ({ onClick, icon: Icon, title, disabled, isActive, color }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`w-9 h-9 flex items-center justify-center rounded-md transition-all duration-200
      ${isActive ? 'bg-sim-red/10 text-sim-red ring-1 ring-sim-red/50' : 'text-sim-muted hover:text-white hover:bg-[#27272a]'}
      ${disabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent' : ''}
      ${color ? color : ''}
    `}
  >
    <Icon className="w-4 h-4" />
  </button>
);

const Divider = () => <div className="h-4 w-[1px] bg-[#27272a] mx-1" />;

export const TopBar: React.FC<TopBarProps> = ({
  onToggleChat,
  isChatOpen,
  notebookName,
  onNewNotebook, // Potentially unused
  onOpenFile,
  onSaveFile,
  onConnectKernel,
  onRestartKernel,
  onRunAll,
  onOpenMemoryMap,
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
}) => {
  const { kernelStatus, kernelMetrics } = useUIStore();
  const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';

  // Format memory display
  const formatMemory = (mb: number | null) => {
    if (mb === null) return '--';
    if (mb < 1024) return `${mb.toFixed(0)}MB`;
    return `${(mb / 1024).toFixed(1)}GB`;
  };

  // Format CPU display
  const formatCpu = (percent: number | null) => {
    if (percent === null) return '--';
    return `${percent.toFixed(0)}%`;
  };

  return (
    <div className="h-12 bg-[#09090b] border-b border-[#27272a] flex items-center justify-between px-3 z-20 relative select-none shadow-sm">

      {/* Left: Branding & Core File Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 mr-4 px-2">
          <Zap className="w-4 h-4 text-sim-red fill-current" />
          <div className="font-mono font-bold tracking-wider text-base">
            <span className="text-white">OPREL</span>
          </div>
        </div>

        {/* File Group */}
        <TopBarButton onClick={onOpenFile} icon={FolderOpen} title="Open File" />
        <TopBarButton onClick={onSaveFile} icon={Save} title="Save File" />

        <Divider />

        {/* Run Group */}
        <TopBarButton
          onClick={onRunAll}
          icon={PlayCircle}
          title="Run All Cells"
          disabled={kernelStatus !== 'idle'}
          isActive={kernelStatus === 'busy'}
        />

      </div>

      {/* Center: Tabs Container (Flexible) */}
      <div className="flex-1 mx-4 hidden md:flex items-center h-8 bg-[#1e1e20] border border-white/5 rounded-xl px-1 overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
        />
      </div>

      {/* Right: Tools & Metrics */}
      <div className="flex items-center gap-2">

        {/* Kernel Controls */}
        {!isConnected ? (
          <button
            onClick={onConnectKernel}
            className="flex items-center gap-2 px-3 h-8 bg-sim-red/10 hover:bg-sim-red/20 text-sim-red border border-sim-red/20 rounded-xl text-xs font-medium transition-all mr-2"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Connect</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 mr-2">
            {/* Metrics (Only visible on large screens) */}
            {kernelMetrics.pid && (
              <div className="hidden lg:flex items-center gap-3 px-3 py-1 rounded bg-[#1e1e20] border border-[#27272a] text-[10px] font-mono text-gray-500">
                <span>PID: {kernelMetrics.pid}</span>
                {kernelMetrics.memoryMb && <span>MEM: {formatMemory(kernelMetrics.memoryMb)}</span>}
                {kernelMetrics.cpuPercent && <span>CPU: {formatCpu(kernelMetrics.cpuPercent)}</span>}
              </div>
            )}

            {/* Status Pill */}
            <div className="flex items-center gap-2 px-2.5 h-8 bg-[#1e1e20] border border-[#27272a] rounded text-[10px] font-mono text-gray-400">
              <div className={`w-1.5 h-1.5 rounded-full ${statusColors[kernelStatus]}`} />
              <span className="uppercase">{kernelStatus}</span>
            </div>
          </div>
        )}

        <TopBarButton
          onClick={onRestartKernel}
          icon={RotateCcw}
          title="Restart Kernel"
          disabled={!isConnected}
        />

        <Divider />

        {/* Tools */}
        {onOpenMemoryMap && (
          <TopBarButton onClick={onOpenMemoryMap} icon={Map} title="Memory Visualization" />
        )}

        <TopBarButton
          onClick={onToggleChat}
          icon={Sparkles}
          title="AI Assistant"
          isActive={isChatOpen}
        />
      </div>
    </div>
  );
};
