/**
 * ProjectHomescreen — shown when no project is open.
 *
 * Features:
 *  - Create new project (with native folder picker via Electron IPC, or text input)
 *  - Open existing project
 *  - Recent projects list
 *  - Animated OctoML branding
 */

import React, { useState, useEffect, useCallback } from 'react';
import { FolderOpen, FolderPlus, Clock, ChevronRight, Loader2, AlertCircle, X } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { controllerClient } from '../services/controller.client';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pickFolder(): Promise<string | null> {
  // Try Electron native dialog first
  if (typeof window !== 'undefined' && (window as any).octoml?.showFolderDialog) {
    return (window as any).octoml.showFolderDialog();
  }
  // Fallback: File System Access API (browser)
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      return handle.name; // Note: browser can't give full OS path
    } catch { return null; }
  }
  return null;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 2)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

const LoadingState: React.FC = () => (
  <div className="flex items-center gap-2 text-sim-muted text-sm">
    <Loader2 className="w-4 h-4 animate-spin" />
    <span>Starting...</span>
  </div>
);

const ErrorBanner: React.FC<{ message: string; onClose: () => void }> = ({ message, onClose }) => (
  <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-300">
    <AlertCircle className="w-4 h-4 shrink-0" />
    <span className="flex-1">{message}</span>
    <button onClick={onClose} className="opacity-60 hover:opacity-100 transition-opacity">
      <X className="w-4 h-4" />
    </button>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

export const ProjectHomescreen: React.FC = () => {
  const { openProject } = useProject();

  const [recent,       setRecent]       = useState<any[]>([]);
  const [error,        setError]        = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);

  // Create project modal state
  const [showCreate,   setShowCreate]   = useState(false);
  const [createName,   setCreateName]   = useState('');
  const [createPath,   setCreatePath]   = useState('');

  // Open project modal state
  const [showOpen,     setShowOpen]     = useState(false);
  const [openPath,     setOpenPath]     = useState('');

  useEffect(() => {
    controllerClient.getRecentProjects()
      .then(d => setRecent(d.recent || []))
      .catch(() => {});
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleBrowse = useCallback(async (setter: (p: string) => void) => {
    const picked = await pickFolder();
    if (picked) setter(picked);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!createName.trim() || !createPath.trim()) {
      setError('Please enter a project name and folder path.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fullPath = createPath.trim().replace(/\\/g, '/') + '/' + createName.trim().replace(/\s+/g, '-');
      const data = await controllerClient.createProject(fullPath, createName.trim());
      if (data.status !== 'success' && (data as any).error) { 
        setError((data as any).error || 'Failed to create project'); 
        return; 
      }
      openProject(data.project, data.manifest);
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [createName, createPath, openProject]);

  const handleOpen = useCallback(async (targetPath: string) => {
    if (!targetPath.trim()) { setError('Please enter a project path.'); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await controllerClient.openProject(targetPath.trim());
      if (data.status !== 'success' && (data as any).error) { 
        setError((data as any).error || 'Failed to open project'); 
        return; 
      }
      openProject(data.project, data.manifest);
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [openProject]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen w-screen bg-sim-bg flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-sim-red/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-2xl px-6 flex flex-col gap-8">

        {/* ── Branding ─────────────────────────────────────────────────── */}
        <div className="text-center">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-sim-red/20 border border-sim-red/40 flex items-center justify-center">
              <span className="text-2xl">🐙</span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">OctoML</h1>
          </div>
          <p className="text-sim-muted text-sm">Project-centric AI-native notebook for data scientists</p>
        </div>

        {/* ── Error banner ─────────────────────────────────────────────── */}
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

        {/* ── Primary actions ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setShowCreate(true)}
            className="group flex flex-col gap-3 p-6 bg-sim-surface border border-sim-border hover:border-sim-red/50 rounded-2xl text-left transition-all hover:bg-sim-red/5"
          >
            <div className="w-10 h-10 rounded-xl bg-sim-red/10 border border-sim-red/30 flex items-center justify-center group-hover:bg-sim-red/20 transition-colors">
              <FolderPlus className="w-5 h-5 text-sim-red" />
            </div>
            <div>
              <div className="font-semibold text-white mb-1">New Project</div>
              <div className="text-xs text-sim-muted">Create a project with notebooks, data, models folders</div>
            </div>
          </button>

          <button
            onClick={() => setShowOpen(true)}
            className="group flex flex-col gap-3 p-6 bg-sim-surface border border-sim-border hover:border-white/20 rounded-2xl text-left transition-all hover:bg-white/5"
          >
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-white/10 transition-colors">
              <FolderOpen className="w-5 h-5 text-sim-muted" />
            </div>
            <div>
              <div className="font-semibold text-white mb-1">Open Project</div>
              <div className="text-xs text-sim-muted">Open an existing OctoML project folder</div>
            </div>
          </button>
        </div>

        {/* ── Recent projects ──────────────────────────────────────────── */}
        {recent.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-sim-muted uppercase tracking-wider mb-3">
              <Clock className="w-3.5 h-3.5" />
              Recent Projects
            </div>
            <div className="flex flex-col gap-1">
              {recent.slice(0, 5).map((proj) => (
                <button
                  key={proj.path}
                  onClick={() => handleOpen(proj.path)}
                  disabled={loading}
                  className="group flex items-center gap-3 px-4 py-3 bg-sim-surface hover:bg-sim-surface/80 border border-sim-border hover:border-white/20 rounded-xl text-left transition-all"
                >
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                    <span className="text-base">🐙</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm truncate">{proj.name}</div>
                    <div className="text-xs text-sim-muted truncate">{proj.path}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sim-muted shrink-0">
                    <span>{timeAgo(proj.opened)}</span>
                    <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex justify-center">
            <LoadingState />
          </div>
        )}
      </div>

      {/* ── Create Project Modal ───────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-sim-surface border border-sim-border rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-semibold text-white">New Project</h2>
              <button onClick={() => setShowCreate(false)} className="text-sim-muted hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs text-sim-muted mb-1.5">Project Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="my-ml-project"
                  className="w-full bg-sim-bg border border-sim-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-sim-muted focus:outline-none focus:border-sim-red/50"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs text-sim-muted mb-1.5">Parent Folder</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={createPath}
                    onChange={e => setCreatePath(e.target.value)}
                    placeholder="D:/projects or /home/user/projects"
                    className="flex-1 bg-sim-bg border border-sim-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-sim-muted focus:outline-none focus:border-sim-red/50"
                  />
                  <button
                    onClick={() => handleBrowse(setCreatePath)}
                    className="px-3 py-2.5 bg-sim-bg border border-sim-border rounded-xl text-sim-muted hover:text-white hover:border-white/20 transition-all"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
                {createName && createPath && (
                  <p className="text-xs text-sim-muted mt-1.5 font-mono">
                    {createPath.replace(/\\/g, '/')}/{createName.replace(/\s+/g, '-')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2.5 bg-sim-bg border border-sim-border rounded-xl text-sm text-sim-muted hover:text-white hover:border-white/20 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !createName.trim() || !createPath.trim()}
                className="flex-1 px-4 py-2.5 bg-sim-red hover:bg-sim-red/80 rounded-xl text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Open Project Modal ─────────────────────────────────────────── */}
      {showOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-sim-surface border border-sim-border rounded-2xl p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-semibold text-white">Open Project</h2>
              <button onClick={() => setShowOpen(false)} className="text-sim-muted hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs text-sim-muted mb-1.5">Project Folder Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={openPath}
                  onChange={e => setOpenPath(e.target.value)}
                  placeholder="D:/projects/my-ml-project"
                  className="flex-1 bg-sim-bg border border-sim-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-sim-muted focus:outline-none focus:border-sim-red/50"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleOpen(openPath)}
                />
                <button
                  onClick={() => handleBrowse(setOpenPath)}
                  className="px-3 py-2.5 bg-sim-bg border border-sim-border rounded-xl text-sim-muted hover:text-white hover:border-white/20 transition-all"
                >
                  <FolderOpen className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowOpen(false)}
                className="flex-1 px-4 py-2.5 bg-sim-bg border border-sim-border rounded-xl text-sm text-sim-muted hover:text-white hover:border-white/20 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleOpen(openPath)}
                disabled={loading || !openPath.trim()}
                className="flex-1 px-4 py-2.5 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Open Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
