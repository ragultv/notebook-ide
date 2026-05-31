import React, { useState, useRef, useEffect } from 'react';
import {
  Zap, Sparkles, Power, RotateCcw, Save, PlayCircle, Map,
  ChevronDown, FolderOpen, SaveAll, FileCode2, NotebookPen, Cpu, Check,
  ChevronUp, Activity,
} from 'lucide-react';
import { useUIStore, KernelStatus, RuntimeType } from '../../store/ui.store';
import { Tab } from '../../types';
import { TabBar } from '../TabBar';
import { controllerClient } from '../../services/controller.client';
import { useCenterDialog } from '../shared/CenterDialog';
import octopodLogo from '../../octopod1.png';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TopBarProps {
  onToggleChat: () => void;
  isChatOpen: boolean;
  notebookName: string;
  onNewNotebook: (name?: string, cells?: any[], path?: string) => void;
  onOpenFile?: () => void;
  onSaveFile?: () => Promise<void>;
  onConnectKernel?: (runtime: RuntimeType) => void;
  onRestartKernel?: () => void;
  onRunAll?: () => void;
  onOpenMemoryMap?: () => void;
  tabs: Tab[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onOpenFolder?: (path: string) => void;
  onSaveAll?: () => Promise<void>;
}

const statusColors: Record<KernelStatus, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-sim-red animate-pulse',
  idle: 'bg-green-500',
  busy: 'bg-sim-red animate-pulse',
  error: 'bg-red-600',
};

// ── Small shared components ───────────────────────────────────────────────────

const TopBarButton: React.FC<{
  onClick?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  disabled?: boolean;
  isActive?: boolean;
}> = ({ onClick, icon: Icon, title, disabled, isActive }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`w-9 h-9 flex items-center justify-center rounded-md transition-all duration-200
      ${isActive
        ? 'bg-sim-red/10 text-sim-red ring-1 ring-sim-red/50'
        : 'text-sim-muted hover:text-white hover:bg-[#27272a]'}
      ${disabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent' : ''}`}
  >
    <Icon className="w-4 h-4" />
  </button>
);

const Divider = () => <div className="h-4 w-[1px] bg-[#27272a] mx-1" />;

// ── Notebook Resource Bar (center) ───────────────────────────────────────────

const MiniSparkline: React.FC<{
  data: (number | null)[];
  color: string;
  label: string;
  value: string;
  unit?: string;
}> = ({ data, color, label, value }) => {
  const points = data.filter((v): v is number => v !== null);
  const padded = points.length < 2 ? [...Array(10).fill(0), ...points] : points;
  const max = Math.max(...padded, 1);
  const w = 56;
  const h = 20;
  const step = w / (padded.length - 1);
  const svgPoints = padded.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');

  return (
    <div className="flex flex-col items-start gap-0.5 min-w-[72px]">
      <div className="flex items-center justify-between w-full">
        <span className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">{label}</span>
        <span className="text-[9px] font-mono" style={{ color }}>{value}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="overflow-visible">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={svgPoints}
          style={{ opacity: points.length < 2 ? 0.2 : 0.85 }}
        />
        {/* glow dot at end */}
        {points.length > 0 && (
          <circle
            cx={((padded.length - 1) * step).toFixed(1)}
            cy={(h - (padded[padded.length - 1] / max) * h).toFixed(1)}
            r="1.8"
            fill={color}
          />
        )}
      </svg>
    </div>
  );
};

