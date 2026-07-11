import React from 'react';
import type { Mode, EscalationState } from '../../hooks/useAgentChat.js';

interface EscalationBannerProps {
  escalation:            EscalationState;
  onSwitch:              (mode: Mode) => void;
  onDismiss:             () => void;
  onSwitchAndContinue?:  (mode: Mode) => void;
}

const MODE_STYLES: Record<string, { badge: string; border: string; bg: string }> = {
  PLAN: {
    badge:  'text-blue-600 dark:text-blue-400 bg-blue-100/80 dark:bg-blue-900/40',
    border: 'border-blue-200/80 dark:border-blue-800/50',
    bg:     'bg-blue-50/50 dark:bg-blue-950/20',
  },
  AGENT: {
    badge:  'text-amber-600 dark:text-amber-400 bg-amber-100/80 dark:bg-amber-900/40',
    border: 'border-amber-200/80 dark:border-amber-800/50',
    bg:     'bg-amber-50/50 dark:bg-amber-950/20',
  },
  AGENTIC: {
    badge:  'text-orange-600 dark:text-orange-400 bg-orange-100/80 dark:bg-orange-900/40',
    border: 'border-orange-200/80 dark:border-orange-800/50',
    bg:     'bg-orange-50/50 dark:bg-orange-950/20',
  },
};

export function EscalationBanner({ escalation, onSwitch, onDismiss, onSwitchAndContinue }: EscalationBannerProps) {
  const style = MODE_STYLES[escalation.suggest_mode] ?? MODE_STYLES['PLAN'];

  const handleSwitchOnly = () => {
    onSwitch(escalation.suggest_mode);
    onDismiss();
  };

  return (
    <div className={`flex items-center justify-between gap-2.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${style.border} ${style.bg}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase shrink-0 ${style.badge}`}>
          {escalation.suggest_mode}
        </span>
        <span className="text-gray-600 dark:text-gray-300 truncate">
          {escalation.reason || 'Switch mode for better results'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onSwitchAndContinue && (
          <button
            onClick={() => onSwitchAndContinue(escalation.suggest_mode)}
            className="px-2.5 py-1 rounded-md bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 font-medium hover:opacity-90 transition-opacity flex items-center gap-1"
            title={`Switch to ${escalation.suggest_mode} and immediately execute the next step`}
          >
            <span>Switch & continue</span>
            <span className="text-[10px]">▶</span>
          </button>
        )}
        <button
          onClick={handleSwitchOnly}
          className="px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-200 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title={`Switch mode selector to ${escalation.suggest_mode} without sending a prompt`}
        >
          Switch mode
        </button>
        <button
          onClick={onDismiss}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

