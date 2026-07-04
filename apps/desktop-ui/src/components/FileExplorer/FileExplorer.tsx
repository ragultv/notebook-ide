/**
 * FileExplorer — VS Code-style project file tree.
 *
 * Design principles:
 *  - All paths are VIRTUAL (e.g. /data/file.csv)
 *  - Backed by useProjectFileTree hook polling the backend
 *  - Context menu: New File, New Folder, Rename, Delete, Copy Path
 *  - Drag & drop: move files between folders
 *  - Upload: drop files from OS onto any folder
 *  - Clicking a .ipynb → opens notebook via onOpenNotebook
 *  - Clicking other files → opens as read-only viewer
 */

import React, {
    useState, useRef, useEffect, useCallback, DragEvent,
} from 'react';
import {
    ChevronRight, ChevronDown, File, Folder, FolderOpen, MoreVertical,
    FilePlus, FolderPlus, Pencil, Trash2, Copy, Upload, RefreshCw, Loader2,
    ExternalLink,
} from 'lucide-react';
import { useProjectFileTree, FileTreeNode } from '../../hooks/useProjectFileTree';
import { controllerClient } from '../../services/controller.client';
import { getFileIcon } from '../shared/FileIcons';

// ── File icon helpers ─────────────────────────────────────────────────────────

function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Context Menu ──────────────────────────────────────────────────────────────

