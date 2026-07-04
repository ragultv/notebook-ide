import React from 'react';
import { Plus, Type, Code } from 'lucide-react';

interface AddCellDividerProps {
  onAddCode: () => void;
  onAddText: () => void;
  visible?: boolean;
}

export const AddCellDivider: React.FC<AddCellDividerProps> = ({ onAddCode, onAddText, visible }) => {
  return (
    <div className={`group relative h-8 w-full flex items-center justify-center my-1 z-10 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
      <div className="absolute inset-x-0 h-[1px] bg-sim-border group-hover:bg-sim-muted"></div>

      <div className="flex gap-2 relative bg-transparent">
        <button
          onClick={(e) => { e.stopPropagation(); onAddCode(); }}
          className="flex items-center gap-1.5 bg-sim-surface border border-sim-border text-xs font-mono font-medium text-sim-muted px-3 py-1.5 rounded hover:bg-sim-red hover:text-white hover:border-sim-red transition-all transform hover:scale-105 active:scale-95"
        >
          <Code className="w-3.5 h-3.5" /> Code
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAddText(); }}
          className="flex items-center gap-1.5 bg-sim-surface border border-sim-border text-xs font-mono font-medium text-sim-muted px-3 py-1.5 rounded hover:bg-sim-red hover:text-white hover:border-sim-red transition-all transform hover:scale-105 active:scale-95"
        >
          <Type className="w-3.5 h-3.5" /> Text
        </button>
      </div>
    </div>
  );
};