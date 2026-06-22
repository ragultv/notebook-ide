import React from 'react';
import type { Mode, EscalationState } from '../../hooks/useAgentChat.js';

interface EscalationBannerProps {
  escalation: EscalationState;
  onSwitch:   (mode: Mode) => void;
  onDismiss:  () => void;
}

const MODE_COLORS: Record<string, string> = {
  PLAN:    'bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-200',
  AGENT:   'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-200',
  AGENTIC: 'bg-orange-50 border-orange-300 text-orange-800 dark:bg-orange-950 dark:border-orange-700 dark:text-orange-200',
};

export function EscalationBanner({ escalation, onSwitch, onDismiss }: EscalationBannerProps) {
  const colorClass = MODE_COLORS[escalation.suggest_mode] ?? MODE_COLORS['PLAN'];

  return (
    <div className={`flex items-center gap-2 px-3 py-2 border rounded-md text-sm ${colorClass}`}>
      <span className="flex-1">
        <strong>{escalation.suggest_mode} mode suggested:</strong> {escalation.reason}
      </span>
      <button
        onClick={() => { onSwitch(escalation.suggest_mode); onDismiss(); }}
        className="px-2 py-0.5 bg-current bg-opacity-10 border border-current rounded text-xs font-medium hover:bg-opacity-20"
      >
        Switch to {escalation.suggest_mode}
      </button>
      <button
        onClick={onDismiss}
        className="px-2 py-0.5 opacity-60 hover:opacity-100 text-xs"
      >
        Dismiss
      </button>
    </div>
  );
}
