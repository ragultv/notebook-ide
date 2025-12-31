import React from 'react';
import { Zap, Sparkles, Power, RotateCcw, FolderOpen, Save, PlayCircle } from 'lucide-react';
import { useUIStore, KernelStatus } from '../../state/ui.store';

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
}

const statusColors: Record<KernelStatus, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-yellow-500 animate-pulse',
  idle: 'bg-green-500',
  busy: 'bg-yellow-500 animate-pulse',
  error: 'bg-red-500',
};

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
}) => {
  const { kernelStatus } = useUIStore();
  const isConnected = kernelStatus === 'idle' || kernelStatus === 'busy';
  
  return (
    <div className="h-14 bg-sim-bg border-b border-sim-border flex items-center justify-between px-4 z-20 relative select-none">
      
      {/* Left: Branding & File Actions */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-sim-red fill-current" />
          <div className="font-mono font-bold tracking-wider text-lg">
            <span className="text-white">OPREL</span> <span className="text-sim-muted">STUDIO</span>
          </div>
        </div>
        
        {/* File Actions */}
        <div className="hidden sm:flex items-center gap-1 ml-4 border-l border-sim-border pl-4">
          <button 
            onClick={onOpenFile}
            className="p-2 text-sim-muted hover:text-white hover:bg-sim-surface rounded transition-colors"
            title="Open File"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button 
            onClick={onSaveFile}
            className="p-2 text-sim-muted hover:text-white hover:bg-sim-surface rounded transition-colors"
            title="Save File"
          >
            <Save className="w-4 h-4" />
          </button>
          <button 
            onClick={onRunAll}
            disabled={kernelStatus !== 'idle'}
            className={`p-2 rounded transition-colors flex items-center gap-1.5 ${
              kernelStatus === 'idle' 
                ? 'text-green-400 hover:text-green-300 hover:bg-sim-surface' 
                : 'text-sim-muted/50 cursor-not-allowed'
            }`}
            title="Run All Cells"
          >
            <PlayCircle className="w-4 h-4" />
            <span className="text-xs font-mono">Run All</span>
          </button>
        </div>
      </div>

      {/* Center: Notebook Name (Subtle) */}
      <div className="hidden md:block absolute left-1/2 transform -translate-x-1/2">
         <span className="text-xs font-mono text-sim-muted uppercase tracking-widest opacity-50">{notebookName}</span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        
        {/* Kernel Status & Controls */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded border border-sim-border">
          <div className={`w-2 h-2 rounded-full ${statusColors[kernelStatus]}`} />
          <span className="text-xs font-mono text-sim-muted capitalize">{kernelStatus}</span>
          
          {!isConnected ? (
            <button 
              onClick={onConnectKernel}
              className="ml-2 p-1 text-sim-muted hover:text-green-400 transition-colors"
              title="Connect Kernel"
            >
              <Power className="w-4 h-4" />
            </button>
          ) : (
            <button 
              onClick={onRestartKernel}
              className="ml-2 p-1 text-sim-muted hover:text-yellow-400 transition-colors"
              title="Restart Kernel"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New Simulation Button */}
        <button 
          onClick={onNewNotebook}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded border border-sim-border text-xs font-mono font-medium text-sim-muted hover:text-white hover:border-sim-text transition-all uppercase tracking-wide"
        >
          <span>New Notebook</span>
        </button>

        {/* AI Toggle */}
        <button 
           onClick={onToggleChat}
           className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs font-mono font-medium transition-all uppercase tracking-wide
             ${isChatOpen 
               ? 'bg-sim-red/10 text-sim-red border-sim-red' 
               : 'bg-transparent text-sim-muted border-sim-border hover:border-sim-text hover:text-white'}
           `}
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">AI Agent</span>
        </button>
      </div>
    </div>
  );
};