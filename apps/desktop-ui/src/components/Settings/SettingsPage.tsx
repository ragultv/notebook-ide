import React, { useState, useEffect } from 'react';
import { 
  Loader2, Save, Trash2, RefreshCw, Eye, EyeOff, Globe, Check, Layers 
} from 'lucide-react';
import { controllerClient, ProviderConfig } from '../../services/controller.client';

type ProviderType = 'openai' | 'gemini' | 'openai-compatible' | 'nvidia' | 'groq' | 'openrouter' | 'anthropic';

interface ProviderPreset {
  type: ProviderType;
  name: string;
  baseUrl: string;
  docsUrl: string;
  color: string;
  description: string;
}

const PROVIDER_PRESETS: Record<ProviderType, ProviderPreset> = {
  openai: {
    type: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys', color: '#10a37f', description: 'GPT-4o, o1, o3-mini and more',
  },
  anthropic: {
    type: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys', color: '#d97757', description: 'Claude 3.5 Sonnet, Opus',
  },
  gemini: {
    type: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    docsUrl: 'https://aistudio.google.com/app/apikey', color: '#4285F4', description: 'Gemini 1.5 Pro and Flash',
  },
  nvidia: {
    type: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1',
    docsUrl: 'https://developer.nvidia.com/nim', color: '#76b900', description: 'LLMs accelerated on NVIDIA',
  },
  groq: {
    type: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys', color: '#f55036', description: 'Ultra-fast LPU-powered inference',
  },
  openrouter: {
    type: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys', color: '#7c3aed', description: '200+ models from many providers',
  },
  'openai-compatible': {
    type: 'openai-compatible', name: 'Custom (OpenAI-compatible)', baseUrl: '',
    docsUrl: '', color: '#f97316', description: 'Any server that speaks the OpenAI API',
  },
};

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

function ProviderBadge({ type }: { type: ProviderType }) {
  const preset = PROVIDER_PRESETS[type] || PROVIDER_PRESETS['openai-compatible'];
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ color: preset.color, background: `${preset.color}22` }}
    >
      {preset.name}
    </span>
  );
}

