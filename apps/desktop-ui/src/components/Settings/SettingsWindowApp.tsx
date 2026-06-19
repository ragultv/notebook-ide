import React, { useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { SettingsPage } from './SettingsPage';

export const SettingsWindowApp: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => window.octoml?.minimizeWindow();
  const handleMaximize = async () => {
    window.octoml?.maximizeWindow();
    const max = await window.octoml?.isMaximized();
    setIsMaximized(max || false);
  };
  const handleClose = () => window.octoml?.closeWindow();

  return (
    <div className="w-screen h-screen flex flex-col bg-[#09090b] text-gray-200 overflow-hidden font-sans border border-[#2d2d2d]">
      {/* Settings Window Titlebar */}
      <div 
        className="h-9 bg-[#161618] border-b border-[#2d2d2d] flex items-center justify-between shrink-0 select-none"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center px-4">
          <span className="text-[11px] font-semibold tracking-wider text-gray-400">SETTINGS - PROVIDERS</span>
        </div>
        
        <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            onClick={handleMinimize}
            className="px-4 hover:bg-white/5 transition-colors flex items-center justify-center text-gray-400"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="px-4 hover:bg-white/5 transition-colors flex items-center justify-center text-gray-400"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={handleClose}
            className="px-4 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-hidden">
        <SettingsPage />
      </div>
    </div>
  );
};