interface ContextMenuProps {
    x: number;
    y: number;
    node: FileTreeNode;
    onClose: () => void;
    onNewFile: (parentPath: string) => void;
    onNewFolder: (parentPath: string) => void;
    onRename: (node: FileTreeNode) => void;
    onDelete: (node: FileTreeNode) => void;
    onCopyPath: (node: FileTreeNode) => void;
    onReveal: (node: FileTreeNode) => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({
    x, y, node, onClose, onNewFile, onNewFolder, onRename, onDelete, onCopyPath, onReveal,
}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const isDir = node.type === 'directory';

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const parentPath = isDir ? node.virtualPath : node.virtualPath.substring(0, node.virtualPath.lastIndexOf('/')) || '/';

    const items = [
        ...(isDir ? [
            { icon: FilePlus,   label: 'New File',   action: () => { onClose(); onNewFile(node.virtualPath); } },
            { icon: FolderPlus, label: 'New Folder', action: () => { onClose(); onNewFolder(node.virtualPath); } },
            { separator: true },
        ] : []),
        { icon: Pencil,  label: 'Rename',    action: () => { onClose(); onRename(node); } },
        { icon: Trash2,  label: 'Delete',    action: () => { onClose(); onDelete(node); }, danger: true },
        { separator: true },
        { icon: Copy,    label: 'Copy Path', action: () => { onClose(); onCopyPath(node); } },
        { icon: FolderOpen, label: 'Reveal in Explorer', action: () => { onClose(); onReveal(node); } },
    ];

    // Clamp to viewport
    const adjustedX = Math.min(x, window.innerWidth  - 200);
    const adjustedY = Math.min(y, window.innerHeight - 250);

    return (
        <div
            ref={menuRef}
            style={{ top: adjustedY, left: adjustedX }}
            className="fixed z-[9999] min-w-[180px] bg-sim-surface border border-sim-border rounded-xl shadow-2xl py-1 text-sm text-sim-text"
        >
            {items.map((item, idx) => {
                if ((item as any).separator) {
                    return <div key={idx} className="h-px bg-sim-border mx-2 my-1" />;
                }
                const Icon = (item as any).icon;
                return (
                    <button
                        key={idx}
                        onClick={(item as any).action}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-sim-selection hover:text-sim-text transition-colors
                            ${(item as any).danger ? 'text-red-500' : 'text-sim-text'}`}
                    >
                        <Icon className="w-3.5 h-3.5 opacity-70" />
                        <span>{(item as any).label}</span>
                    </button>
                );
            })}
        </div>
    );
};

// ── Tree Node ─────────────────────────────────────────────────────────────────

interface NewItemState {
    parentPath: string;
    type: 'file' | 'folder';
}

interface TreeNodeProps {
    node:            FileTreeNode;
    depth:           number;
    isExpanded:      boolean;
    isSelected:      boolean;
    onToggle:        (vp: string) => void;
    onSelect:        (vp: string) => void;
    onOpen:          (node: FileTreeNode) => void;
    onContextMenu:   (e: React.MouseEvent, node: FileTreeNode) => void;
    onDrop:          (srcPath: string, dstFolder: string) => void;
    renamingPath:    string | null;
    onRenameSubmit:  (node: FileTreeNode, newName: string) => void;
    onRenameCancel:  () => void;
    // Inline new-item creation
    newItemState:    NewItemState | null;
    newItemName:     string;
    newItemInputRef: React.RefObject<HTMLInputElement>;
    onNewItemNameChange: (name: string) => void;
    onNewItemSubmit: () => void;
    onNewItemCancel: () => void;
    expandedPaths:   Set<string>;
    selectedPath:    string | null;
}

const TreeNode: React.FC<TreeNodeProps> = ({
    node, depth, isExpanded, isSelected, onToggle, onSelect, onOpen,
    onContextMenu, onDrop, renamingPath, onRenameSubmit, onRenameCancel,
    newItemState, newItemName, newItemInputRef, onNewItemNameChange,
    onNewItemSubmit, onNewItemCancel, expandedPaths, selectedPath,
}) => {
    const isDir      = node.type === 'directory';
    const isRenaming = renamingPath === node.virtualPath;
    const inputRef   = useRef<HTMLInputElement>(null);
    const [renameVal, setRenameVal] = useState(node.name);
    const [isDragOver, setIsDragOver] = useState(false);

    useEffect(() => {
        if (isRenaming) {
            setRenameVal(node.name);
            setTimeout(() => inputRef.current?.select(), 50);
        }
    }, [isRenaming, node.name]);

    const handleDragStart = (e: DragEvent) => {
        e.dataTransfer.setData('text/plain', node.virtualPath);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (isDir) {
            setIsDragOver(true);
        }
    };

    const handleDrop = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const srcPath = e.dataTransfer.getData('text/plain');
        if (!srcPath) return;

        const targetFolder = isDir ? node.virtualPath : (node.virtualPath.substring(0, node.virtualPath.lastIndexOf('/')) || '/');
        const srcParent = srcPath.substring(0, srcPath.lastIndexOf('/')) || '/';
        
        if (srcParent !== targetFolder && srcPath !== targetFolder) {
            onDrop(srcPath, targetFolder);
        }
    };

    const handleDragLeave = () => setIsDragOver(false);

    const indent = depth * 12 + 8;

    return (
        <div>
            <div
                style={{ paddingLeft: indent }}
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragLeave={handleDragLeave}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, node); }}
                onClick={() => {
                    if (isDir) onToggle(node.virtualPath);
                    else onOpen(node);
                }}
                onDoubleClick={() => { if (!isDir) onOpen(node); }}
                className={`flex items-center gap-1.5 pr-2 py-[3px] cursor-pointer select-none rounded-sm mx-1 group transition-colors
                    ${isSelected ? 'bg-sim-selection text-sim-red font-semibold' : 'text-sim-text hover:bg-sim-selection/50'}
                    ${isDragOver ? 'bg-blue-500/20 ring-1 ring-blue-500/50' : ''}`}
            >
                {/* Expand arrow for directories */}
                <span className="w-4 h-4 flex items-center justify-center shrink-0 text-sim-muted">
                    {isDir ? (
                        isExpanded
                            ? <ChevronDown className="w-3 h-3" />
                            : <ChevronRight className="w-3 h-3" />
                    ) : null}
                </span>

                {/* Icon */}
                {isDir
                    ? (isExpanded
                        ? <FolderOpen className="w-4 h-4 text-yellow-400/80 shrink-0" />
                        : <Folder     className="w-4 h-4 text-yellow-400/60 shrink-0" />)
                    : getFileIcon(node.extension, "w-4 h-4 shrink-0")
                }

                {/* Name / Rename input */}
                {isRenaming ? (
                    <input
                        ref={inputRef}
                        value={renameVal}
                        onChange={e => setRenameVal(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') onRenameSubmit(node, renameVal);
                            if (e.key === 'Escape') onRenameCancel();
                        }}
                        onBlur={() => onRenameSubmit(node, renameVal)}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 bg-sim-bg border border-sim-border focus:border-sim-red/50 rounded px-1 text-xs text-sim-text outline-none"
                    />
                ) : (
                    <span className="flex-1 text-xs truncate leading-tight">{node.name}</span>
                )}

                {/* Size badge */}
                {!isDir && node.size && (
                    <span className="text-[10px] text-sim-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {formatSize(node.size)}
                    </span>
                )}
            </div>

            {/* Children */}
            {isDir && isExpanded && (
                <div>
                    {node.children && node.children.map(child => (
                        <TreeNode
                            key={child.virtualPath}
                            node={child}
                            depth={depth + 1}
                            isExpanded={expandedPaths.has(child.virtualPath)}
                            isSelected={selectedPath === child.virtualPath}
                            onToggle={onToggle}
                            onSelect={onSelect}
                            onOpen={onOpen}
                            onContextMenu={onContextMenu}
                            onDrop={onDrop}
                            renamingPath={renamingPath}
                            onRenameSubmit={onRenameSubmit}
                            onRenameCancel={onRenameCancel}
                            newItemState={newItemState}
                            newItemName={newItemName}
                            newItemInputRef={newItemInputRef}
                            onNewItemNameChange={onNewItemNameChange}
                            onNewItemSubmit={onNewItemSubmit}
                            onNewItemCancel={onNewItemCancel}
                            expandedPaths={expandedPaths}
                            selectedPath={selectedPath}
                        />
                    ))}
                    {/* Inline new-item input inside this folder */}
                    {newItemState && newItemState.parentPath === node.virtualPath && (
                        <div
                            style={{ paddingLeft: (depth + 1) * 12 + 8 }}
                            className="flex items-center gap-1.5 pr-2 py-[3px] mx-1"
                        >
                            {newItemState.type === 'file'
                                ? <File className="w-4 h-4 text-sim-muted shrink-0" />
                                : <FolderPlus className="w-4 h-4 text-yellow-400/60 shrink-0" />
                            }
                            <input
                                ref={newItemInputRef}
                                value={newItemName}
                                onChange={e => onNewItemNameChange(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter')  onNewItemSubmit();
                                    if (e.key === 'Escape') onNewItemCancel();
                                }}
                                onBlur={onNewItemSubmit}
                                placeholder={newItemState.type === 'file' ? 'filename.py' : 'folder-name'}
                                className="flex-1 bg-sim-bg border border-sim-border focus:border-sim-red/50 rounded px-1 text-xs text-sim-text outline-none"
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Wrapper — only kept for the root-level render call, all recursive children use TreeNode directly
const TreeNodeWrapper = TreeNode;

// ── Main FileExplorer ─────────────────────────────────────────────────────────

export interface FileExplorerProps {
    onOpenNotebook?:  (virtualPath: string, name: string) => void;
    onOpenFile?:      (virtualPath: string, name: string) => void;
    uploadDestination?: string;
    onDeleteFile?:     (virtualPath: string) => void;
    activeFilePath?:   string | null;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
    onOpenNotebook, onOpenFile, onDeleteFile, activeFilePath,
}) => {
    const tree = useProjectFileTree();

    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: FileTreeNode } | null>(null);
    const [renamingPath, setRenamingPath] = useState<string | null>(null);
    const [newItemState, setNewItemState] = useState<{ parentPath: string; type: 'file' | 'folder' } | null>(null);
    const [newItemName, setNewItemName] = useState('');
    const newItemInputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState<string | null>(null);
    const uploadRef = useRef<HTMLInputElement>(null);

    // Sync selected file highlight with editor active tab
    useEffect(() => {
        if (activeFilePath !== undefined) {
            tree.setSelected(activeFilePath);
        }
    }, [activeFilePath, tree.setSelected]);

    useEffect(() => {
        if (newItemState) {
            setTimeout(() => newItemInputRef.current?.focus(), 50);
        }
    }, [newItemState]);

    // ── Node open handler ────────────────────────────────────────────────────

    const handleOpen = useCallback((node: FileTreeNode) => {
        if (node.extension === '.ipynb') {
            onOpenNotebook?.(node.virtualPath, node.name);
        } else {
            onOpenFile?.(node.virtualPath, node.name);
        }
    }, [onOpenNotebook, onOpenFile]);

    // ── Context menu ─────────────────────────────────────────────────────────

    const handleContextMenu = useCallback((e: React.MouseEvent, node: FileTreeNode) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, node });
    }, []);

    // ── Delete ───────────────────────────────────────────────────────────────

    const handleDelete = useCallback(async (node: FileTreeNode) => {
        if (!window.confirm(`Delete "${node.name}"? This cannot be undone.`)) return;
        try {
            await controllerClient.deleteFile(node.virtualPath);
            onDeleteFile?.(node.virtualPath);
            await tree.refresh();
        } catch (e: any) {
            setError(e.message);
        }
    }, [tree, onDeleteFile]);

    // ── Rename ───────────────────────────────────────────────────────────────

    const handleRenameSubmit = useCallback(async (node: FileTreeNode, newName: string) => {
        const trimmed = newName.trim();
        setRenamingPath(null);
        if (!trimmed || trimmed === node.name) return;
        const parent  = node.virtualPath.substring(0, node.virtualPath.lastIndexOf('/')) || '/';
        const newPath = parent === '/' ? `/${trimmed}` : `${parent}/${trimmed}`;
        try {
            await controllerClient.renameFile(node.virtualPath, newPath);
            await tree.refresh();
        } catch (e: any) {
            setError(e.message);
        }
    }, [tree]);

    // ── Move (drag & drop) ───────────────────────────────────────────────────

    const handleDrop = useCallback(async (srcPath: string, dstFolder: string) => {
        try {
            await controllerClient.moveFile(srcPath, dstFolder);
            await tree.refresh();
        } catch (e: any) {
            setError(e.message);
        }
    }, [tree]);

    // ── New file / folder ─────────────────────────────────────────────────────

    const handleNewItemSubmit = useCallback(async () => {
        if (!newItemState || !newItemName.trim()) {
            setNewItemState(null);
            setNewItemName('');
            return;
        }
        const name = newItemName.trim();
        const path = newItemState.parentPath === '/'
            ? `/${name}`
            : `${newItemState.parentPath}/${name}`;
        try {
            if (newItemState.type === 'file') {
                await controllerClient.createFile(path, '');
            } else {
                await controllerClient.createFolder(newItemState.parentPath, name);
            }
            await tree.refresh();
            tree.expandPath(newItemState.parentPath);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setNewItemState(null);
            setNewItemName('');
        }
    }, [newItemState, newItemName, tree]);

    // ── Upload ────────────────────────────────────────────────────────────────

    const handleFileUpload = useCallback(async (files: FileList, destination: string) => {
        try {
            await controllerClient.uploadFiles(Array.from(files), destination);
            await tree.refresh();
            tree.expandPath(destination);
        } catch (e: any) {
            setError(e.message);
        }
    }, [tree]);

    // ── Copy path to clipboard ────────────────────────────────────────────────

    const handleCopyPath = useCallback((node: FileTreeNode) => {
        navigator.clipboard.writeText(node.virtualPath).catch(() => {});
    }, []);

    // ── Reveal in OS explorer ─────────────────────────────────────────────────

    const handleReveal = useCallback(async (node: FileTreeNode) => {
        try {
            const { osPath } = await controllerClient.resolveOsPath(node.virtualPath);
            if ((window as any).octoml?.openInExplorer) {
                await (window as any).octoml.openInExplorer(osPath);
            }
        } catch (e: any) {
            setError(`Could not reveal in explorer: ${e.message}`);
        }
    }, []);

    // ── Render tree recursively ───────────────────────────────────────────────

    function renderNodes(nodes: FileTreeNode[], depth = 0): React.ReactNode {
        return nodes.map(node => (
            <TreeNode
                key={node.virtualPath}
                node={node}
                depth={depth}
                isExpanded={tree.expandedPaths.has(node.virtualPath)}
                isSelected={tree.selectedPath === node.virtualPath}
                onToggle={tree.toggleExpand}
                onSelect={tree.setSelected}
                onOpen={handleOpen}
                onContextMenu={handleContextMenu}
                onDrop={handleDrop}
                renamingPath={renamingPath}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingPath(null)}
                newItemState={newItemState}
                newItemName={newItemName}
                newItemInputRef={newItemInputRef}
                onNewItemNameChange={setNewItemName}
                onNewItemSubmit={handleNewItemSubmit}
                onNewItemCancel={() => { setNewItemState(null); setNewItemName(''); }}
                expandedPaths={tree.expandedPaths}
                selectedPath={tree.selectedPath}
            />
        ));
    }

    // ── Toolbar ───────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col h-full">
            {/* Header toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-sim-border">
                <span className="text-[11px] font-semibold text-sim-muted uppercase tracking-wider">Explorer</span>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={() => setNewItemState({ parentPath: '/', type: 'file' })}
                        title="New File"
                        className="w-6 h-6 flex items-center justify-center rounded text-sim-muted hover:text-white hover:bg-white/5 transition-colors"
                    >
                        <FilePlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setNewItemState({ parentPath: '/', type: 'folder' })}
                        title="New Folder"
                        className="w-6 h-6 flex items-center justify-center rounded text-sim-muted hover:text-white hover:bg-white/5 transition-colors"
                    >
                        <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => uploadRef.current?.click()}
                        title="Upload Files"
                        className="w-6 h-6 flex items-center justify-center rounded text-sim-muted hover:text-white hover:bg-white/5 transition-colors"
                    >
                        <Upload className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={tree.refresh}
                        title="Refresh"
                        className="w-6 h-6 flex items-center justify-center rounded text-sim-muted hover:text-white hover:bg-white/5 transition-colors"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${tree.isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {(window as any).octoml?.openInExplorer && (
                        <button
                            onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                    const { osPath } = await controllerClient.getProjectOsRoot();
                                    await (window as any).octoml.openInExplorer(osPath);
                                } catch (e: any) {
                                    setError(`Cannot open in Explorer: ${e.message}`);
                                }
                            }}
                            title="Open Project in Explorer"
                            className="w-6 h-6 flex items-center justify-center rounded text-sim-muted hover:text-white hover:bg-white/5 transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <input
                        ref={uploadRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={e => {
                            if (e.target.files?.length) {
                                handleFileUpload(e.target.files, '/');
                                e.target.value = '';
                            }
                        }}
                    />
                </div>
            </div>

            {/* Error banner */}
            {error && (
                <div className="mx-2 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center gap-2">
                    <span className="flex-1">{error}</span>
                    <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">×</button>
                </div>
            )}

            {/* Tree */}
            <div 
                className="flex-1 overflow-y-auto overflow-x-hidden py-1"
                onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    const srcPath = e.dataTransfer.getData('text/plain');
                    if (srcPath) {
                        const srcParent = srcPath.substring(0, srcPath.lastIndexOf('/')) || '/';
                        if (srcParent !== '/' && srcPath !== '/') {
                            handleDrop(srcPath, '/');
                        }
                    }
                }}
            >
                {tree.isLoading && tree.nodes.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-6 text-sim-muted text-xs">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Loading files...
                    </div>
                ) : tree.nodes.length === 0 ? (
                    <div className="px-4 py-6 text-xs text-sim-muted">
                        <p>No files found.</p>
                        <p className="mt-1 opacity-60">Create a file or upload one to get started.</p>
                    </div>
                ) : (
                    <>
                        {/* New item inline input at root */}
                        {newItemState && newItemState.parentPath === '/' && (
                            <div className="flex items-center gap-1.5 px-4 py-1">
                                {newItemState.type === 'file'
                                    ? <File className="w-4 h-4 text-sim-muted" />
                                    : <FolderPlus className="w-4 h-4 text-yellow-400/60" />
                                }
                                <input
                                    ref={newItemInputRef}
                                    value={newItemName}
                                    onChange={e => setNewItemName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter')  handleNewItemSubmit();
                                        if (e.key === 'Escape') { setNewItemState(null); setNewItemName(''); }
                                    }}
                                    onBlur={handleNewItemSubmit}
                                    placeholder={newItemState.type === 'file' ? 'filename.py' : 'folder-name'}
                                    className="flex-1 bg-sim-bg border border-sim-border focus:border-sim-red/50 rounded px-1 text-xs text-sim-text outline-none"
                                />
                            </div>
                        )}
                        {renderNodes(tree.nodes)}
                    </>
                )}
            </div>

            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    node={contextMenu.node}
                    onClose={() => setContextMenu(null)}
                    onNewFile={(p) => { setNewItemState({ parentPath: p, type: 'file' }); if (p !== '/') tree.expandPath(p); }}
                    onNewFolder={(p) => { setNewItemState({ parentPath: p, type: 'folder' }); if (p !== '/') tree.expandPath(p); }}
                    onRename={(node) => setRenamingPath(node.virtualPath)}
                    onDelete={handleDelete}
                    onCopyPath={handleCopyPath}
                    onReveal={handleReveal}
                />
            )}
        </div>
    );
};
