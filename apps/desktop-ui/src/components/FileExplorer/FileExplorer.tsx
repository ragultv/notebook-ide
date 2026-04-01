import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder, File, ChevronRight, ChevronDown, Upload,
  FolderOpen, RefreshCw, Trash2, Edit2, FileJson, FileText,
  Database, Image, FileCode, FolderPlus, FilePlus, FileCode2,
} from 'lucide-react';
import { controllerClient, FileItem, ProjectInfo } from '../../services/controller.client';
import { useCenterDialog } from '../shared/CenterDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FileExplorerProps {
  onFileSelect: (path: string, type: 'notebook' | 'data' | 'other') => void;
  onProjectChange?: (project: ProjectInfo | null) => void;
}

interface TreeNode extends FileItem {
  children?: TreeNode[];
}

// ── Icon map ──────────────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '.ipynb': FileCode,
  '.py': FileCode,
  '.json': FileJson,
  '.csv': Database,
  '.xlsx': Database,
  '.xls': Database,
  '.parquet': Database,
  '.txt': FileText,
  '.md': FileText,
  '.png': Image,
  '.jpg': Image,
  '.jpeg': Image,
  '.gif': Image,
};

const FileIcon: React.FC<{ extension?: string; isDir: boolean }> = ({ extension, isDir }) => {
  if (isDir) return <Folder className="w-4 h-4 text-yellow-500 shrink-0" />;
  const IconComponent = FILE_ICONS[extension || ''] || File;
  const color = extension === '.ipynb' ? 'text-orange-400'
    : extension === '.py' ? 'text-blue-400'
      : ['.csv', '.json', '.xlsx', '.parquet'].includes(extension || '') ? 'text-green-400'
        : 'text-gray-400';
  return <IconComponent className={`w-4 h-4 shrink-0 ${color}`} />;
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

// ── Component ─────────────────────────────────────────────────────────────────

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onProjectChange }) => {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; path: string; type: string; name: string;
  } | null>(null);
  const [recentProjects, setRecentProjects] = useState<Array<{ path: string; name: string; opened: string }>>([]);
  const [showRecent, setShowRecent] = useState(true);

  // Inline rename state
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Shared centered-dialog hook — no window.prompt/confirm/alert anywhere
  const { show: showDialog, Dialog } = useCenterDialog();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => { loadRecentProjects(); }, []);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    const hide = () => setContextMenu(null);
    window.addEventListener('click', hide);
    return () => window.removeEventListener('click', hide);
  }, []);

  // ── Project loading ────────────────────────────────────────────────────────

  const loadRecentProjects = async () => {
    try {
      const result = await controllerClient.getRecentProjects();
      setRecentProjects(result.recent);
    } catch { /* ignore — backend may not be ready yet */ }
  };

  const loadProjectFiles = useCallback(async (projectPath: string) => {
    setIsLoading(true);
    try {
      const result = await controllerClient.listFiles(projectPath);
      setFiles(result.items.map(item => ({
        ...item,
        children: item.type === 'directory' ? [] : undefined,
      })));
      setExpandedPaths(new Set());
    } catch (e: any) {
      console.error('Failed to load project files', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadFolder = async (folderPath: string): Promise<TreeNode[]> => {
    try {
      const result = await controllerClient.listFiles(folderPath);
      return result.items.map(item => ({
        ...item,
        children: item.type === 'directory' ? [] : undefined,
      }));
    } catch { return []; }
  };

  // ── Tree expansion ─────────────────────────────────────────────────────────

  const updateChildren = (nodes: TreeNode[], target: string, children: TreeNode[]): TreeNode[] =>
    nodes.map(n => {
      if (n.path === target) return { ...n, children };
      if (n.children) return { ...n, children: updateChildren(n.children, target, children) };
      return n;
    });

  const toggleFolder = async (node: TreeNode) => {
    const next = new Set(expandedPaths);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
      if (!node.children?.length) {
        const children = await loadFolder(node.path);
        setFiles(prev => updateChildren(prev, node.path, children));
      }
    }
    setExpandedPaths(next);
  };

  // ── Project actions ────────────────────────────────────────────────────────

  const handleOpenProject = async () => {
    // Electron: use native dialog via IPC
    const isElectron = typeof window !== 'undefined' && !!(window as any).__ELECTRON__;
    let folderPath: string | null = null;

    if (isElectron) {
      try { folderPath = await (window as any).electronAPI?.selectFolder?.() ?? null; } catch { }
    }

    if (!folderPath) {
      const result = await showDialog({
        title: 'Open Folder',
        description: 'Enter the absolute path to the project folder you want to open.',
        fields: [{ id: 'path', label: 'Folder Path', placeholder: 'C:\\Users\\you\\MyProject' }],
        confirmLabel: 'Open',
      });
      folderPath = result?.path?.trim() || null;
    }

    if (!folderPath) return;
    try {
      const res = await controllerClient.openProject(
        folderPath,
        folderPath.replace(/\\/g, '/').split('/').pop() || 'Project',
      );
      setProject(res.project);
      onProjectChange?.(res.project);
      await loadProjectFiles(res.project.path);
      loadRecentProjects();
      setShowRecent(false);
    } catch (e: any) {
      await showDialog({ title: 'Error', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  const handleOpenRecentProject = async (rp: { path: string; name: string }) => {
    try {
      const res = await controllerClient.openProject(rp.path, rp.name);
      setProject(res.project);
      onProjectChange?.(res.project);
      await loadProjectFiles(res.project.path);
      setShowRecent(false);
    } catch (e: any) {
      await showDialog({ title: 'Error', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  // ── File click ─────────────────────────────────────────────────────────────

  const handleFileClick = (node: TreeNode) => {
    if (node.type === 'directory') {
      toggleFolder(node);
    } else {
      setSelectedPath(node.path);
      const fileType = node.extension === '.ipynb' ? 'notebook'
        : ['.csv', '.json', '.xlsx', '.parquet', '.pkl'].includes(node.extension || '') ? 'data'
          : 'other';
      onFileSelect(node.path, fileType);
    }
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUploadFiles = () => {
    if (!project) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.json,.xlsx,.xls,.parquet,.pkl,.txt,.png,.jpg,.jpeg,.py,.ipynb';
    input.onchange = async (e) => {
      const pickedFiles = (e.target as HTMLInputElement).files;
      if (!pickedFiles?.length) return;
      try {
        await controllerClient.uploadFiles(Array.from(pickedFiles), project!.path);
        await loadProjectFiles(project!.path);
      } catch (e: any) {
        await showDialog({ title: 'Upload failed', description: e.message, fields: [], confirmLabel: 'OK' });
      }
    };
    input.click();
  };

  // ── CRUD operations ────────────────────────────────────────────────────────

  const handleCreateFolder = async (parentPath: string) => {
    setContextMenu(null);
    const result = await showDialog({
      title: 'New Folder',
      fields: [{ id: 'name', label: 'Folder name', placeholder: 'my-folder' }],
      confirmLabel: 'Create',
    });
    const name = result?.name?.trim();
    if (!name) return;
    try {
      await controllerClient.createFolder(parentPath, name);
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      await showDialog({ title: 'Error', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  const handleCreateFile = async (parentPath: string) => {
    setContextMenu(null);
    const result = await showDialog({
      title: 'New File',
      fields: [{ id: 'name', label: 'File name', placeholder: 'script.py' }],
      confirmLabel: 'Create',
    });
    const name = result?.name?.trim();
    if (!name) return;
    const sep = parentPath.includes('/') ? '/' : '\\';
    try {
      await controllerClient.saveFile(`${parentPath}${sep}${name}`, '');
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      await showDialog({ title: 'Error', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  const handleCreateNotebook = async (parentPath: string, language: 'python' | 'julia' = 'python') => {
    setContextMenu(null);
    const result = await showDialog({
      title: language === 'julia' ? 'New Julia Notebook' : 'New Notebook',
      fields: [{ id: 'name', label: 'Notebook name', placeholder: 'analysis', defaultValue: 'Untitled' }],
      confirmLabel: 'Create',
    });
    const rawName = result?.name?.trim();
    if (!rawName) return;
    const name = rawName.endsWith('.ipynb') ? rawName : `${rawName}.ipynb`;
    const sep = parentPath.includes('/') ? '/' : '\\';
    const filePath = `${parentPath}${sep}${name}`;
    const isJulia = language === 'julia';
    const starter = {
      nbformat: 4, nbformat_minor: 5,
      metadata: {
        kernelspec: isJulia
          ? { display_name: 'Julia', language: 'julia', name: 'julia-1.x' }
          : { display_name: 'Python 3', language: 'python', name: 'python3' },
      },
      cells: [{
        cell_type: 'code', id: 'init', metadata: {},
        source: [isJulia ? '# New Julia notebook\n' : '# New notebook\n'],
        execution_count: null, outputs: [],
      }],
    };
    try {
      await controllerClient.saveNotebook(filePath, starter);
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      await showDialog({ title: 'Error', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    setContextMenu(null);
    const fileName = filePath.split(/[/\\]/).pop();
    const result = await showDialog({
      title: `Delete "${fileName}"?`,
      description: 'This action cannot be undone. The file will be permanently removed from disk.',
      fields: [],
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!result) return; // user cancelled
    try {
      await controllerClient.deleteFile(filePath);
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      await showDialog({ title: 'Error', description: e.message, fields: [], confirmLabel: 'OK' });
    }
  };

  // ── Inline rename ──────────────────────────────────────────────────────────

  const startRename = (node: TreeNode) => {
    setContextMenu(null);
    setRenaming({ path: node.path, name: node.name });
  };

  const commitRename = async () => {
    if (!renaming) return;
    const newName = renameInputRef.current?.value.trim();
    if (!newName || newName === renaming.name) { setRenaming(null); return; }
    const dir = renaming.path.slice(0, renaming.path.length - renaming.name.length);
    const newPath = dir + newName;
    try {
      await controllerClient.renameFile(renaming.path, newPath);
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      await showDialog({ title: 'Rename failed', description: e.message, fields: [], confirmLabel: 'OK' });
    } finally {
      setRenaming(null);
    }
  };

  // ── Context menu ───────────────────────────────────────────────────────────

  const openContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path: node.path, type: node.type, name: node.name });
  };

  // ── Tree rendering ─────────────────────────────────────────────────────────

  const renderNode = (node: TreeNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;
    const isRenamingThis = renaming?.path === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 py-0.5 cursor-pointer rounded text-sm select-none
            hover:bg-white/5 transition-colors
            ${isSelected ? 'bg-sim-red/15 text-white' : 'text-gray-300'}`}
          style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: '8px' }}
          onClick={() => !isRenamingThis && handleFileClick(node)}
          onContextMenu={e => openContextMenu(e, node)}
        >
          {/* Expand chevron */}
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {node.type === 'directory'
              ? (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)
              : null}
          </span>

          <FileIcon extension={node.extension} isDir={node.type === 'directory'} />

          {isRenamingThis ? (
            <input
              ref={renameInputRef}
              defaultValue={renaming!.name}
              className="flex-1 bg-[#27272a] border border-sim-red/60 text-white text-xs px-1 py-0.5 rounded outline-none"
              onBlur={commitRename}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="truncate flex-1 text-xs">{node.name}</span>
          )}

          {!isRenamingThis && node.size != null && node.size > 0 && (
            <span className="text-[10px] text-gray-600 shrink-0 ml-1">{formatSize(node.size)}</span>
          )}
        </div>

        {/* Children */}
        {node.type === 'directory' && isExpanded && node.children && (
          <div>{node.children.map(child => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-sim-bg text-white" onClick={() => setContextMenu(null)}>

      {/* Mount dialog at top level so it renders above everything */}
      {Dialog}

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-sim-border shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button onClick={handleOpenProject} className="p-1.5 hover:bg-sim-border rounded-md text-gray-500 hover:text-gray-200 transition-colors" title="Open Folder">
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          {project && (
            <>
              <button onClick={handleUploadFiles} className="p-1.5 hover:bg-sim-border rounded-md text-gray-500 hover:text-gray-200 transition-colors" title="Upload Files">
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => loadProjectFiles(project.path)}
                className="p-1.5 hover:bg-sim-border rounded-md text-gray-500 hover:text-gray-200 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">

        {/* Recent projects / empty state */}
        {!project && showRecent && (
          <div className="p-3">
            <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2 px-1">Recent</p>

            {recentProjects.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-6">No recent projects</p>
            ) : (
              <div className="space-y-0.5 mb-3">
                {recentProjects.map((rp, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleOpenRecentProject(rp)}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                      <span className="text-xs truncate text-gray-300">{rp.name}</span>
                    </div>
                    <div className="text-[10px] text-gray-600 truncate pl-5">{rp.path}</div>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleOpenProject}
              className="w-full flex items-center justify-center gap-2 px-3 py-2
                bg-sim-red/10 hover:bg-sim-red/20 text-sim-red
                border border-sim-red/30 rounded-lg text-xs transition-colors mt-2"
            >
              <FolderOpen className="w-3.5 h-3.5" /> Open Folder
            </button>
          </div>
        )}

        {/* File tree */}
        {project && (
          <>
            <div className="px-3 py-1.5 flex items-center gap-1.5 border-b border-sim-border/50 bg-white/[0.02]">
              <Folder className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
              <span className="text-xs font-medium truncate text-gray-300">{project.name}</span>
            </div>
            <div className="py-1">
              {files.map(node => renderNode(node))}
            </div>
          </>
        )}
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className="fixed bg-[#1e1e20] border border-[#3a3a3c] rounded-xl shadow-2xl shadow-black/60 py-1 z-50 min-w-[160px] overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.type === 'directory' && (
            <>
              <button onClick={() => handleCreateFolder(contextMenu.path)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5 text-gray-300 flex items-center gap-2 transition-colors">
                <FolderPlus className="w-3.5 h-3.5 text-gray-500" /> New Folder
              </button>
              <button onClick={() => handleCreateFile(contextMenu.path)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5 text-gray-300 flex items-center gap-2 transition-colors">
                <FilePlus className="w-3.5 h-3.5 text-gray-500" /> New File
              </button>
              <button onClick={() => handleCreateNotebook(contextMenu.path)}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5 text-gray-300 flex items-center gap-2 transition-colors">
                <FileCode2 className="w-3.5 h-3.5 text-orange-400" /> New Python Notebook
              </button>
              <button onClick={() => handleCreateNotebook(contextMenu.path, 'julia')}
                className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5 text-gray-300 flex items-center gap-2 transition-colors">
                <FileCode2 className="w-3.5 h-3.5 text-purple-400" /> New Julia Notebook
              </button>
              <div className="border-t border-[#3a3a3c] my-1" />
            </>
          )}
          <button onClick={() => startRename(contextMenu as any)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5 text-gray-300 flex items-center gap-2 transition-colors">
            <Edit2 className="w-3.5 h-3.5 text-gray-500" /> Rename
          </button>
          <button onClick={() => handleDeleteFile(contextMenu.path)}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-white/5 text-red-400 flex items-center gap-2 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default FileExplorer;
