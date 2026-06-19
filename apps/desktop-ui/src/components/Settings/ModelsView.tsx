import React, { useState, useEffect } from 'react';
import { CheckSquare, Square, Search, AlertCircle, Cloud, HardDrive } from 'lucide-react';
import { controllerClient, ProviderInfo, SelectedModel } from '../../services/controller.client';

interface ModelsViewProps {
  onModelsChanged?: () => void;
}

export const ModelsView: React.FC<ModelsViewProps> = ({ onModelsChanged }) => {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all'); // 'all', 'local', 'cloud'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([]);

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
      const newSelected = isSelected
        ? selectedModels.filter(m => !(m.provider === providerId && m.modelId === modelId))
        : [...selectedModels, { provider: providerId, modelId }];

      setSelectedModels(newSelected);
      await controllerClient.toggleModelSelection(providerId, modelId, !isSelected);
      onModelsChanged?.();
    } catch (e) {
      console.error(e);
      loadData();
    }
  };

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
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#09090b]">
      {/* Header / Toolbar */}
      <div className="h-16 border-b border-[#2d2d2d] flex items-center px-6 gap-4 shrink-0 bg-[#09090b]">
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">Models</h1>
          <p className="text-[11px] text-gray-500">Enable models to show in the AI Chat dropdown.</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center bg-[#161618] rounded-lg p-1 border border-[#2d2d2d]">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === 'all' ? 'bg-[#2b2b2e] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            All
          </button>
          <button
            onClick={() => setActiveTab('cloud')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'cloud' ? 'bg-[#2b2b2e] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <Cloud className="w-3.5 h-3.5" /> Cloud
          </button>
          <button
            onClick={() => setActiveTab('local')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${activeTab === 'local' ? 'bg-[#2b2b2e] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <HardDrive className="w-3.5 h-3.5" /> Local
          </button>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#161618] border border-[#2d2d2d] rounded-lg pl-9 pr-4 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-sim-red/50 transition-colors placeholder-gray-600"
          />
        </div>
      </div>

      {/* Model List */}
      <div className="flex-1 overflow-auto custom-scrollbar p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">Loading models...</div>
        ) : allModels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <AlertCircle className="w-10 h-10 opacity-20" />
            <p>No models found matching filters.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-[#2d2d2d] overflow-hidden bg-[#161618]">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#1c1c1f] text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-semibold border-b border-[#2d2d2d] w-16 text-center">Enable</th>
                  <th className="px-6 py-4 font-semibold border-b border-[#2d2d2d]">Model</th>
                  <th className="px-6 py-4 font-semibold border-b border-[#2d2d2d] w-48">Provider</th>
                  <th className="px-6 py-4 font-semibold border-b border-[#2d2d2d] w-32">Context Window</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d2d2d] text-gray-300">
                {allModels.map((m) => {
                  const isSelected = selectedModels.some(sel => sel.provider === m.providerId && sel.modelId === m.id);
                  return (
                    <tr key={`${m.providerId}-${m.id}`} className="hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-3 text-center">
                        <button
                          onClick={() => m.providerAvailable && handleToggleModel(m.providerId, m.id)}
                          disabled={!m.providerAvailable}
                          className={`rounded transition-colors ${!m.providerAvailable ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-sim-red" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-600" />
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-200">{m.name}</span>
                          {(m.isLocal || m.isProviderLocal) && (
                            <span className="px-1.5 py-0.5 rounded-md bg-sim-red/10 text-sim-red text-[9px] font-bold border border-sim-red/20 uppercase tracking-wider">Local</span>
                          )}
                          {!m.providerAvailable && (
                            <span className="px-1.5 py-0.5 rounded-md bg-gray-500/10 text-gray-400 text-[9px] font-bold border border-gray-500/20 uppercase tracking-wider">Disconnected</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500 font-mono mt-1">{m.id}</div>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-400">
                        {m.providerName}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-400 font-mono">
                        {(m.context / 1000).toFixed(0)}k
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="h-10 border-t border-[#2d2d2d] bg-[#161618] flex items-center justify-between px-6 text-[11px] text-gray-500 select-none shrink-0">
        <span>{selectedModels.length} models selected for AI Chat</span>
      </div>
    </div>
  );
};
