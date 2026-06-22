import React, { useEffect, useRef } from 'react';
import type { KernelLine } from '../../hooks/useAgentChat.js';

interface ExecutionOutputProps {
  lines:    KernelLine[];
  onClear?: () => void;
}

export function ExecutionOutput({ lines, onClear }: ExecutionOutputProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-950 text-xs font-mono">
      <div className="flex items-center justify-between px-3 py-1 bg-gray-900 text-gray-400">
        <span>Execution Output</span>
        {onClear && (
          <button onClick={onClear} className="hover:text-white text-[10px]">
            Clear
          </button>
        )}
      </div>
      <div className="max-h-48 overflow-y-auto p-2 space-y-px">
        {lines.map((line, i) => (
          <div
            key={i}
            className={line.stream === 'stderr' ? 'text-red-400' : 'text-green-300'}
          >
            {line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
