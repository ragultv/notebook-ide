// Model Selector — reads from the centralized providers.db via /api/providers/models/enabled.
// Shows only models the user has explicitly enabled in Settings → Models.
// Shows a "no models" empty state with a link to settings when nothing is enabled.
import React, { useState, useEffect, useRef } from 'react';
import { ChevronUp, Check, Settings } from 'lucide-react';

const API = 'http://127.0.0.1:3001';

interface EnabledModel {
  provider_id:   string;
  provider_name: string;
  model_id:      string;
  model_name:    string;
}

interface ModelSelectorProps {
  onOpenManage: () => void;
  refreshTrigger?: number;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ onOpenManage, refreshTrigger }) => {
  const [isOpen,        setIsOpen]        = useState(false);
  const [models,        setModels]        = useState<EnabledModel[]>([]);
  const [currentModel,  setCurrentModel]  = useState<EnabledModel | null>(null);
  const [loading,       setLoading]       = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadModels();
  }, [refreshTrigger]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const loadModels = async () => {
    setLoading(true);
    try {
      const [enabledRes, currentRes] = await Promise.all([
        fetch(`${API}/api/providers/models/enabled`).then(r => r.ok ? r.json() : []),
        fetch(`${API}/api/agent/model`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setModels(enabledRes as EnabledModel[]);
      if (currentRes?.model_id) setCurrentModel(currentRes as EnabledModel);
    } catch {
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (model: EnabledModel) => {
    setCurrentModel(model);
    setIsOpen(false);
    await fetch(`${API}/api/agent/model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: model.provider_id, model_id: model.model_id }),
    }).catch(() => {});
  };

  const displayName = currentModel?.model_name || currentModel?.model_id || 'Select model';
  const hasModels   = models.length > 0;
  const hasSelected = !!currentModel?.model_id;

  if (loading) return null;

  return (
    <div className="relative font-mono" ref={dropdownRef}>
      <button
        onClick={() => {
          if (!hasModels) { onOpenManage(); return; }
          if (!isOpen) loadModels();
          setIsOpen(v => !v);
        }}
        className="flex items-center gap-2 px-2 py-1 hover:bg-sim-surface rounded transition-colors text-xs text-sim-muted hover:text-sim-text group"
      >
        <span className={hasSelected ? '' : 'opacity-50'}>
          {hasModels ? displayName : 'No models configured'}
        </span>
        <ChevronUp className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''} text-sim-muted group-hover:text-sim-text`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#1f1f1f] border border-[#2d2d2d] rounded-lg shadow-xl z-50 overflow-hidden py-1">
          <div className="max-h-64 overflow-y-auto">
            {models.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-gray-500">
                No models enabled<br />
                <button onClick={() => { setIsOpen(false); onOpenManage(); }}
                  className="text-sim-red hover:text-white mt-1 underline">
                  Manage Models
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                  Enabled Models
                </div>
                {models.map(m => {
                  const isSelected = currentModel?.model_id === m.model_id && currentModel?.provider_id === m.provider_id;
                  return (
                    <button key={`${m.provider_id}-${m.model_id}`} onClick={() => handleSelect(m)}
                      className={`w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors ${
                        isSelected ? 'bg-sim-border/50 text-white' : 'hover:bg-sim-border/30 text-gray-400 hover:text-gray-200'
                      }`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate">{m.model_name || m.model_id}</div>
                        <div className="text-[10px] text-gray-600 truncate">{m.provider_name}</div>
                      </div>
                      {isSelected && <Check className="w-3 h-3 text-sim-text flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-[#2d2d2d] mt-1 pt-1">
            <button onClick={() => { setIsOpen(false); onOpenManage(); }}
              className="w-full px-3 py-2 text-left flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-sim-border/30 transition-colors">
              <Settings className="w-3 h-3" />
              <span>Manage Models</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
