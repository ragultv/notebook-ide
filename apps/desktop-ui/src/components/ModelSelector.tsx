// Model Selector - Dropdown for selecting AI model
import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Settings, Sparkles } from 'lucide-react';
import { controllerClient, ProviderInfo, ModelSelection } from '../services/controller.client';

interface ModelSelectorProps {
  onOpenManage: () => void;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({ onOpenManage }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [currentModel, setCurrentModel] = useState<ModelSelection>({ provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct' });
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load providers on mount
  useEffect(() => {
    loadProviders();
  }, []);

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

  const getCurrentModelName = () => {
    const provider = providers[currentModel.provider];
    if (!provider) return 'Select Model';
    const model = provider.models.find(m => m.id === currentModel.model);
    return model?.name || currentModel.model;
  };

  // Get only models from connected providers
  const getAvailableModels = () => {
    const allModels: Array<{ provider: string; model: any }> = [];
    Object.entries(providers).forEach(([providerId, provider]) => {
      if (provider.available) {
        provider.models.forEach(model => {
          allModels.push({ provider: providerId, model });
        });
      }
    });
    return allModels;
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#2d2d2d] rounded text-sm text-gray-400">
        <Sparkles className="w-4 h-4" />
        <span>Loading...</span>
      </div>
    );
  }

  const availableModels = getAvailableModels();

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#2d2d2d] hover:bg-[#3d3d3d] rounded text-sm transition-colors border border-[#404040]"
      >
        <Sparkles className="w-4 h-4 text-[#e85d04]" />
        <span className="text-gray-200 max-w-[150px] truncate">{getCurrentModelName()}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#252526] border border-[#404040] rounded shadow-lg z-50 overflow-hidden">
          {/* Models List */}
          <div className="max-h-80 overflow-y-auto">
            {availableModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-gray-500">
                No models available.<br/>
                Connect a provider first.
              </div>
            ) : (
              availableModels.map(({ provider, model }) => {
                const isSelected = currentModel.provider === provider && currentModel.model === model.id;
                
                return (
                  <button
                    key={`${provider}-${model.id}`}
                    onClick={() => handleSelectModel(provider, model.id)}
                    className={`w-full px-3 py-2 text-left flex items-center gap-2 transition-colors ${
                      isSelected
                        ? 'bg-[#e85d04]/20 text-white'
                        : 'hover:bg-[#2d2d2d] text-gray-300'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{model.name}</div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-[#e85d04] flex-shrink-0" />}
                  </button>
                );
              })
            )}
            
            {/* Manage Models Option */}
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenManage();
              }}
              className="w-full px-3 py-2 text-left flex items-center gap-2 border-t border-[#404040] bg-[#1e1e1e] hover:bg-[#2d2d2d] text-gray-300 transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm">Manage Models</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
