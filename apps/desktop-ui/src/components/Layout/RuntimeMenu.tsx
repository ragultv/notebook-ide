import React, { useState, useRef, useEffect } from 'react';
import { Power, ChevronDown, Check, Activity, Cpu } from 'lucide-react';
import { useUIStore, KernelStatus, RuntimeType } from '../../store/ui.store';

const statusColors: Record<KernelStatus, string> = {
  disconnected: 'bg-gray-500',
  connecting: 'bg-sim-red animate-pulse',
  idle: 'bg-green-500',
  busy: 'bg-sim-red animate-pulse',
  error: 'bg-red-600',
};

export const RuntimeMenu: React.FC<{ onConnect: (type: RuntimeType) => void }> = ({ onConnect }) => {
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
        <div className="flex items-center gap-2 px-3 h-8 bg-[#1e1e20] border border-[#27272a] rounded-xl text-[10px] font-mono text-gray-400 flex-1 justify-center">
          <Check className="w-3 h-3 text-green-500 shrink-0" />
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColors[kernelStatus]}`} />
          <span className="uppercase truncate">{runtimeType} · {kernelStatus}</span>
        </div>
        {/* Resource Panel toggle */}
        {/* <button
          onClick={toggleResourcePanel}
          title="Resource Monitor"
          className={`flex items-center gap-1.5 px-3 h-8 rounded-xl border text-[10px] font-mono transition-all duration-200 shrink-0
            ${resourcePanelOpen
              ? 'bg-[#27272a] border-white/20 text-white'
              : 'bg-[#1e1e20] border-[#27272a] text-gray-500 hover:text-white hover:border-[#3a3a3c]'}`}
        >
          <Activity className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden xl:inline">Monitor</span>
        </button> */}
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative w-full">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={isConnecting}
        className={`w-full flex items-center justify-center gap-2 px-4 h-8 rounded-xl text-xs font-medium transition-all duration-200 border
          ${isConnecting
            ? 'bg-sim-red/10 border-sim-red/20 text-sim-red animate-pulse'
            : 'bg-sim-red/10 border-sim-red/20 text-sim-red hover:bg-sim-red/20'}`}
      >
        <Power className="w-3.5 h-3.5 shrink-0" />
        <span>{isConnecting ? 'Connecting...' : 'Connect Kernel'}</span>
        <ChevronDown className={`w-3 h-3 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-[calc(100%+6px)] z-50 min-w-[160px] w-full
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
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    {runtimeType === type && !isGpu && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </div>
                  <Cpu className={`w-3.5 h-3.5 shrink-0 ${runtimeType === type && !isGpu ? 'text-sim-red' : 'text-gray-500'}`} />
                  <div className="flex flex-col">
                    <span className="font-semibold">{type.toUpperCase()} Runtime</span>
                  </div>
                </div>
                {isGpu && (
                  <span className="text-[9px] bg-[#3a3a3c] text-gray-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-widest shrink-0">
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
