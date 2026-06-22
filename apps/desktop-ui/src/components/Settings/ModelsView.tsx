import React, { useState, useEffect, useCallback } from 'react';
import { CheckSquare, Square, Search, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import controllerClient, { ProviderEntry, ProviderModelEntry } from '../../services/controller.client';

interface ModelsViewProps {
  onModelsChanged?: () => void;
}

interface ProviderWithModels extends ProviderEntry {
  models: ProviderModelEntry[];
}

export const ModelsView: React.FC<ModelsViewProps> = ({ onModelsChanged }) => {
  const [providers,    setProviders]    = useState<ProviderWithModels[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [searchQuery,  setSearchQuery]  = useState('');
  const [filterTab,    setFilterTab]    = useState<'all' | 'enabled'>('all');
  const [togglingKey,  setTogglingKey]  = useState<string | null>(null);
  const [fetchingId,   setFetchingId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const pList = await controllerClient.listProviders();
      // Only providers with API keys have models worth showing
      const connected = pList.filter(p => p.has_key && p.model_count > 0);
      const withModels = await Promise.all(
        connected.map(async p => {
          const models = await controllerClient.getProviderModels(p.id).catch(() => [] as ProviderModelEntry[]);
          return { ...p, models };
        })
      );
      setProviders(withModels);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = useCallback(async (providerId: string, modelId: string, currentlyEnabled: boolean) => {
    const key = `${providerId}::${modelId}`;
    setTogglingKey(key);
    try {
      await controllerClient.toggleProviderModel(providerId, modelId, !currentlyEnabled);
      // Optimistic update
      setProviders(prev => prev.map(p =>
        p.id !== providerId ? p : {
          ...p,
          models: p.models.map(m =>
            m.model_id !== modelId ? m : { ...m, is_enabled: currentlyEnabled ? 0 : 1 }
          ),
          enabled_count: currentlyEnabled ? p.enabled_count - 1 : p.enabled_count + 1,
        }
      ));
      onModelsChanged?.();
    } catch { /* silent */ }
    finally { setTogglingKey(null); }
  }, [onModelsChanged]);

  const handleFetchModels = useCallback(async (providerId: string) => {
    setFetchingId(providerId);
    try {
      await controllerClient.fetchProviderModels(providerId);
      await load();
    } finally {
      setFetchingId(null);
    }
  }, [load]);

  // Flatten models for table view
  const allRows = providers.flatMap(p =>
    p.models
      .filter(m => {
        if (filterTab === 'enabled' && !m.is_enabled) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return m.model_name.toLowerCase().includes(q) || m.model_id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
        }
        return true;
      })
      .map(m => ({ ...m, provider: p }))
  );

  const totalEnabled = providers.reduce((acc, p) => acc + p.enabled_count, 0);
  const totalModels  = providers.reduce((acc, p) => acc + p.model_count, 0);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#09090b]">
      {/* Header / Toolbar */}
      <div className="h-16 border-b border-[#2d2d2d] flex items-center px-6 gap-4 shrink-0 bg-[#09090b]">
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">Models</h1>
          <p className="text-[11px] text-gray-500">Enable models to use them in the AI chat.</p>
        </div>

        <div className="flex-1" />

        {/* Filter tabs */}
        <div className="flex items-center bg-[#161618] rounded-lg p-1 border border-[#2d2d2d]">
          {(['all', 'enabled'] as const).map(tab => (
            <button key={tab} onClick={() => setFilterTab(tab)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${filterTab === tab ? 'bg-[#2b2b2e] text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}>
              {tab === 'enabled' ? `Enabled (${totalEnabled})` : 'All'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input type="text" placeholder="Search models…" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#161618] border border-[#2d2d2d] rounded-lg pl-9 pr-4 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-[#444] placeholder-gray-600" />
        </div>
      </div>

      {/* Model List */}
      <div className="flex-1 overflow-auto custom-scrollbar p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading models…
          </div>
        ) : providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <AlertCircle className="w-10 h-10 opacity-20" />
            <p className="text-sm">No connected providers with models.</p>
            <p className="text-xs text-gray-600">Go to <strong className="text-gray-400">Connect Provider</strong>, add an API key, then click <strong className="text-gray-400">Fetch Models</strong>.</p>
          </div>
        ) : allRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <AlertCircle className="w-10 h-10 opacity-20" />
            <p>No models match your filter.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {providers
              .filter(p => p.models.some(m => {
                if (filterTab === 'enabled' && !m.is_enabled) return false;
                if (searchQuery) {
                  const q = searchQuery.toLowerCase();
                  return m.model_name.toLowerCase().includes(q) || m.model_id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
                }
                return true;
              }))
              .map(provider => {
                const visibleModels = provider.models.filter(m => {
                  if (filterTab === 'enabled' && !m.is_enabled) return false;
                  if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    return m.model_name.toLowerCase().includes(q) || m.model_id.toLowerCase().includes(q) || provider.name.toLowerCase().includes(q);
                  }
                  return true;
                });
                return (
                  <div key={provider.id}>
                    {/* Provider header */}
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-sm font-semibold text-gray-300">{provider.name}</h3>
                      <span className="text-[11px] text-gray-600 font-mono">{provider.enabled_count}/{provider.model_count} enabled</span>
                      <button
                        onClick={() => handleFetchModels(provider.id)}
                        disabled={fetchingId === provider.id}
                        className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
                      >
                        {fetchingId === provider.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <RefreshCw className="w-3 h-3" />}
                        Refresh models
                      </button>
                    </div>

                    {/* Models table */}
                    <div className="rounded-xl border border-[#2d2d2d] overflow-hidden bg-[#161618]">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-[#1c1c1f] text-gray-500 text-[10px] uppercase tracking-wider">
                          <tr>
                            <th className="px-5 py-3 font-semibold border-b border-[#2d2d2d] w-12 text-center">On</th>
                            <th className="px-5 py-3 font-semibold border-b border-[#2d2d2d]">Model</th>
                            <th className="px-5 py-3 font-semibold border-b border-[#2d2d2d] w-32 text-right">Context</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#232325] text-gray-300">
                          {visibleModels.map(m => {
                            const toggleKey  = `${provider.id}::${m.model_id}`;
                            const isEnabled  = m.is_enabled === 1;
                            const isToggling = togglingKey === toggleKey;
                            return (
                              <tr key={m.model_id} className="hover:bg-white/3 transition-colors group">
                                <td className="px-5 py-2.5 text-center">
                                  <button
                                    onClick={() => handleToggle(provider.id, m.model_id, isEnabled)}
                                    disabled={isToggling}
                                    className="disabled:opacity-40 transition-colors"
                                  >
                                    {isToggling
                                      ? <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                                      : isEnabled
                                        ? <CheckSquare className="w-4 h-4 text-blue-400" />
                                        : <Square className="w-4 h-4 text-gray-600 hover:text-gray-400" />
                                    }
                                  </button>
                                </td>
                                <td className="px-5 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-200 leading-tight">{m.model_name || m.model_id}</span>
                                    {isEnabled && (
                                      <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[9px] font-bold border border-blue-500/20 uppercase tracking-wider">Active</span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-gray-600 font-mono mt-0.5">{m.model_id}</div>
                                </td>
                                <td className="px-5 py-2.5 text-right text-xs text-gray-500 font-mono">
                                  {m.context_length > 0 ? `${(m.context_length / 1000).toFixed(0)}k` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            }
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="h-10 border-t border-[#2d2d2d] bg-[#161618] flex items-center justify-between px-6 text-[11px] text-gray-500 select-none shrink-0">
        <span>{totalEnabled} models enabled for AI chat · {totalModels} total fetched</span>
      </div>
    </div>
  );
};
