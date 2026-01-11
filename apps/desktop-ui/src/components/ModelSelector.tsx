// Model Selector - Dropdown for selecting AI model (shows only checked models from Manage Provider)
import React, { useState, useEffect, useRef } from 'react';
import { ChevronUp, Check, Settings, HardDrive, Cpu, Zap, Sparkles } from 'lucide-react';
import { controllerClient, ProviderInfo, ModelSelection, SelectedModel } from '../services/controller.client';


interface ModelSelectorProps {
  onOpenManage: () => void;
  refreshTrigger?: number; // Trigger to refresh models when manage dialog closes
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ onOpenManage, refreshTrigger }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [currentModel, setCurrentModel] = useState<ModelSelection>({ provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct' });
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load providers on mount and when refreshTrigger changes
  useEffect(() => {
    loadProviders();
  }, [refreshTrigger]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadProviders = async () => {
    try {
      const data = await controllerClient.getProviders();
      setProviders(data.providers);
      setCurrentModel(data.current);
      setSelectedModels(data.selectedModels || []);
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectModel = async (provider: string, modelId: string) => {
    try {
      const result = await controllerClient.selectModel(provider, modelId);
      if (result.success) {
        setCurrentModel(result.current);
      }
      setIsOpen(false);
    } catch (err) {
      console.error('Failed to select model:', err);
    }
  };

  const getCurrentModelInfo = () => {
    const provider = providers[currentModel.provider];
    if (!provider) return { name: 'Select Model', isLocal: false };
    const model = provider.models.find(m => m.id === currentModel.model);
    return {
      name: model?.name || currentModel.model,
      isLocal: provider.isLocal || model?.isLocal
    };
  };

  // Get only models that are selected in Manage Provider
  const getAvailableModels = () => {
    const allModels: Array<{ provider: string; providerInfo: ProviderInfo; model: any }> = [];

    Object.entries(providers).forEach(([providerId, provider]) => {
      if (provider.available) {
        provider.models.forEach(model => {
          const isSelected = selectedModels.some(
            sm => sm.provider === providerId && sm.modelId === model.id
          );

          if (isSelected) {
            allModels.push({ provider: providerId, providerInfo: provider, model });
          }
        });
      }
    });
    return allModels;
  };

  const { name: currentName, isLocal: currentIsLocal } = getCurrentModelInfo();
  const availableModels = getAvailableModels();
  const hasNoSelectedModels = selectedModels.length === 0;

  if (loading) return null;

  return (
    <div className="relative font-mono" ref={dropdownRef}>
      {/* Selector Button - Text Only Style */}
      <button
        onClick={() => hasNoSelectedModels ? onOpenManage() : setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 hover:bg-sim-surface rounded transition-colors text-xs text-sim-muted hover:text-sim-text group"
      >
        <span className={`transition-colors ${currentIsLocal ? 'text-green-400' : ''}`}>
          {currentName}
        </span>
        <ChevronUp className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''} text-sim-muted group-hover:text-sim-text`} />
      </button>

      {/* Dropdown Menu - Minimal Floating Style */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#1f1f1f] border border-[#2d2d2d] rounded-lg shadow-xl z-50 overflow-hidden py-1">
          {/* Models List */}
          <div className="max-h-64 overflow-y-auto">
            {availableModels.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-gray-500">
                No models selected<br />
                <button
                  onClick={() => { setIsOpen(false); onOpenManage(); }}
                  className="text-sim-red hover:text-white mt-1 underline"
                >
                  Manage Models
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wider">Model</div>
                {availableModels.map(({ provider, providerInfo, model }) => {
                  const isSelected = currentModel.provider === provider && currentModel.model === model.id;
                  const isLocal = providerInfo.isLocal || model.isLocal;

                  return (
                    <button
                      key={`${provider}-${model.id}`}
                      onClick={() => handleSelectModel(provider, model.id)}
                      className={`w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors ${isSelected
                          ? 'bg-sim-border/50 text-white'
                          : 'hover:bg-sim-border/30 text-gray-400 hover:text-gray-200'
                        }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate flex items-center gap-2">
                          {model.name}
                          {isLocal && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Local" />
                          )}
                        </div>
                      </div>
                      {isSelected && <Check className="w-3 h-3 text-sim-text flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer - Manage Models */}
          <div className="border-t border-[#2d2d2d] mt-1 pt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenManage();
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-sim-border/30 transition-colors"
            >
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
