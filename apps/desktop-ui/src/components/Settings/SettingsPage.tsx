import React, { useState, useEffect, useCallback } from 'react';
import {
  Loader2, Trash2, RefreshCw, Eye, EyeOff, Globe, Check, Layers,
  CheckCircle2, AlertCircle, Plus,
} from 'lucide-react';
import controllerClient, { ProviderEntry, ProviderModelEntry } from '../../services/controller.client';

// ── Provider presets ─────────────────────────────────────────────────────────

type ProviderType = 'openai' | 'gemini' | 'openai-compatible' | 'nvidia' | 'groq' | 'openrouter' | 'anthropic' | 'deepseek' | 'togetherai';

interface ProviderPreset {
  type: ProviderType;
  name: string;
  baseUrl: string;
  docsUrl: string;
  color: string;
  description: string;
  builtinId?: string; // matches the id seeded in provider-db (groq, openai, etc.)
}

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  openai: {
    type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys', color: '#10a37f',
    description: 'GPT-4o, o1, o3-mini and more', builtinId: 'openai',
  },
  anthropic: {
    type: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys', color: '#d97757',
    description: 'Claude 3.5 Sonnet, Opus', builtinId: 'anthropic',
  },
  gemini: {
    type: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    docsUrl: 'https://aistudio.google.com/app/apikey', color: '#4285F4',
    description: 'Gemini 1.5 Pro and Flash', builtinId: 'gemini',
  },
  nvidia: {
    type: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1',
    docsUrl: 'https://developer.nvidia.com/nim', color: '#76b900',
    description: 'LLMs accelerated on NVIDIA', builtinId: 'nvidia',
  },
  groq: {
    type: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys', color: '#f55036',
    description: 'Ultra-fast LPU-powered inference', builtinId: 'groq',
  },
  openrouter: {
    type: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys', color: '#7c3aed',
    description: '200+ models from many providers', builtinId: 'openrouter',
  },
  deepseek: {
    type: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com', color: '#0ea5e9',
    description: 'DeepSeek Chat and Reasoner', builtinId: 'deepseek',
  },
  togetherai: {
    type: 'togetherai', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://api.together.ai/settings/api-keys', color: '#8b5cf6',
    description: 'Open-source models at scale', builtinId: 'togetherai',
  },
  'openai-compatible': {
    type: 'openai-compatible', name: 'Custom (OpenAI-compatible)', baseUrl: '',
    docsUrl: '', color: '#f97316',
    description: 'Any server that speaks the OpenAI API',
  },
};

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

// ── Add Provider Form ─────────────────────────────────────────────────────────

