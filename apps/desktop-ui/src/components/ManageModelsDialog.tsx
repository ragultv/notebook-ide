// Manage Models Dialog - Manual Code Design style
import React, { useState, useEffect } from 'react';
import { X, Check, Search, Plus, Trash2, Key, Monitor, Cloud, Cpu, HardDrive, Square, CheckSquare, AlertCircle, ExternalLink, Settings } from 'lucide-react';
import { controllerClient, ProviderInfo, ModelSelection, SelectedModel } from '../services/controller.client';

interface ManageModelsDialogProps {
  isOpen?: boolean; // Optional now, treated as always open if rendered
  onClose?: () => void; // Optional/Unused in tab mode
  onModelsChanged?: () => void;
}

export const ManageModelsDialog: React.FC<ManageModelsDialogProps> = ({ onModelsChanged }) => {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all', 'local', 'cloud'
  const [searchQuery, setSearchQuery] = useState('');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await controllerClient.getProviders();
      setProviders(data.providers);
      setSelectedModels(data.selectedModels || []);
    } catch (error) {
      console.error("Failed to load providers", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleModel = async (providerId: string, modelId: string) => {
    const isSelected = selectedModels.some(m => m.provider === providerId && m.modelId === modelId);
    try {
      // Optimistic update
      const newSelected = isSelected
        ? selectedModels.filter(m => !(m.provider === providerId && m.modelId === modelId))
        : [...selectedModels, { provider: providerId, modelId }];

      setSelectedModels(newSelected);

      // API call
      await controllerClient.toggleModelSelection(providerId, modelId, !isSelected);

      // Notify parent
      onModelsChanged?.();
    } catch (e) {
      // Revert on error
      console.error(e);
      loadData();
    }
  };

  const handleSaveKey = async (providerId: string) => {
    const key = apiKeys[providerId];
    if (!key) return;
    try {
      await controllerClient.setProviderApiKey(providerId, key);
      loadData(); // Reload to update status
      setApiKeys(prev => ({ ...prev, [providerId]: '' })); // Clear input
    } catch (e) {
      console.error(e);
    }
  };

  // Flatten models for the table view
  const allModels = Object.entries(providers).flatMap(([pid, p]) =>
    p.models.map(m => ({
      providerId: pid,
      providerName: p.name,
      isProviderLocal: p.isLocal,
      providerAvailable: p.available,
      ...m
    }))
  ).filter(m => {
    if (activeTab === 'local' && !m.isProviderLocal && !m.isLocal) return false;
    if (activeTab === 'cloud' && (m.isProviderLocal || m.isLocal)) return false;
    if (searchQuery && !m.name.toLowerCase().includes(searchQuery.toLowerCase()) && !m.providerName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="w-full h-full bg-sim-bg flex flex-col overflow-hidden font-mono text-sm">
      <div
        className="w-full h-full flex flex-col overflow-hidden"
      >
        {/* Header - now part of the tab content just to show title if needed, or remove? 
            User image shows 'Model Configuration' header inside the window.
            I will keep a minimal header inside the view.
        */}
        {/* <div className="h-10 border-b border-sim-border flex items-center justify-between px-4 bg-sim-surface select-none shrink-0">
          <div className="flex items-center gap-2 text-sim-text">
            <Settings className="w-4 h-4 text-sim-muted" />
            <span className="font-medium">Model Configuration</span>
          </div>
        </div> */}

        {/* Content Layout */}
        <div className="flex-1 flex flex-col bg-sim-bg overflow-hidden">
          {/* Toolbar */}
          <div className="h-12 border-b border-sim-border flex items-center px-4 gap-3 bg-sim-bg shrink-0">
            {/* Filters */}
            <div className="flex items-center bg-sim-surface rounded  gap-1 border border-sim-border">
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1 rounded text-[10px] font-medium transition-colors ${activeTab === 'all' ? 'bg-sim-selection text-white shadow-sm' : 'text-sim-muted hover:text-sim-text hover:bg-white/5'
                  }`}
              >
                All
              </button>
              <button
                onClick={() => setActiveTab('cloud')}
                className={`px-3 py-1 rounded text-[10px] font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'cloud' ? 'bg-sim-selection text-white shadow-sm' : 'text-sim-muted hover:text-sim-text hover:bg-white/5'
                  }`}
              >
                <Cloud className="w-3 h-3" /> Cloud
              </button>
              <button
                onClick={() => setActiveTab('local')}
                className={`px-3 py-1 rounded text-[10px] font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'local' ? 'bg-sim-selection text-white shadow-sm' : 'text-sim-muted hover:text-sim-text hover:bg-white/5'
                  }`}
              >
                <HardDrive className="w-3 h-3" /> Local
              </button>
            </div>

            <div className="w-[1px] h-6 bg-sim-border mx-1" />

            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sim-muted" />
              <input
                type="text"
                placeholder="Filter models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-sim-surface border border-sim-border rounded-md px-8 py-1.5 text-xs text-sim-text focus:outline-none focus:border-sim-muted transition-colors placeholder-gray-600"
              />
            </div>

            {/* Provider Status Summary (Optional Mini-View) */}
            <div className="ml-auto flex items-center gap-2">
              {Object.values(providers).some(p => !p.available) && (
                <span className="text-[10px] text-sim-muted hidden sm:inline-block">
                  {Object.values(providers).filter(p => p.available).length} connected
                </span>
              )}
            </div>
          </div>

          {/* Model List / Data Grid */}
          <div className="flex-1 overflow-auto custom-scrollbar bg-sim-bg">
            {loading ? (
              <div className="flex items-center justify-center h-full text-sim-muted">Loading configuration...</div>
            ) : allModels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-sim-muted gap-2">
                <AlertCircle className="w-8 h-8 opacity-20" />
                <p>No models found matching filters.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead className="bg-[#121214] text-gray-500 sticky top-0 z-10 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 font-semibold border-b border-sim-border w-10 text-center bg-[#121214]">Use</th>
                    <th className="px-4 py-3 font-semibold border-b border-sim-border bg-[#121214]">Model Name</th>
                    <th className="px-4 py-3 font-semibold border-b border-sim-border w-32 bg-[#121214]">Provider</th>
                    <th className="px-4 py-3 font-semibold border-b border-sim-border w-24 bg-[#121214]">Context</th>
                    <th className="px-4 py-3 font-semibold border-b border-sim-border w-32 text-right bg-[#121214]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sim-border text-gray-300">
                  {allModels.map((m) => {
                    const isSelected = selectedModels.some(sel => sel.provider === m.providerId && sel.modelId === m.id);

                    return (
                      <tr key={`${m.providerId}-${m.id}`} className="hover:bg-sim-surface/50 group transition-colors">
                        <td className="px-4 py-2 text-center">
                          <button
                            onClick={() => m.providerAvailable && handleToggleModel(m.providerId, m.id)}
                            disabled={!m.providerAvailable}
                            className={`rounded transition-colors ${!m.providerAvailable ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-sim-red" />
                            ) : (
                              <Square className="w-4 h-4 text-sim-muted" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-2 font-medium">
                          <div className="flex items-center gap-2 truncate max-w-[300px]">
                            <span className="truncate text-sm" title={m.name}>{m.name}</span>
                            {(m.isLocal || m.isProviderLocal) && (
                              <span className="px-1.5 py-0.5 rounded-sm bg-green-500/10 text-green-500 text-[10px] font-bold border border-green-500/20 shrink-0">LOCAL</span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5 truncate max-w-[300px]" title={m.id}>{m.id}</div>
                        </td>
                        <td className="px-4 py-2 text-gray-400 text-xs">
                          {m.providerName}
                        </td>
                        <td className="px-4 py-2 text-gray-400 text-xs font-mono">
                          {(m.context / 1000).toFixed(0)}k
                        </td>
                        <td className="px-4 py-2 text-right">
                          {m.providerAvailable ? (
                            <span className="text-[10px] text-green-500 bg-green-500/5 px-2 py-0.5 rounded border border-green-500/10 font-medium tracking-wide">READY</span>
                          ) : (
                            <div className="flex flex-col items-end gap-1">
                              <input
                                type="password"
                                placeholder="API Key"
                                className="bg-black border border-sim-border rounded px-2 py-1 text-[10px] w-32 focus:border-sim-muted outline-none transition-all"
                                value={apiKeys[m.providerId] || ''}
                                onChange={(e) => setApiKeys(prev => ({ ...prev, [m.providerId]: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(m.providerId)}
                              />
                              <div className="flex gap-2 text-[10px]">
                                <button
                                  onClick={() => handleSaveKey(m.providerId)}
                                  className="text-sim-red hover:underline font-medium"
                                  disabled={!apiKeys[m.providerId]}
                                >
                                  Connect
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer Status */}
          <div className="h-8 border-t border-sim-border bg-sim-bg flex items-center justify-between px-4 text-[10px] text-sim-muted select-none shrink-0">
            <span>{selectedModels.length} models selected for chat</span>
            {Object.values(providers).length > 0 && (
              <span className="opacity-50">
                {Object.values(providers).filter(p => !p.available).length > 0
                  ? `${Object.values(providers).filter(p => !p.available).length} providers pending config`
                  : "All systems operational"
                }
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageModelsDialog;
