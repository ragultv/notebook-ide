import React, { useState, useEffect } from 'react';
import { Key, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { controllerClient, ProviderInfo } from '../../services/controller.client';

export const ConnectProviderView: React.FC = () => {
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [savingFor, setSavingFor] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await controllerClient.getProviders();
      setProviders(data.providers);
    } catch (error) {
      console.error("Failed to load providers", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveKey = async (providerId: string) => {
    const key = apiKeys[providerId];
    if (!key) return;
    setSavingFor(providerId);
    try {
      await controllerClient.setProviderApiKey(providerId, key);
      await loadData(); // Reload to update status
      setApiKeys(prev => ({ ...prev, [providerId]: '' })); // Clear input
    } catch (e) {
      console.error(e);
    } finally {
      setSavingFor(null);
    }
  };

  const cloudProviders = Object.entries(providers).filter(([_, p]) => !p.isLocal);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#09090b]">
      {/* Header */}
      <div className="h-16 border-b border-[#2d2d2d] flex items-center px-6 shrink-0 bg-[#09090b]">
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">Connect Provider</h1>
          <p className="text-[11px] text-gray-500">Configure API keys for external cloud models.</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">Loading configurations...</div>
        ) : (
          <div className="max-w-3xl flex flex-col gap-6">
            {cloudProviders.map(([providerId, provider]) => (
              <div key={providerId} className="bg-[#161618] border border-[#2d2d2d] rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${provider.available ? 'bg-green-500/10 text-green-500' : 'bg-gray-500/10 text-gray-400'}`}>
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-200">{provider.name}</h3>
                      <p className="text-xs text-gray-500 font-mono">ID: {providerId}</p>
                    </div>
                  </div>
                  <div>
                    {provider.available ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-500 text-[10px] font-bold uppercase tracking-wider">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-500/10 border border-gray-500/20 text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                        <AlertCircle className="w-3.5 h-3.5" /> Disconnected
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <input
                    type="password"
                    placeholder={`Enter API Key for ${provider.name}`}
                    value={apiKeys[providerId] || ''}
                    onChange={(e) => setApiKeys(prev => ({ ...prev, [providerId]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(providerId)}
                    className="flex-1 bg-[#0e0e11] border border-[#2d2d2d] rounded-lg px-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-sim-red/50 transition-colors placeholder-gray-600 font-mono"
                  />
                  <button
                    onClick={() => handleSaveKey(providerId)}
                    disabled={!apiKeys[providerId] || savingFor === providerId}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                      apiKeys[providerId] && savingFor !== providerId
                        ? 'bg-sim-red hover:bg-sim-red/80 text-white' 
                        : 'bg-[#2b2b2e] text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {savingFor === providerId ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save Key
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
