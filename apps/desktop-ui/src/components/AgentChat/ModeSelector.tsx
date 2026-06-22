import React from 'react';
import type { Mode } from '../../hooks/useAgentChat.js';

interface ModeSelectorProps {
  mode:    Mode;
  onChange: (mode: Mode) => void;
}

const MODES: Array<{ id: Mode; hint: string }> = [
  { id: 'ASK',     hint: 'Read · Search · Explain' },
  { id: 'PLAN',    hint: 'Read · Search · Create plans' },
  { id: 'AGENT',   hint: 'Read · Write files · Edit cells' },
  { id: 'AGENTIC', hint: 'Read · Write · Execute code' },
];

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
      {MODES.map(m => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          title={m.hint}
          className={[
            'flex flex-col items-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            mode === m.id
              ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200',
          ].join(' ')}
        >
          <span className="font-semibold">{m.id}</span>
          <span className="text-[10px] opacity-70 whitespace-nowrap">{m.hint}</span>
        </button>
      ))}
    </div>
  );
}
