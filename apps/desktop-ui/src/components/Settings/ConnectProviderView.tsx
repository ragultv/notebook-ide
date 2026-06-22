import React, { useState, useEffect, useCallback } from 'react';
import { Key, RefreshCw, CheckCircle2, AlertCircle, Loader2, Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import controllerClient, { ProviderEntry } from '../../services/controller.client';

const PROVIDER_ICONS: Record<string, string> = {
  nvidia:     '🟢',
  groq:       '⚡',
  openai:     '🔵',
  anthropic:  '🟠',
  gemini:     '💎',
  deepseek:   '🐋',
  openrouter: '🔀',
  togetherai: '🤝',
  custom:     '🔧',
};

const PROVIDER_DOCS: Record<string, string> = {
  nvidia:     'https://build.nvidia.com',
  groq:       'https://console.groq.com',
  openai:     'https://platform.openai.com/api-keys',
  anthropic:  'https://console.anthropic.com',
  gemini:     'https://aistudio.google.com/app/apikey',
  deepseek:   'https://platform.deepseek.com',
  openrouter: 'https://openrouter.ai/keys',
  togetherai: 'https://api.together.ai/settings/api-keys',
};

interface ProviderCardProps {
  provider: ProviderEntry;
  onRefresh: () => void;
}

function ProviderCard({ provider, onRefresh }: ProviderCardProps) {
  const [apiKey,    setApiKey]    = useState('');
  const [saving,    setSaving]    = useState(false);
  const [fetching,  setFetching]  = useState(false);
  const [removing,  setRemoving]  = useState(false);
  const [expanded,  setExpanded]  = useState(!provider.has_key);
  const [error,     setError]     = useState('');
  const [fetchMsg,  setFetchMsg]  = useState('');

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true); setError('');
    try {
      await controllerClient.saveProviderKey(provider.id, apiKey.trim());
      setApiKey('');
      setExpanded(false);
      onRefresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save key');
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemoveKey = useCallback(async () => {
    setRemoving(true); setError('');
    try {
      await controllerClient.removeProviderKey(provider.id);
      onRefresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove key');
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  const handleFetchModels = useCallback(async () => {
    setFetching(true); setError(''); setFetchMsg('');
    try {
      const res = await controllerClient.fetchProviderModels(provider.id);
      setFetchMsg(`✓ Fetched ${res.count} models`);
      onRefresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to fetch models');
    } finally {
      setFetching(false);
    }
  }, [provider.id, onRefresh]);

  const icon = PROVIDER_ICONS[provider.type] ?? PROVIDER_ICONS['custom'];
  const docs = PROVIDER_DOCS[provider.id];

  return (
    <div className="bg-[#161618] border border-[#2d2d2d] rounded-xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-white/2 transition-colors select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-xl w-8 text-center">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-200 text-sm">{provider.name}</span>
            {provider.is_builtin && (
              <span className="text-[9px] bg-white/5 text-white/30 px-1.5 py-0.5 rounded font-mono uppercase">built-in</span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 font-mono mt-0.5">{provider.base_url}</div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {provider.has_key ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-[10px] font-bold uppercase tracking-wider">
              <CheckCircle2 className="w-3 h-3" /> Connected
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-500/10 border border-gray-500/20 text-gray-500 text-[10px] font-bold uppercase tracking-wider">
              <AlertCircle className="w-3 h-3" /> No key
            </div>
          )}
          {provider.model_count > 0 && (
            <span className="text-[11px] text-gray-500">{provider.enabled_count}/{provider.model_count} enabled</span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-white/20" /> : <ChevronDown className="w-4 h-4 text-white/20" />}
        </div>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div className="border-t border-[#2d2d2d] px-5 py-4 space-y-3">
          {/* API key input */}
          <div className="flex gap-2">
            <input
              type="password"
              placeholder={provider.has_key ? '••••••••  (key saved — paste new to replace)' : `Paste ${provider.name} API key here`}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
              className="flex-1 bg-[#0e0e11] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#444] transition-colors placeholder-gray-600 font-mono"
            />
            <button
              onClick={handleSaveKey}
              disabled={!apiKey.trim() || saving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium text-sm transition-colors bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
              Save
            </button>
          </div>

          {/* Actions row */}
          <div className="flex items-center gap-2">
            {provider.has_key && (
              <>
                <button
                  onClick={handleFetchModels}
                  disabled={fetching}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/8 text-gray-300 transition-colors disabled:opacity-40"
                >
                  {fetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Fetch Models
                </button>
                <button
                  onClick={handleRemoveKey}
                  disabled={removing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                >
                  {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Remove key
                </button>
              </>
            )}
            {docs && (
              <a href={docs} target="_blank" rel="noopener noreferrer"
                className="ml-auto text-[11px] text-blue-400/50 hover:text-blue-400 transition-colors">
                Get API key →
              </a>
            )}
          </div>

          {fetchMsg && <p className="text-[11px] text-green-400">{fetchMsg}</p>}
          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Add custom provider form ───────────────────────────────────────────────────

function AddCustomProvider({ onAdded }: { onAdded: () => void }) {
  const [open,    setOpen]    = useState(false);
  const [id,      setId]      = useState('');
  const [name,    setName]    = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey,  setApiKey]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const handleAdd = async () => {
    if (!id.trim() || !name.trim() || !baseUrl.trim()) {
      setError('ID, Name, and Base URL are required');
      return;
    }
    setSaving(true); setError('');
    try {
      await controllerClient.addCustomProvider({ id: id.trim(), name: name.trim(), type: 'custom', base_url: baseUrl.trim(), api_key: apiKey.trim() || undefined });
      setId(''); setName(''); setBaseUrl(''); setApiKey(''); setOpen(false);
      onAdded();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to add provider');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full px-5 py-3 rounded-xl border border-dashed border-[#2d2d2d] text-gray-500 hover:text-gray-300 hover:border-[#444] transition-colors text-sm"
      >
        <Plus className="w-4 h-4" /> Add custom provider (OpenAI-compatible)
      </button>
    );
  }

  return (
    <div className="bg-[#161618] border border-[#2d2d2d] rounded-xl px-5 py-4 space-y-3">
      <h4 className="text-sm font-semibold text-gray-200">Add Custom Provider</h4>
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Provider ID (e.g. my-llm)" value={id} onChange={e => setId(e.target.value)}
          className="bg-[#0e0e11] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#444] placeholder-gray-600" />
        <input placeholder="Display name" value={name} onChange={e => setName(e.target.value)}
          className="bg-[#0e0e11] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#444] placeholder-gray-600" />
      </div>
      <input placeholder="Base URL (e.g. http://localhost:11434/v1)" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
        className="w-full bg-[#0e0e11] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#444] placeholder-gray-600 font-mono" />
      <input type="password" placeholder="API key (optional for local servers)" value={apiKey} onChange={e => setApiKey(e.target.value)}
        className="w-full bg-[#0e0e11] border border-[#2d2d2d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#444] placeholder-gray-600 font-mono" />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleAdd} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-40">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Provider
        </button>
        <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/8 text-gray-400 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export const ConnectProviderView: React.FC = () => {
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading,   setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await controllerClient.listProviders();
      setProviders(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const builtin = providers.filter(p => p.is_builtin);
  const custom  = providers.filter(p => !p.is_builtin);
  const connected = providers.filter(p => p.has_key).length;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-[#09090b]">
      {/* Header */}
      <div className="h-16 border-b border-[#2d2d2d] flex items-center px-6 gap-3 shrink-0 bg-[#09090b]">
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">Connect Provider</h1>
          <p className="text-[11px] text-gray-500">Add API keys, then fetch models to enable them in chat.</p>
        </div>
        <div className="ml-auto text-[11px] text-gray-500">
          {connected} of {providers.length} providers connected
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto custom-scrollbar p-6">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading providers…
          </div>
        ) : (
          <div className="max-w-2xl flex flex-col gap-3">
            {builtin.length > 0 && (
              <>
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-1">Built-in Providers</h3>
                {builtin.map(p => <ProviderCard key={p.id} provider={p} onRefresh={load} />)}
              </>
            )}
            {custom.length > 0 && (
              <>
                <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-1 mt-3">Custom Providers</h3>
                {custom.map(p => <ProviderCard key={p.id} provider={p} onRefresh={load} />)}
              </>
            )}
            <div className="mt-2">
              <AddCustomProvider onAdded={load} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