const NotebookResourceBar: React.FC = () => {
  const { kernelStatus, kernelMetrics, metricsHistory, runtimeType } = useUIStore();
  const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';

  const ramHistory = metricsHistory.map(s => s.systemMemoryUsedMb ?? s.memoryMb);
  const cpuHistory = metricsHistory.map(s => s.cpu);
  const diskHistory = metricsHistory.map(s => s.diskMb);
  const gpuHistory = metricsHistory.map(s => s.gpuMemoryMb);

  const ramMb = kernelMetrics.systemMemoryUsedMb ?? kernelMetrics.memoryMb;
  const cpuPct = kernelMetrics.cpuPercent;
  const diskMb = kernelMetrics.diskMb;
  const gpuMb = kernelMetrics.gpuMemoryMb;

  const fmtRam = ramMb === null ? '--' : ramMb < 1024 ? `${ramMb.toFixed(0)}M` : `${(ramMb / 1024).toFixed(1)}G`;
  const fmtCpu = cpuPct === null ? '--' : `${cpuPct.toFixed(0)}%`;
  const fmtDisk = diskMb === null ? '--' : diskMb < 1024 ? `${diskMb.toFixed(0)}M` : `${(diskMb / 1024).toFixed(1)}G`;
  const fmtGpu = gpuMb === null ? '--' : gpuMb < 1024 ? `${gpuMb.toFixed(0)}M` : `${(gpuMb / 1024).toFixed(1)}G`;

  if (!isConnected) {
    return (
      <div className="flex items-center gap-2 text-[10px] font-mono text-gray-700">
        <Activity className="w-3.5 h-3.5" />
        <span>Connect a runtime to see notebook usage</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-5 px-2">
      <MiniSparkline data={ramHistory} color="#f97316" label="RAM" value={fmtRam} />
      <div className="w-[1px] h-6 bg-white/5" />
      <MiniSparkline data={cpuHistory} color="#60a5fa" label="CPU" value={fmtCpu} />
      <div className="w-[1px] h-6 bg-white/5" />
      <MiniSparkline data={diskHistory} color="#34d399" label="DISK" value={fmtDisk} />
      {runtimeType === 'gpu' && (
        <>
          <div className="w-[1px] h-6 bg-white/5" />
          <MiniSparkline data={gpuHistory} color="#a78bfa" label="GPU" value={fmtGpu} />
        </>
      )}
    </div>
  );
};


// ── Runtime Menu (right side of topbar) ───────────────────────────────────────

const RuntimeMenu: React.FC<{ onConnect: (type: RuntimeType) => void }> = ({ onConnect }) => {
  const [open, setOpen] = useState(false);
  const { runtimeType, kernelStatus, toggleResourcePanel, resourcePanelOpen } = useUIStore();
  const menuRef = useRef<HTMLDivElement>(null);

  const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';
  const isConnecting = kernelStatus === 'connecting';

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isConnected) {
    return (
      <div className="flex items-center gap-2">
        {/* Status pill */}
        <div className="flex items-center gap-2 px-3 h-8 bg-[#1e1e20] border border-[#27272a] rounded-xl text-[10px] font-mono text-gray-400">
          <Check className="w-3 h-3 text-green-500" />
          <div className={`w-1.5 h-1.5 rounded-full ${statusColors[kernelStatus]}`} />
          <span className="uppercase">{runtimeType} · {kernelStatus}</span>
        </div>
        {/* Resource Panel toggle */}
        <button
          onClick={toggleResourcePanel}
          title="Resource Monitor"
          className={`flex items-center gap-1.5 px-3 h-8 rounded-xl border text-[10px] font-mono transition-all duration-200
            ${resourcePanelOpen
              ? 'bg-[#27272a] border-white/20 text-white'
              : 'bg-[#1e1e20] border-[#27272a] text-gray-500 hover:text-white hover:border-[#3a3a3c]'}`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Monitor</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={isConnecting}
        className={`flex items-center gap-2 px-4 h-8 rounded-xl text-xs font-medium transition-all duration-200 border
          ${isConnecting
            ? 'bg-sim-red/10 border-sim-red/20 text-sim-red animate-pulse'
            : 'bg-sim-red/10 border-sim-red/20 text-sim-red hover:bg-sim-red/20'}`}
      >
        <Power className="w-3.5 h-3.5" />
        <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[160px]
            bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl shadow-black/60
            overflow-hidden py-1.5"
          style={{ animation: 'dropdownIn 0.12s ease-out' }}
        >
          <div className="px-3 pb-1.5 mb-1.5 border-b border-[#27272a]">
            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">Select Runtime</span>
          </div>

          {(['cpu', 'gpu'] as const).map((type) => {
            const isGpu = type === 'gpu';
            return (
              <button
                key={type}
                onClick={() => {
                  if (!isGpu) {
                    onConnect(type);
                    setOpen(false);
                  }
                }}
                disabled={isGpu}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-xs transition-colors rounded-lg text-left mb-1
                  ${isGpu ? 'opacity-50 cursor-not-allowed text-gray-400' : 'hover:bg-white/5 text-gray-300'}
                  ${runtimeType === type && !isGpu ? 'text-sim-red bg-sim-red/5' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 flex items-center justify-center">
                    {runtimeType === type && !isGpu && <Check className="w-3.5 h-3.5" />}
                  </div>
                  <Cpu className={`w-3.5 h-3.5 ${runtimeType === type && !isGpu ? 'text-sim-red' : 'text-gray-500'}`} />
                  <div className="flex flex-col">
                    <span className="font-semibold">{type.toUpperCase()} Runtime</span>
                  </div>
                </div>
                {isGpu && (
                  <span className="text-[9px] bg-[#3a3a3c] text-gray-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-widest">
                    Coming Soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── File Dropdown ─────────────────────────────────────────────────────────────

interface FileMenuProps {
  onOpenNotebook?: () => void;
  onOpenFolder?: (path: string) => void;
  onNewNotebook?: (name?: string, cells?: any[], path?: string) => void;
  onSave?: () => Promise<void>;
  onSaveAll?: () => Promise<void>;
}

const FileMenu: React.FC<FileMenuProps> = ({
  onOpenNotebook, onOpenFolder, onNewNotebook, onSave, onSaveAll,
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { show, Dialog } = useCenterDialog();

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Open Folder ─────────────────────────────────────────────────────────────
  const handleOpenFolder = async () => {
    setOpen(false);

    // In Electron we'll get a real path from the OS dialog.
    // In the browser, show our centered dialog for the absolute path.
    // The `window.__ELECTRON__` flag will be set by the Electron preload when packaged.
    const isElectron = typeof window !== 'undefined' && !!(window as any).__ELECTRON__;

    let folderPath: string | null = null;

    if (isElectron) {
      // Electron path: invoke IPC (preload must expose this)
      try {
        folderPath = await (window as any).electronAPI?.selectFolder?.() ?? null;
      } catch {
        // fall through to dialog
      }
    }

    if (!folderPath) {
      const field = { id: 'path', label: 'Absolute Folder Path', placeholder: 'C:\\Projects\\Notebooks' };
      const result = await show({
        title: 'Open Folder',
        description: 'Provide the full path to a local directory to open as a project workspace.',
        fields: [field],
        confirmLabel: 'Open Project',
      });
      folderPath = result?.path || null;
    }

    if (folderPath) {
      onOpenFolder?.(folderPath);
    }
  };

  // ── New Notebook ─────────────────────────────────────────────────────────────
  const handleNewNotebook = async () => {
    setOpen(false);

    // Get current project path from backend so we know where to create the file
    let basePath = '';
    try {
      const { project } = await controllerClient.getCurrentProject();
      if (project?.path) basePath = project.path;
    } catch { /* no project open — in-memory notebook is fine */ }

    if (!basePath) {
      // No project open → just create an in-memory notebook
      onNewNotebook?.();
      return;
    }

    const result = await show({
      title: 'New Notebook',
      description: `Will be created inside: ${basePath}`,
      fields: [{
        id: 'name',
        label: 'Notebook name',
        placeholder: 'my_analysis',
        defaultValue: 'Untitled',
      }],
      confirmLabel: 'Create',
    });

    const rawName = result?.name?.trim();
    if (!rawName) return;

    const fileName = rawName.endsWith('.ipynb') ? rawName : `${rawName}.ipynb`;
    const sep = basePath.includes('/') ? '/' : '\\';
    const filePath = `${basePath}${sep}${fileName}`;

    const starterContent = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
      cells: [{
        cell_type: 'code', id: 'init', metadata: {},
        source: ['# New notebook\n'],
        execution_count: null, outputs: [],
      }],
    };

    try {
      await controllerClient.saveNotebook(filePath, starterContent);
      const uiCells = starterContent.cells.map(c => ({
        id: crypto.randomUUID(),
        type: c.cell_type as 'code' | 'markdown',
        content: c.source.join(''),
        status: 'idle' as const
      }));
      onNewNotebook?.(fileName, uiCells, filePath);
    } catch (e: any) {
      await show({ title: 'Failed to create notebook', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  const items = [
    {
      icon: NotebookPen,
      label: 'Open Notebook',
      kbd: 'Ctrl+O',
      color: '',
      onClick: () => { setOpen(false); onOpenNotebook?.(); },
    },
    {
      icon: FolderOpen,
      label: 'Open Folder',
      kbd: 'Ctrl+Shift+O',
      color: '',
      separator: true,
      onClick: handleOpenFolder,
    },
    {
      icon: FileCode2,
      label: 'New Notebook',
      kbd: 'Ctrl+N',
      color: 'text-sim-red',
      separator: true,
      onClick: handleNewNotebook,
    },
    {
      icon: Save,
      label: 'Save',
      kbd: 'Ctrl+S',
      color: '',
      separator: true,
      onClick: () => { setOpen(false); onSave?.(); },
    },
    {
      icon: SaveAll,
      label: 'Save All',
      kbd: 'Ctrl+Shift+S',
      color: 'text-green-400',
      onClick: () => { setOpen(false); onSaveAll?.(); },
    },
  ];

  return (
    <>
      {/* Render dialog at portal-level so it's always on top */}
      {Dialog}

      <div ref={menuRef} className="relative">
        {/* Trigger */}
        <button
          onClick={() => setOpen(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium transition-all duration-150 select-none
            ${open
              ? 'bg-[#27272a] text-white ring-1 ring-white/10'
              : 'text-sim-muted hover:text-white hover:bg-[#27272a]'}`}
          title="File Menu"
        >
          <FileCode2 className="w-4 h-4" />
          <span className="hidden sm:inline">File</span>
          <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {open && (
          <div
            className="absolute left-0 top-[calc(100%+6px)] z-50 min-w-[220px]
              bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl shadow-black/60
              overflow-hidden py-1"
            style={{ animation: 'dropdownIn 0.12s ease-out' }}
          >
            {items.map((item, idx) => (
              <React.Fragment key={idx}>
                {item.separator && <div className="my-1 border-t border-[#27272a]" />}
                <button
                  onClick={item.onClick}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm
                    transition-colors duration-100 hover:bg-white/5 text-left group
                    ${item.color || 'text-gray-300'}`}
                >
                  <item.icon className={`w-4 h-4 shrink-0 ${item.color || 'text-gray-500 group-hover:text-gray-300'}`} />
                  <span className="flex-1">{item.label}</span>
                  {item.kbd && (
                    <span className="text-[10px] text-gray-600 font-mono whitespace-nowrap">{item.kbd}</span>
                  )}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

// ── TopBar ─────────────────────────────────────────────────────────────────────

export const TopBar: React.FC<TopBarProps> = ({
  onToggleChat,
  isChatOpen,
  notebookName,
  onNewNotebook,
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
  onOpenFolder,
  onSaveAll,
}) => {
  const { kernelStatus } = useUIStore();
  const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';


  return (
    <div className="h-12 bg-[#09090b] border-b border-[#27272a] flex items-center justify-between px-3 z-20 relative select-none shadow-sm">

      {/* Left: Branding + File menu + RunAll */}
      <div className="flex items-center gap-2">
        {/* Branding */}
        <div className="flex items-center gap-2 mr-3 px-2">
          <img src={octopodLogo} alt="Octopod Logo" className="w-5 h-5 object-contain" />
          <div className="font-mono font-bold tracking-wider text-base">
            <span className="text-white">OctoML</span>
          </div>
        </div>

        <FileMenu
          onOpenNotebook={onOpenFile}
          onOpenFolder={onOpenFolder}
          onNewNotebook={onNewNotebook}
          onSave={onSaveFile}
          onSaveAll={onSaveAll ?? onSaveFile}
        />

        <Divider />

        <TopBarButton
          onClick={onRunAll}
          icon={PlayCircle}
          title="Run All Cells"
          disabled={kernelStatus !== 'idle'}
          isActive={kernelStatus === 'busy'}
        />
      </div>

      {/* Center: TabBar (file tabs) */}
      <div className="flex-1 mx-4 hidden md:flex items-center h-8 bg-[#1e1e20] border border-white/5 rounded-xl px-1 overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivateTab={onActivateTab}
          onCloseTab={onCloseTab}
        />
      </div>

      {/* Right: Kernel + Tools */}
      <div className="flex items-center gap-2">

        <RuntimeMenu onConnect={(type) => onConnectKernel?.(type)} />

        <TopBarButton
          onClick={onRestartKernel}
          icon={RotateCcw}
          title="Restart Kernel"
          disabled={!isConnected}
        />

        <Divider />

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