function ProviderForm({ initial, onSave, onCancel }: {
  initial?: Partial<ProviderConfig>;
  onSave: (p: ProviderConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = Boolean(initial?.id);
  const [type, setType] = useState<ProviderType>((initial?.type as ProviderType) ?? 'openai');
  const [name, setName] = useState(initial?.name ?? PROVIDER_PRESETS[initial?.type as ProviderType ?? 'openai'].name);
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? PROVIDER_PRESETS[initial?.type as ProviderType ?? 'openai'].baseUrl);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const preset = PROVIDER_PRESETS[type] || PROVIDER_PRESETS['openai-compatible'];

  useEffect(() => {
    if (!isEdit) {
      setName(PROVIDER_PRESETS[type].name);
      setBaseUrl(PROVIDER_PRESETS[type].baseUrl);
    }
  }, [type, isEdit]);

  const handleSave = async () => {
    if (!apiKey.trim() && type !== 'openai-compatible' && type !== 'nvidia' && apiKey !== 'saved') {
      setError('API key is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = initial?.id ?? `${type}-${Date.now()}`;
      await onSave({
        id,
        name: name.trim() || preset.name,
        type,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || preset.baseUrl,
        enabled: initial?.enabled ?? true,
        enabledModelIds: initial?.enabledModelIds ?? [],
        availableModelIds: initial?.availableModelIds ?? [],
      });
    } catch (e: any) {
      setError(e.message || 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border border-[#2d2d2d] rounded-xl p-5 bg-[#161618]">
      <h3 className="font-semibold text-gray-200">{isEdit ? 'Edit Provider' : 'New Provider'}</h3>

      {!isEdit && (
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-2">Provider Type</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map(t => {
              const p = PROVIDER_PRESETS[t];
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    'flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border text-left transition-all text-sm',
                    type === t
                      ? 'border-blue-500/50 bg-blue-500/10 text-gray-200'
                      : 'border-[#2d2d2d] bg-[#09090b] text-gray-500 hover:border-[#3d3d3d] hover:bg-[#1a1a1c]'
                  )}
                >
                  <span className="font-semibold text-xs" style={{ color: p.color }}>{p.name}</span>
                  <span className="text-[10px] leading-tight opacity-70 text-gray-400">{p.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">Display Name</label>
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder={preset.name}
          className="w-full bg-[#09090b] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">
          API Key
          {preset.docsUrl && (
            <a href={preset.docsUrl} target="_blank" rel="noopener noreferrer" className="ml-2 normal-case text-blue-500/70 hover:text-blue-500 transition-colors">
              Get key ↗
            </a>
          )}
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={apiKey === 'saved' ? '•••••••••••••••• (Saved)' : 'sk-...'}
            className="w-full bg-[#09090b] border border-[#2d2d2d] rounded-lg px-3 py-2 pr-10 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono"
          />
          <button onClick={() => setShowKey(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {(type === 'openai-compatible' || type === 'nvidia' || type === 'groq' || type === 'openrouter') && (
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-widest block mb-1.5">Base URL</label>
          <input
            value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={preset.baseUrl || 'https://...'}
            className="w-full bg-[#09090b] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono"
          />
        </div>
      )}

      {error && <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 px-3 py-2 rounded-lg">{error}</p>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-[#2d2d2d] text-gray-400 hover:bg-[#2d2d2d] transition-all">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all flex items-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isEdit ? 'Save Changes' : 'Add Provider'}
        </button>
      </div>
    </div>
  );
}

function ProviderCard({ provider, onUpdate, onDelete }: { provider: ProviderConfig; onUpdate: (p: ProviderConfig) => Promise<void>; onDelete: (id: string) => Promise<void>; }) {
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [deleting, setDeleting] = useState(false);
  
  const preset = PROVIDER_PRESETS[provider.type as ProviderType] || PROVIDER_PRESETS['openai-compatible'];
  const enabledModelIds = Array.isArray(provider.enabledModelIds) ? provider.enabledModelIds : [];

  const handleFetchModels = async () => {
    setFetching(true); setFetchError('');
    try {
      const models = await controllerClient.fetchProviderModels(provider.id);
      await onUpdate({
        ...provider,
        availableModelIds: Array.isArray(models) ? models.filter(Boolean) : [],
        lastFetched: new Date().toISOString(),
      });
    } catch (e: any) {
      setFetchError(e.message || 'Failed to fetch models');
    } finally {
      setFetching(false);
    }
  };

  const toggleProvider = async () => {
    try {
      await onUpdate({ ...provider, enabled: !provider.enabled });
    } catch (e) {
      console.error('Failed to toggle provider enabled state:', e);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove provider "${provider.name}"?`)) return;
    setDeleting(true);
    try { await onDelete(provider.id); } finally { setDeleting(false); }
  };

  return (
    <div className={cn('border rounded-xl overflow-hidden transition-all', provider.enabled ? 'border-[#2d2d2d]' : 'border-[#2d2d2d]/40 opacity-60')}>
      <div className="flex items-center gap-3 px-4 py-4 bg-[#161618]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white font-bold text-xs" style={{ background: preset.color }}>
          {provider.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-200 truncate">{provider.name}</span>
            <ProviderBadge type={provider.type as ProviderType} />
          </div>
          <p className="text-xs text-gray-500">
            {enabledModelIds.length} model{enabledModelIds.length !== 1 ? 's' : ''} enabled
            {provider.lastFetched && (
              (() => {
                const date = new Date(provider.lastFetched);
                return isNaN(date.getTime()) ? '' : ` · fetched ${date.toLocaleDateString()}`;
              })()
            )}
          </p>
          {fetchError && <p className="text-red-400 text-[10px] mt-1">{fetchError}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleFetchModels} disabled={fetching} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[#2d2d2d] hover:bg-[#2d2d2d] text-gray-400 hover:text-gray-200 transition-all disabled:opacity-60">
            {fetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {fetching ? 'Fetching…' : 'Fetch Models'}
          </button>
          <button
            onClick={toggleProvider}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border w-20 text-center', provider.enabled ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'border-[#2d2d2d] text-gray-500 hover:border-[#3d3d3d]')}
          >
            {provider.enabled ? 'Enabled' : 'Disabled'}
          </button>
          <button onClick={handleDelete} disabled={deleting} className="w-8 h-8 rounded-lg flex items-center justify-center border border-transparent text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-all">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelsTab({ providers, onUpdate }: { providers: ProviderConfig[]; onUpdate: (p: ProviderConfig) => Promise<void>; }) {
  const toggleModel = async (provider: ProviderConfig, modelId: string) => {
    const enabledModelIds = Array.isArray(provider.enabledModelIds) ? provider.enabledModelIds : [];
    const already = enabledModelIds.includes(modelId);
    const next = already ? enabledModelIds.filter(m => m !== modelId) : [...enabledModelIds, modelId];
    try {
      await onUpdate({ ...provider, enabledModelIds: next });
    } catch (e) {
      console.error('Failed to update provider model selection:', e);
    }
  };

  const enabledProviders = providers.filter(p => p.enabled && Array.isArray(p.availableModelIds) && p.availableModelIds.length > 0);

  if (providers.length === 0) {
     return (
        <div className="text-center py-12 border border-dashed border-[#2d2d2d] rounded-xl text-gray-500 bg-[#161618]/50">
          <Layers size={32} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No providers or models available</p>
          <p className="text-xs mt-1">Add a provider and fetch models first</p>
        </div>
     );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-100">AI Models</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Enable models to use them in the chat sidebar
          </p>
        </div>
      </div>
      
      {enabledProviders.length === 0 ? (
        <div className="text-center py-12 border border-[#2d2d2d] rounded-xl text-gray-500 bg-[#161618]/50">
          <p className="text-sm font-medium">No models fetched</p>
          <p className="text-xs mt-1">Go to AI Providers and click 'Fetch Models'</p>
        </div>
      ) : (
        enabledProviders.map(provider => {
          const preset = PROVIDER_PRESETS[provider.type as ProviderType] || PROVIDER_PRESETS['openai-compatible'];
          const availableModelIds = provider.availableModelIds || [];
          const enabledModelIds = provider.enabledModelIds || [];

          return (
            <div key={provider.id} className="border border-[#2d2d2d] rounded-xl overflow-hidden bg-[#161618]">
              <div className="px-4 py-3 bg-[#1a1a1c] border-b border-[#2d2d2d] flex items-center gap-2">
                <span className="font-semibold text-sm text-gray-200">{provider.name}</span>
                <ProviderBadge type={provider.type as ProviderType} />
              </div>
              <div className="max-h-80 overflow-y-auto p-2 custom-scrollbar">
                {availableModelIds.map(modelId => {
                  const enabled = enabledModelIds.includes(modelId);
                  return (
                    <label key={modelId} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#2d2d2d]/50 cursor-pointer transition-all group">
                      <div className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all', enabled ? 'bg-blue-600 border-blue-600' : 'border-[#3d3d3d] group-hover:border-blue-500/50')}>
                        {enabled && <Check size={10} className="text-white" />}
                      </div>
                      <input type="checkbox" checked={enabled} onChange={() => toggleModel(provider, modelId)} className="sr-only" />
                      <span className="text-xs font-mono text-gray-300 truncate flex-1">{modelId}</span>
                      {enabled && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ color: preset.color, background: `${preset.color}22` }}>
                          Active
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'providers' | 'models'>('providers');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);

  useEffect(() => {
    controllerClient.loadProviders().then(setProviders);
  }, []);

  const saveProvider = async (p: ProviderConfig) => {
    const saved = await controllerClient.saveProvider(p);
    setProviders(prev => {
      const idx = prev.findIndex(x => x.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setShowAddProvider(false);
  };

  const removeProvider = async (id: string) => {
    await controllerClient.deleteProvider(id);
    setProviders(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="flex h-full w-full bg-[#09090b] overflow-hidden">
      <nav className="w-56 shrink-0 flex flex-col border-r border-[#2d2d2d] bg-[#161618] px-3 py-4 gap-1">
        <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-3 mb-1">
          Settings
        </p>

        <button 
          onClick={() => setActiveTab('providers')}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left",
            activeTab === 'providers' 
              ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" 
              : "text-gray-400 hover:bg-[#2d2d2d] hover:text-gray-200 border border-transparent"
          )}
        >
          <Globe size={15} />
          AI Providers
        </button>
        
        <button 
          onClick={() => setActiveTab('models')}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left",
            activeTab === 'models' 
              ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" 
              : "text-gray-400 hover:bg-[#2d2d2d] hover:text-gray-200 border border-transparent"
          )}
        >
          <Layers size={15} />
          Models
        </button>
      </nav>

      <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        <div className="mx-auto px-6 py-8 space-y-6 max-w-2xl">
          {activeTab === 'providers' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-gray-100">AI Providers</h1>
                  <p className="text-sm text-gray-400 mt-0.5">
                    Connect external providers to fetch models
                  </p>
                </div>
                <button
                  onClick={() => setShowAddProvider(true)}
                  className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-all font-medium"
                >
                  Add Provider
                </button>
              </div>

              {showAddProvider && (
                <ProviderForm
                  onSave={saveProvider}
                  onCancel={() => setShowAddProvider(false)}
                />
              )}

              <div className="space-y-4">
                {providers.map(provider => (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    onUpdate={saveProvider}
                    onDelete={removeProvider}
                  />
                ))}
                {providers.length === 0 && !showAddProvider && (
                  <div className="text-center py-12 border border-dashed border-[#2d2d2d] rounded-xl text-gray-500 bg-[#161618]/50">
                    <Globe size={32} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">No providers configured</p>
                    <p className="text-xs mt-1">Add a provider to connect your API</p>
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'models' && (
            <ModelsTab providers={providers} onUpdate={saveProvider} />
          )}
        </div>
      </main>
    </div>
  );
}