function ProviderForm({ onSaved, onCancel }: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type,    setType]    = useState<string>('groq');
  const [name,    setName]    = useState(PROVIDER_PRESETS['groq'].name);
  const [apiKey,  setApiKey]  = useState('');
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS['groq'].baseUrl);
  const [showKey, setShowKey] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const preset = PROVIDER_PRESETS[type] ?? PROVIDER_PRESETS['openai-compatible'];

  useEffect(() => {
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
  }, [type]);

  const handleSave = async () => {
    if (!apiKey.trim() && type !== 'openai-compatible') {
      setError('API key is required');
      return;
    }
    setSaving(true); setError('');
    try {
      const builtinId = preset.builtinId;
      if (builtinId) {
        // Built-in provider already exists in DB — just save the key
        await controllerClient.saveProviderKey(builtinId, apiKey.trim());
      } else {
        // Custom provider — create + save key
        const customId = `custom-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
        await controllerClient.addCustomProvider({
          id:       customId,
          name:     name.trim() || 'Custom Provider',
          type:     'custom',
          base_url: baseUrl.trim(),
          api_key:  apiKey.trim() || undefined,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border border-[#2d2d2d] rounded-xl p-5 bg-[#161618]">
      <h3 className="font-semibold text-gray-200">New Provider</h3>

      {/* Provider type grid */}
      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-2">Provider Type</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
            <button key={key} onClick={() => setType(key)}
              className={cn(
                'flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border text-left transition-all text-sm',
                type === key
                  ? 'border-blue-500/50 bg-blue-500/10 text-gray-200'
                  : 'border-[#2d2d2d] bg-[#09090b] text-gray-500 hover:border-[#3d3d3d] hover:bg-[#1a1a1c]',
              )}
            >
              <span className="font-semibold text-xs" style={{ color: p.color }}>{p.name}</span>
              <span className="text-[10px] leading-tight opacity-70 text-gray-400">{p.description}</span>
            </button>
          ))}
        </div>
      </div>

      {type === 'openai-compatible' && (
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">Display Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="My Local LLM"
            className="w-full bg-[#09090b] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50" />
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">
          API Key
          {preset.docsUrl && (
            <a href={preset.docsUrl} target="_blank" rel="noopener noreferrer"
              className="ml-2 normal-case text-blue-500/70 hover:text-blue-500 transition-colors">Get key ↗</a>
          )}
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'} value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="sk-..."
            className="w-full bg-[#09090b] border border-[#2d2d2d] rounded-lg px-3 py-2 pr-10 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono"
          />
          <button onClick={() => setShowKey(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {type === 'openai-compatible' && (
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">Base URL</label>
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="w-full bg-[#09090b] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono" />
        </div>
      )}

      {error && <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 px-3 py-2 rounded-lg">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border border-[#2d2d2d] text-gray-400 hover:bg-[#2d2d2d] transition-all">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add Provider
        </button>
      </div>
    </div>
  );
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, onRefresh }: { provider: ProviderEntry; onRefresh: () => void }) {
  const [fetching,  setFetching]  = useState(false);
  const [fetchMsg,  setFetchMsg]  = useState('');
  const [fetchErr,  setFetchErr]  = useState('');
  const [removing,  setRemoving]  = useState(false);

  const preset = Object.values(PROVIDER_PRESETS).find(p => p.builtinId === provider.id)
    ?? PROVIDER_PRESETS['openai-compatible'];

  const handleFetchModels = async () => {
    setFetching(true); setFetchErr(''); setFetchMsg('');
    try {
      const res = await controllerClient.fetchProviderModels(provider.id);
      setFetchMsg(`✓ ${res.count} models fetched`);
      onRefresh();
    } catch (e: any) {
      setFetchErr(e.message || 'Failed to fetch models');
    } finally {
      setFetching(false);
    }
  };

  const handleRemove = async () => {
    if (provider.is_builtin) {
      // For built-ins, just remove the API key
      if (!confirm(`Remove API key for ${provider.name}?`)) return;
      setRemoving(true);
      try {
        await controllerClient.removeProviderKey(provider.id);
        onRefresh();
      } finally { setRemoving(false); }
    } else {
      if (!confirm(`Delete provider "${provider.name}"? This cannot be undone.`)) return;
      setRemoving(true);
      try {
        await controllerClient.deleteCustomProvider(provider.id);
        onRefresh();
      } finally { setRemoving(false); }
    }
  };

  return (
    <div className="border border-[#2d2d2d] rounded-xl overflow-hidden bg-[#161618]">
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white font-bold text-xs"
          style={{ background: preset.color }}>
          {provider.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-200 truncate">{provider.name}</span>
            {provider.has_key
              ? <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                  <CheckCircle2 size={9} /> Connected
                </span>
              : <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-500/10 text-gray-500 border border-gray-500/20">
                  <AlertCircle size={9} /> No key
                </span>
            }
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {provider.enabled_count}/{provider.model_count} models enabled
          </p>
          {fetchErr && <p className="text-red-400 text-[10px] mt-1">{fetchErr}</p>}
          {fetchMsg && <p className="text-green-400 text-[10px] mt-1">{fetchMsg}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {provider.has_key && (
            <button onClick={handleFetchModels} disabled={fetching}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[#2d2d2d] hover:bg-[#2d2d2d] text-gray-400 hover:text-gray-200 transition-all disabled:opacity-60">
              {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {fetching ? 'Fetching…' : 'Fetch Models'}
            </button>
          )}
          <button onClick={handleRemove} disabled={removing}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-transparent text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-all">
            {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Models Tab ────────────────────────────────────────────────────────────────

function ModelsTab({ providers }: { providers: ProviderEntry[] }) {
  const [modelsMap,   setModelsMap]   = useState<Record<string, ProviderModelEntry[]>>({});
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const connectedProviders = providers.filter(p => p.has_key && p.model_count > 0);

  const loadModels = useCallback(async () => {
    const entries = await Promise.all(
      connectedProviders.map(async p => {
        const models = await controllerClient.getProviderModels(p.id).catch(() => [] as ProviderModelEntry[]);
        return [p.id, models] as const;
      })
    );
    setModelsMap(Object.fromEntries(entries));
  }, [connectedProviders.map(p => p.id).join(',')]);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleToggle = async (providerId: string, modelId: string, currentlyEnabled: boolean) => {
    const key = `${providerId}::${modelId}`;
    setTogglingKey(key);
    try {
      await controllerClient.toggleProviderModel(providerId, modelId, !currentlyEnabled);
      setModelsMap(prev => ({
        ...prev,
        [providerId]: (prev[providerId] ?? []).map(m =>
          m.model_id !== modelId ? m : { ...m, is_enabled: currentlyEnabled ? 0 : 1 }
        ),
      }));
    } finally { setTogglingKey(null); }
  };

  if (connectedProviders.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-[#2d2d2d] rounded-xl text-gray-500 bg-[#161618]/50">
        <Layers size={32} className="mx-auto mb-3 opacity-20" />
        <p className="text-sm font-medium">No providers connected</p>
        <p className="text-xs mt-1">Add a provider in <strong className="text-gray-400">AI Providers</strong>, then click Fetch Models</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-100">AI Models</h1>
        <p className="text-sm text-gray-400 mt-0.5">Enable models to use them in the chat sidebar</p>
      </div>

      {connectedProviders.map(provider => {
        const preset  = Object.values(PROVIDER_PRESETS).find(p => p.builtinId === provider.id) ?? PROVIDER_PRESETS['openai-compatible'];
        const models  = modelsMap[provider.id] ?? [];

        return (
          <div key={provider.id} className="border border-[#2d2d2d] rounded-xl overflow-hidden bg-[#161618]">
            <div className="px-4 py-3 bg-[#1a1a1c] border-b border-[#2d2d2d] flex items-center gap-2">
              <span className="font-semibold text-sm text-gray-200">{provider.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                style={{ color: preset.color, background: `${preset.color}22` }}>
                {provider.type}
              </span>
              <span className="ml-auto text-[11px] text-gray-500">{provider.enabled_count} enabled</span>
            </div>
            {models.length === 0 ? (
              <p className="text-center text-[11px] text-gray-600 py-6">
                No models fetched — go to AI Providers and click Fetch Models
              </p>
            ) : (
              <div className="max-h-80 overflow-y-auto p-2 custom-scrollbar">
                {models.map(m => {
                  const enabled    = m.is_enabled === 1;
                  const toggleKey  = `${provider.id}::${m.model_id}`;
                  const isToggling = togglingKey === toggleKey;
                  return (
                    <label key={m.model_id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2d2d2d]/50 cursor-pointer transition-all group">
                      <button
                        onClick={() => handleToggle(provider.id, m.model_id, enabled)}
                        disabled={isToggling}
                        className={cn(
                          'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all',
                          enabled ? 'bg-blue-600 border-blue-600' : 'border-[#3d3d3d] group-hover:border-blue-500/50',
                        )}
                      >
                        {isToggling
                          ? <Loader2 size={8} className="animate-spin text-white" />
                          : enabled && <Check size={10} className="text-white" />
                        }
                      </button>
                      <span className="text-xs font-mono text-gray-300 truncate flex-1">{m.model_name || m.model_id}</span>
                      <span className="text-[10px] text-gray-600 font-mono truncate hidden group-hover:block">{m.model_id}</span>
                      {enabled && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0"
                          style={{ color: preset.color, background: `${preset.color}22` }}>
                          Active
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────

export function SettingsPage() {
  const [activeTab,       setActiveTab]       = useState<'providers' | 'models'>('providers');
  const [providers,       setProviders]       = useState<ProviderEntry[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [loading,         setLoading]         = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await controllerClient.listProviders();
      setProviders(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connected = providers.filter(p => p.has_key).length;

  // Only show providers that have a key (connected) in the providers list — all 8 always exist in DB
  const connectedProviders = providers.filter(p => p.has_key);
  const allProviders       = providers;

  return (
    <div className="flex h-full w-full bg-[#09090b] overflow-hidden">
      {/* Sidebar nav */}
      <nav className="w-56 shrink-0 flex flex-col border-r border-[#2d2d2d] bg-[#161618] px-3 py-4 gap-1">
        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-3 mb-1">Settings</p>
        {(['providers', 'models'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left capitalize',
              activeTab === tab
                ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                : 'text-gray-400 hover:bg-[#2d2d2d] hover:text-gray-200 border border-transparent',
            )}
          >
            {tab === 'providers' ? <Globe size={15} /> : <Layers size={15} />}
            {tab === 'providers' ? 'AI Providers' : 'Models'}
          </button>
        ))}
      </nav>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        <div className="mx-auto px-6 py-8 space-y-6 max-w-2xl">
          {activeTab === 'providers' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-gray-100">AI Providers</h1>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {connected > 0 ? `${connected} provider${connected > 1 ? 's' : ''} connected` : 'Connect a provider to get started'}
                  </p>
                </div>
                <button onClick={() => setShowAddProvider(true)} disabled={showAddProvider}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all font-medium disabled:opacity-40">
                  Add Provider
                </button>
              </div>

              {showAddProvider && (
                <ProviderForm
                  onSaved={() => { setShowAddProvider(false); load(); }}
                  onCancel={() => setShowAddProvider(false)}
                />
              )}

              {loading ? (
                <div className="flex items-center justify-center py-12 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading providers…
                </div>
              ) : (
                <div className="space-y-3">
                  {connectedProviders.map(p => (
                    <ProviderCard key={p.id} provider={p} onRefresh={load} />
                  ))}
                  {connectedProviders.length === 0 && !showAddProvider && (
                    <div className="text-center py-12 border border-dashed border-[#2d2d2d] rounded-xl text-gray-500 bg-[#161618]/50">
                      <Globe size={32} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium">No providers connected</p>
                      <p className="text-xs mt-1">Click <strong className="text-gray-400">Add Provider</strong> to connect your first API</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'models' && (
            <ModelsTab providers={allProviders} />
          )}
        </div>
      </main>
    </div>
  );
}
