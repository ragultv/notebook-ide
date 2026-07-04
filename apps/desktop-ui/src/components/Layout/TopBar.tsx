import React, { useState, useRef, useEffect } from 'react';
import {
  Zap, Sparkles, Power, RotateCcw, Save, PlayCircle,
  ChevronDown, FolderOpen, SaveAll, FileCode2, NotebookPen, Cpu, Check,
  ChevronUp, Activity, LogOut, Minus, Square, X
} from 'lucide-react';
import { useUIStore } from '../../store/ui.store';
import { controllerClient } from '../../services/controller.client';
import { useCenterDialog } from '../shared/CenterDialog';
import { useProject } from '../../context/ProjectContext';
import octomlLogo from '../../icon.png';
import { Tab } from '../../types';
import { getFileIcon } from '../shared/FileIcons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TopBarProps {
  onToggleChat: () => void;
  isChatOpen: boolean;
  notebookName: string;
  activeTab?: Tab;
  onNewNotebook: (name?: string, cells?: any[], path?: string) => void;
  onOpenFile?: () => void;
  onSaveFile?: () => Promise<void>;
  onOpenFolder?: (path: string) => void;
  onSaveAll?: () => Promise<void>;
}

const isElectron = typeof window !== 'undefined' && !!(window as any).octoml;

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
        ? 'bg-sim-selection text-sim-red border border-sim-red'
        : 'text-sim-muted hover:text-sim-text hover:bg-sim-border'}
      ${disabled ? 'opacity-30 cursor-not-allowed hover:bg-transparent' : ''}`}
  >
    <Icon className="w-4 h-4" />
  </button>
);

const Divider = () => <div className="h-4 w-[1px] bg-sim-border mx-1" />;

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
    // The `window.octoml` object will be set by the Electron preload when packaged.
    const isElectron = typeof window !== 'undefined' && !!(window as any).octoml;

    let folderPath: string | null = null;

    if (isElectron) {
      // Electron path: invoke IPC (preload must expose this)
      try {
        folderPath = await (window as any).octoml?.showFolderDialog?.() ?? null;
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

    // Check if a project is open — if not, create an in-memory notebook
    let projectOpen = false;
    try {
      const { project } = await controllerClient.getProject();
      projectOpen = !!project?.path;
    } catch { /* no project open */ }

    if (!projectOpen) {
      // No project open → just create an in-memory notebook
      onNewNotebook?.();
      return;
    }

    const result = await show({
      title: 'New Notebook',
      description: 'Will be saved in the notebooks/ folder of your project.',
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
    // Always use a VIRTUAL path — the backend resolves it to disk.
    // /notebooks/ maps to PROJECT_ROOT/notebooks/ via VirtualFS.
    const virtualPath = `/notebooks/${fileName}`;

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
      await controllerClient.saveFile(virtualPath, JSON.stringify(starterContent, null, 2));
      const uiCells = starterContent.cells.map(c => ({
        id: crypto.randomUUID(),
        type: c.cell_type as 'code' | 'markdown',
        content: c.source.join(''),
        status: 'idle' as const
      }));
      // Pass the virtual path so autosave / manual save work without a dialog
      onNewNotebook?.(fileName, uiCells, virtualPath);
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
              ? 'bg-sim-border text-sim-text ring-1 ring-sim-border'
              : 'text-sim-muted hover:text-sim-text hover:bg-sim-border'}`}
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
              bg-sim-surface border border-sim-border rounded-xl shadow-2xl
              overflow-hidden py-1"
            style={{ animation: 'dropdownIn 0.12s ease-out' }}
          >
            {items.map((item, idx) => (
              <React.Fragment key={idx}>
                {item.separator && <div className="my-1 border-t border-sim-border" />}
                <button
                  onClick={item.onClick}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm
                    transition-colors duration-100 hover:bg-sim-border text-left group
                    ${item.color || 'text-sim-text'}`}
                >
                  <item.icon className={`w-4 h-4 shrink-0 ${item.color || 'text-sim-muted group-hover:text-sim-text'}`} />
                  <span className="flex-1">{item.label}</span>
                  {item.kbd && (
                    <span className="text-[10px] text-sim-muted font-mono whitespace-nowrap">{item.kbd}</span>
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
  activeTab,
  onNewNotebook,
  onOpenFile,
  onSaveFile,
  onRestartKernel,
  onRunAll,
  onOpenFolder,
  onSaveAll,
}) => {
  const { kernelStatus } = useUIStore();
  const { project, closeProject } = useProject();
  const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';


  return (
    <div 
      className="h-12 bg-sim-bg border-b border-sim-border flex items-center justify-between px-2 z-20 relative select-none shadow-sm"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >

      {/* Left: Branding + Project + File menu + RunAll */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Branding */}
        <div className="flex items-center gap-2 mr-1 px-2">
          <img src={octomlLogo} alt="OctoML Logo" className="w-5 h-5 object-contain" />
          <div className="font-mono font-bold tracking-wider text-base">
            <span className="text-sim-text">OctoML</span>
          </div>
        </div>

        {/* Project breadcrumb */}
        {project && (
          <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-sim-surface border border-sim-border max-w-[200px]">
            <span className="text-xs text-sim-muted truncate">{project.name}</span>
            <button
              onClick={closeProject}
              title="Close Project"
              className="ml-1 text-sim-muted hover:text-sim-text transition-colors shrink-0"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        )}
        {/* <FileMenu
          onOpenNotebook={onOpenFile}
          onOpenFolder={onOpenFolder}
          onNewNotebook={onNewNotebook}
          onSave={onSaveFile}
          onSaveAll={onSaveAll ?? onSaveFile}
        /> */}

        <Divider />

        <TopBarButton
          onClick={onRunAll}
          icon={PlayCircle}
          title="Run All Cells"
          disabled={kernelStatus !== 'idle'}
          isActive={kernelStatus === 'busy'}
        />
      </div>

      {/* Center: Active File Icon & Name */}
      <div 
        className="flex-1 mx-4 hidden md:flex items-center justify-center h-8"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {activeTab ? (
          <div className="flex items-center gap-2 px-3 h-7 bg-sim-surface border border-sim-border rounded-lg max-w-[400px]">
            <span className="flex-shrink-0 opacity-80">
              {getFileIcon(activeTab.title.includes('.') ? activeTab.title.substring(activeTab.title.lastIndexOf('.')) : undefined, "w-3.5 h-3.5")}
            </span>
            <span className="text-xs font-mono text-sim-text truncate">{activeTab.title}</span>
            {project && <span className="text-[10px] text-sim-muted font-mono">• {project.name}</span>}
          </div>
        ) : (
          project && (
            <div className="flex items-center gap-1.5 px-3 h-7 max-w-[300px]">
              <span className="text-xs text-sim-muted truncate">{project.name}</span>
            </div>
          )
        )}
      </div>

      {/* Right: Kernel + Tools */}
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>

        <TopBarButton
          onClick={onRestartKernel}
          icon={RotateCcw}
          title="Restart Kernel"
          disabled={!isConnected}
        />

        <Divider />


        <TopBarButton
          onClick={onToggleChat}
          icon={Sparkles}
          title="AI Assistant"
          isActive={isChatOpen}
        />

        {isElectron && (
          <>
            <div className="h-4 w-[1px] bg-sim-border mx-2" />
            <div className="flex items-center gap-1">
              <button 
                onClick={() => (window as any).octoml?.minimizeWindow?.()} 
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-sim-selection text-sim-muted hover:text-sim-text transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button 
                onClick={() => (window as any).octoml?.maximizeWindow?.()} 
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-sim-selection text-sim-muted hover:text-sim-text transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => (window as any).octoml?.closeWindow?.()} 
                className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-sim-red hover:text-white text-sim-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
