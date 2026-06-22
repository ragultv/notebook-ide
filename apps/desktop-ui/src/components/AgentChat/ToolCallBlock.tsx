import React, { useState } from 'react';
import type { ToolCallState } from '../../hooks/useAgentChat.js';

interface ToolCallBlockProps {
  toolCall: ToolCallState;
}

export function ToolCallBlock({ toolCall }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isDone = toolCall.result !== undefined;

  return (
    <div className="my-1 border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-left"
      >
        <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
        <span className="font-mono text-blue-600 dark:text-blue-400">{toolCall.tool}</span>
        {isDone && <span className="ml-auto text-green-500">✓</span>}
        {!isDone && <span className="ml-auto text-yellow-500 animate-pulse">…</span>}
      </button>

      {expanded && (
        <div className="p-3 bg-white dark:bg-gray-900 space-y-2">
          <div>
            <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-1">Input</div>
            <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          {isDone && (
            <div>
              <div className="text-gray-500 uppercase tracking-wider text-[10px] mb-1">Result</div>
              <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                {JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
