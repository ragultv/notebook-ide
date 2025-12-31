// Manage Models Dialog - Configure AI providers and select models
import React, { useState, useEffect } from 'react';
import { X, Check, AlertCircle, Key, ExternalLink, Zap, Sparkles, Cpu, Eye, EyeOff, Loader2 } from 'lucide-react';
import { controllerClient, ProviderInfo, ModelSelection } from '../services/controller.client';

interface ManageModelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ManageModelsDialog: React.FC<ManageModelsDialogProps> = ({ isOpen, onClose }) => {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [currentModel, setCurrentModel] = useState<ModelSelection>({ provider: 'nvidia', model: '' });
  const [selectedProvider, setSelectedProvider] = useState<string>('nvidia');
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadProviders();
    }
  }, [isOpen]);

  const loadProviders = async () => {
    try {
      setLoading(true);
      const data = await controllerClient.getProviders();
      setProviders(data.providers);
      setCurrentModel(data.current);
      setSelectedProvider(data.current.provider);
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
    } catch (err) {
      console.error('Failed to select model:', err);
    }
  };

  const handleConnect = async (providerId: string) => {
    const key = apiKeys[providerId];
    if (!key) return;
    
    setConnecting(providerId);
    try {
      // Save API key and refresh providers
      await controllerClient.setProviderApiKey(providerId, key);
      await loadProviders();
    } catch (err) {
      console.error('Failed to connect:', err);
    } finally {
      setConnecting(null);
    }
  };

  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case 'nvidia':
        return <Cpu className="w-4 h-4 text-green-400" />;
      case 'groq':
        return <Zap className="w-4 h-4 text-orange-400" />;
      case 'gemini':
        return <Sparkles className="w-4 h-4 text-blue-400" />;
      default:
        return <Cpu className="w-4 h-4" />;
    }
  };

  const getProviderUrl = (providerId: string) => {
    switch (providerId) {
      case 'nvidia':
        return 'https://build.nvidia.com/';
      case 'groq':
        return 'https://console.groq.com/keys';
      case 'gemini':
        return 'https://aistudio.google.com/apikey';
      default:
        return '#';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="bg-[#1e1e1e] rounded w-[600px] max-h-[70vh] overflow-hidden border border-[#404040]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 bg-[#252526] border-b border-[#404040] flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-200">Manage AI Models</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#3d3d3d] rounded text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
          </div>
        ) : (
          <div className="flex h-[400px]">
            {/* Provider Tabs - Left Side */}
            <div className="w-40 bg-[#252526] border-r border-[#404040] flex flex-col">
              {Object.entries(providers).map(([providerId, provider]) => (
                <button
                  key={providerId}
                  onClick={() => setSelectedProvider(providerId)}
                  className={`px-3 py-2.5 flex items-center gap-2 text-left transition-colors text-sm ${
                    selectedProvider === providerId
                      ? 'bg-[#37373d] text-white border-l-2 border-[#e85d04]'
                      : 'hover:bg-[#2d2d2d] text-gray-400'
                  }`}
                >
                  {getProviderIcon(providerId)}
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{provider.name}</div>
                  </div>
                  {provider.available && (
                    <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>

            {/* Model List - Right Side */}
            <div className="flex-1 overflow-y-auto">
              {providers[selectedProvider] && (
                <div className="p-4">
                  {/* Not Connected - Show API Key Input */}
                  {!providers[selectedProvider].available ? (
                    <div className="space-y-4">
                      <div className="text-center py-6">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[#2d2d2d] flex items-center justify-center">
                          <Key className="w-6 h-6 text-gray-500" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-200 mb-1">Connect to {providers[selectedProvider].name}</h3>
                        <p className="text-xs text-gray-500">Enter your API key to access models</p>
                      </div>
                      
                      <div>
                        <label className="block text-xs text-gray-400 mb-1.5">API Key</label>
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <input
                              type={showKeys[selectedProvider] ? 'text' : 'password'}
                              value={apiKeys[selectedProvider] || ''}
                              onChange={(e) => setApiKeys(prev => ({ ...prev, [selectedProvider]: e.target.value }))}
                              placeholder="Enter API key..."
                              className="w-full px-3 py-2 bg-[#1e1e1e] border border-[#404040] rounded text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#e85d04]"
                            />
                            <button
                              onClick={() => setShowKeys(prev => ({ ...prev, [selectedProvider]: !prev[selectedProvider] }))}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                            >
                              {showKeys[selectedProvider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                          <button
                            onClick={() => handleConnect(selectedProvider)}
                            disabled={!apiKeys[selectedProvider] || connecting === selectedProvider}
                            className="px-4 py-2 bg-[#e85d04] hover:bg-[#d45203] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm transition-colors flex items-center gap-2"
                          >
                            {connecting === selectedProvider ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              'Connect'
                            )}
                          </button>
                        </div>
                      </div>
                      
                      <a
                        href={getProviderUrl(selectedProvider)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#e85d04] hover:text-[#ff6b1a]"
                      >
                        Get API Key <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ) : (
                    /* Connected - Show Models */
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Check className="w-4 h-4 text-green-400" />
                        <span className="text-sm text-green-400">Connected</span>
                      </div>
                      
                      <div className="space-y-1">
                        {providers[selectedProvider].models.map(model => {
                          const isSelected = currentModel.provider === selectedProvider && currentModel.model === model.id;

                          return (
                            <button
                              key={model.id}
                              onClick={() => handleSelectModel(selectedProvider, model.id)}
                              className={`w-full p-3 border-b border-[#333] text-left transition-colors ${
                                isSelected
                                  ? 'bg-[#e85d04]/20 border-l-2 border-l-[#e85d04]'
                                  : 'hover:bg-[#2d2d2d]'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="text-sm text-gray-200 flex items-center gap-2">
                                    {model.name}
                                    {isSelected && <Check className="w-4 h-4 text-[#e85d04]" />}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {(model.context / 1000).toFixed(0)}K context
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#252526] border-t border-[#404040] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-[#e85d04] hover:bg-[#d45203] text-white rounded text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManageModelsDialog;
