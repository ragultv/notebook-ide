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
        <div className="h-10 border-b border-sim-border flex items-center justify-between px-4 bg-sim-surface select-none shrink-0">
          <div className="flex items-center gap-2 text-sim-text">
            <Settings className="w-4 h-4 text-sim-muted" />
            <span className="font-medium">Model Configuration</span>
          </div>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-sim-border bg-[#0c0c0e] flex flex-col">
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => setActiveTab('all')}
                className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center justify-between group ${activeTab === 'all' ? 'bg-sim-selection text-white' : 'text-sim-muted hover:text-sim-text hover:bg-sim-surface'}`}
              >
                <span>All Models</span>
                <span className="bg-sim-surface px-1.5 rounded-sm text-[10px] opacity-50 group-hover:opacity-100">{Object.values(providers).reduce((acc, p) => acc + p.models.length, 0)}</span>
              </button>
              <button
                onClick={() => setActiveTab('cloud')}
                className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center justify-between group ${activeTab === 'cloud' ? 'bg-sim-selection text-white' : 'text-sim-muted hover:text-sim-text hover:bg-sim-surface'}`}
              >
                <span className="flex items-center gap-2"><Cloud className="w-3 h-3" /> Cloud</span>
              </button>
              <button
                onClick={() => setActiveTab('local')}
                className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center justify-between group ${activeTab === 'local' ? 'bg-sim-selection text-white' : 'text-sim-muted hover:text-sim-text hover:bg-sim-surface'}`}
              >
                <span className="flex items-center gap-2"><HardDrive className="w-3 h-3" /> Local</span>
              </button>
            </div>

            <div className="mt-auto p-4 border-t border-sim-border">
              <div className="text-[10px] text-sim-muted uppercase tracking-wider font-bold mb-2">Providers Status</div>
              <div className="space-y-2">
                {Object.entries(providers).map(([pid, p]) => (
                  <div key={pid} className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 truncate max-w-[100px]">{p.name}</span>
                    {p.available ? (
                      <span className="flex items-center gap-1 text-green-500 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Connected
                      </span>
                    ) : (
                      <span className="text-sim-muted">Not Configured</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Area */}
          <div className="flex-1 flex flex-col bg-sim-bg">
            {/* Toolbar */}
            <div className="h-12 border-b border-sim-border flex items-center px-4 gap-3 bg-sim-bg">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sim-muted" />
                <input
                  type="text"
                  placeholder="Filter models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-sim-surface border border-sim-border rounded px-9 py-1.5 text-xs text-sim-text focus:outline-none focus:border-sim-muted transition-colors placeholder-gray-600"
                />
              </div>
            </div>

            {/* Model List / Data Grid */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-full text-sim-muted">Loading configuration...</div>
              ) : allModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-sim-muted gap-2">
                  <AlertCircle className="w-8 h-8 opacity-20" />
                  <p>No models found matching filters.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#121214] text-gray-500 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 font-medium border-b border-sim-border w-10 text-center">Use</th>
                      <th className="px-4 py-2 font-medium border-b border-sim-border">Model Name</th>
                      <th className="px-4 py-2 font-medium border-b border-sim-border">Provider</th>
                      <th className="px-4 py-2 font-medium border-b border-sim-border w-24">Context</th>
                      <th className="px-4 py-2 font-medium border-b border-sim-border w-24 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sim-border text-gray-300">
                    {allModels.map((m) => {
                      const isSelected = selectedModels.some(sel => sel.provider === m.providerId && sel.modelId === m.id);

                      // Provider input row if not available
                      if (!m.providerAvailable && !m.isProviderLocal) {
                        // We might want to group by provider, but for now lets handling API keys in a cleaner way.
                        // Actually, lets just show the status and allow clicking to configure.
                      }

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
                          <td className="px-4 py-2 font-medium flex-1">
                            <div className="flex items-center gap-2">
                              {m.name}
                              {(m.isLocal || m.isProviderLocal) && (
                                <span className="px-1.5 py-0.5 rounded-sm bg-green-500/10 text-green-500 text-[10px] font-bold border border-green-500/20">LOCAL</span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{m.id}</div>
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs">
                            {m.providerName}
                          </td>
                          <td className="px-4 py-2 text-gray-400 text-xs font-mono">
                            {(m.context / 1000).toFixed(0)}k
                          </td>
                          <td className="px-4 py-2 text-right">
                            {m.providerAvailable ? (
                              <span className="text-[10px] text-green-500 bg-green-500/5 px-2 py-0.5 rounded border border-green-500/10">READY</span>
                            ) : (
                              // If provider not available, show input for key directly in row or a configure button
                              <div className="flex flex-col items-end gap-1">
                                <input
                                  type="password"
                                  placeholder="API Key"
                                  className="bg-black border border-sim-border rounded px-2 py-0.5 text-[10px] w-32 focus:border-sim-muted outline-none"
                                  value={apiKeys[m.providerId] || ''}
                                  onChange={(e) => setApiKeys(prev => ({ ...prev, [m.providerId]: e.target.value }))}
                                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(m.providerId)}
                                />
                                <div className="flex gap-2 text-[10px]">
                                  <button
                                    onClick={() => handleSaveKey(m.providerId)}
                                    className="text-sim-red hover:underline"
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
            <div className="h-8 border-t border-sim-border bg-sim-bg flex items-center justify-between px-4 text-[10px] text-sim-muted select-none">
              <span>{selectedModels.length} models selected for chat</span>
              <span>Press Escape to close</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageModelsDialog;
