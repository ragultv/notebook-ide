import React, { useState, useRef, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Folder, Upload, Trash2, Edit2, Download, X, MoreVertical,
  File, Image as ImageIcon, FileCode, Search, ChevronRight, Settings
} from 'lucide-react';
import { ProjectFile, CellData } from '../../types';
import { FileExplorer } from '../FileExplorer';
import { RuntimeType } from '../../store/ui.store';
import { RuntimeMenu } from './RuntimeMenu';


// ── Types ─────────────────────────────────────────────────────────────────────

interface SidebarProps {
  files: ProjectFile[];
  onImportFiles: (files: ProjectFile[]) => void;
  onClearFiles: () => void;
  activeFileId: string | null;
  activeFilePath?: string | null;
  onFileSelect: (id: string) => void;
  onDeleteFile?: (id: string) => void;
  onRenameFile?: (id: string, newName: string) => void;
  /** Optional: called when user clicks a search match to jump to that cell */
  onCellFocus?: (fileId: string, cellId: string) => void;
  /** Called when user opens a notebook from the project file tree */
  onOpenNotebook?: (virtualPath: string, name: string) => void;
  /** Called when user opens a non-notebook file */
  onOpenFile?: (virtualPath: string, name: string) => void;
  /** Connect Kernel Action */
  onConnectKernel: (runtime: RuntimeType) => void;
  /** Open Settings Tab */
  onOpenSettings?: () => void;
}

type ActivePanel = 'files' | 'search';

// ── Search result types ───────────────────────────────────────────────────────

interface MatchLine {
  lineNumber: number;  // 1-based line number within the cell
  text: string;        // the full line
  matchStart: number;  // char offset of the match within `text`
  matchEnd: number;
}

interface CellMatch {
  cellId: string;
  cellIndex: number;  // 0-based index in the file's cells array
  cellType: 'code' | 'markdown';
  lines: MatchLine[];
}

interface FileMatch {
  fileId: string;
  fileName: string;
  cells: CellMatch[];
}

// ── Search logic ──────────────────────────────────────────────────────────────

function searchFiles(files: ProjectFile[], query: string): FileMatch[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  const results: FileMatch[] = [];

  for (const file of files) {
    if (!file.cells?.length) continue;
    const cellMatches: CellMatch[] = [];

    file.cells.forEach((cell, cellIndex) => {
      const lines = (cell.content || '').split('\n');
      const matchedLines: MatchLine[] = [];

      lines.forEach((lineText, lineIdx) => {
        const idx = lineText.toLowerCase().indexOf(lower);
        if (idx !== -1) {
          matchedLines.push({
            lineNumber: lineIdx + 1,
            text: lineText,
            matchStart: idx,
            matchEnd: idx + query.length,
          });
        }
      });

      if (matchedLines.length > 0) {
        cellMatches.push({
          cellId: cell.id,
          cellIndex,
          cellType: cell.type as 'code' | 'markdown',
          lines: matchedLines.slice(0, 5), // cap at 5 matching lines per cell
        });
      }
    });

    if (cellMatches.length > 0) {
      results.push({ fileId: file.id, fileName: file.name, cells: cellMatches });
    }
  }

  return results;
}

// ── Highlighted text snippet ──────────────────────────────────────────────────

const HighlightedLine: React.FC<{ text: string; matchStart: number; matchEnd: number }> = ({
  text, matchStart, matchEnd,
}) => {
  // Truncate long lines — show at most 60 chars around the match
  const MAX = 60;
  let display = text;
  let start = matchStart;
  let end = matchEnd;

  if (text.length > MAX) {
    const pad = Math.floor((MAX - (matchEnd - matchStart)) / 2);
    const from = Math.max(0, matchStart - pad);
    const to = Math.min(text.length, from + MAX);
    display = (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
    start = matchStart - from + (from > 0 ? 1 : 0); // adjust for ellipsis char
    end = start + (matchEnd - matchStart);
  }

  return (
    <span className="font-mono text-[10px] text-gray-400 leading-relaxed truncate block">
      {display.slice(0, start)}
      <mark className="bg-yellow-400/30 text-yellow-200 rounded-[2px] not-italic">
        {display.slice(start, end)}
      </mark>
      {display.slice(end)}
    </span>
  );
};

// ── Main Sidebar ──────────────────────────────────────────────────────────────

export const Sidebar: React.FC<SidebarProps> = ({
  files,
  onImportFiles,
  onClearFiles,
  activeFileId,
  activeFilePath,
  onFileSelect,
  onDeleteFile,
  onRenameFile,
  onCellFocus,
  onOpenNotebook,
  onOpenFile,
  onConnectKernel,
  onOpenSettings,
}) => {
  const [activePanel, setActivePanel] = useState<ActivePanel>('files');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileMatch[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Focus search input when panel opens
  useEffect(() => {
    if (activePanel === 'search' && drawerOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 150);
    }
  }, [activePanel, drawerOpen]);

  // Run search whenever query or files change
  useEffect(() => {
    const id = setTimeout(() => {
      const results = searchFiles(files, searchQuery);
      setSearchResults(results);
      // Auto-expand all matching files
      setExpandedFiles(new Set(results.map(r => r.fileId)));
    }, 150); // debounce 150ms
    return () => clearTimeout(id);
  }, [searchQuery, files]);

  // ── Panel switching ──────────────────────────────────────────────────────────
  const switchPanel = (panel: ActivePanel) => {
    if (activePanel === panel) {
      setDrawerOpen(v => !v);
    } else {
      setActivePanel(panel);
      setDrawerOpen(true);
    }
  };

  // ── File import ───────────────────────────────────────────────────────────────
  const handleUploadClick = () => fileInputRef.current?.click();

  const parseIpynb = (content: string): CellData[] => {
    try {
      const json = JSON.parse(content);
      if (!json.cells || !Array.isArray(json.cells)) return [];
      return json.cells.map((c: any) => {
        const rawSource = c.source;
        const contentStr = Array.isArray(rawSource) ? rawSource.join('') : (rawSource || '');
        let outputStr = '';
        let status: 'idle' | 'success' | 'error' = 'idle';
        if (c.outputs?.length > 0) {
          status = 'success';
          c.outputs.forEach((o: any) => {
            if (o.text) outputStr += Array.isArray(o.text) ? o.text.join('') : o.text;
            else if (o.data?.['text/plain']) {
              const txt = o.data['text/plain'];
              outputStr += Array.isArray(txt) ? txt.join('') : txt;
            }
            if (o.output_type === 'error') { status = 'error'; outputStr += `\n${o.ename}: ${o.evalue}`; }
          });
        }
        return { id: uuidv4(), type: c.cell_type === 'markdown' ? 'markdown' : 'code', content: contentStr, status, output: outputStr, executionCount: c.execution_count };
      });
    } catch { return []; }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      const uploaded = Array.from(e.target.files) as File[];
      const newFiles: ProjectFile[] = [];
      for (const f of uploaded) {
        const isNotebook = f.name.endsWith('.ipynb');
        let cells: CellData[] | undefined;
        if (isNotebook) { try { cells = parseIpynb(await f.text()); } catch { } }
        newFiles.push({ id: uuidv4(), name: f.name, type: f.type || (isNotebook ? 'application/json' : 'text/plain'), file: f, cells });
      }
      onImportFiles(newFiles);
    }
    if (e.target.value) e.target.value = '';
  };

  // ── Context menu ──────────────────────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, fileId });
  };

  const startRenaming = (e: React.MouseEvent, fileId: string, currentName: string) => {
    e.stopPropagation();
    setEditingFileId(fileId); setEditName(currentName); setContextMenu(null);
  };

  const finishRenaming = () => {
    if (editingFileId && onRenameFile) onRenameFile(editingFileId, editName);
    setEditingFileId(null);
  };

  const requestDelete = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    onDeleteFile?.(fileId); setContextMenu(null);
  };

  const handleDownload = (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    let blob: Blob;
    if (file.name.endsWith('.ipynb') && file.cells) {
      const nb = {
        metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { codemirror_mode: { name: 'ipython', version: 3 }, file_extension: '.py', mimetype: 'text/x-python', name: 'python', nbconvert_exporter: 'python', pygments_lexer: 'ipython3', version: '3.8.0' } },
        nbformat: 4, nbformat_minor: 4,
        cells: file.cells.map(cell => ({
          cell_type: cell.type, metadata: {},
          source: cell.content.split('\n').map((l, i, a) => i === a.length - 1 ? l : l + '\n'),
          outputs: cell.output ? [{ name: 'stdout', output_type: 'stream', text: cell.output.split('\n').map((l, i, a) => i === a.length - 1 ? l : l + '\n') }] : [],
          execution_count: cell.type === 'code' ? (cell.executionCount || null) : null,
        })),
      };
      blob = new Blob([JSON.stringify(nb, null, 2)], { type: 'application/x-ipynb+json' });
    } else if (file.file) {
      blob = file.file;
    } else {
      blob = new Blob([''], { type: 'text/plain' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    setContextMenu(null);
  };

  // ── Search helpers ────────────────────────────────────────────────────────────
  const totalMatches = searchResults.reduce((sum, r) => sum + r.cells.reduce((s, c) => s + c.lines.length, 0), 0);

  const handleMatchClick = (fileId: string, cellId: string) => {
    onFileSelect(fileId);
    // Small delay to let the file switch before focussing the cell
    setTimeout(() => onCellFocus?.(fileId, cellId), 100);
  };

  const toggleFileExpand = (fileId: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(fileId) ? next.delete(fileId) : next.add(fileId);
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-sim-bg z-10 shrink-0 relative rounded-2xl border border-sim-border overflow-hidden shadow-lg transition-all duration-300">

      {/* ── Activity Bar ── */}
      <div className="w-14 h-full flex flex-col items-center py-4 bg-sim-bg gap-2 z-20 shrink-0 border-r border-sim-border">
        <SidebarIcon
          icon={Folder}
          isActive={drawerOpen && activePanel === 'files'}
          onClick={() => switchPanel('files')}
          label="Files"
        />
        <SidebarIcon
          icon={Search}
          isActive={drawerOpen && activePanel === 'search'}
          onClick={() => switchPanel('search')}
          label="Search in Notebooks"
        />
        <div className="mt-auto pb-2">
          <SidebarIcon
            icon={Settings}
            isActive={false}
            onClick={() => onOpenSettings?.()}
            label="Settings"
          />
        </div>
      </div>

      {/* ── Drawer ── */}
      <div
        className={`bg-sim-surface border-r border-sim-border transition-all duration-300 ease-in-out flex flex-col overflow-hidden h-full
          ${drawerOpen ? 'w-64 opacity-100' : 'w-0 opacity-0'}`}
      >

        {/* ━━ FILES panel ━━ */}
        {activePanel === 'files' && (
          <>
            <div className="h-14 flex items-center justify-between px-4 shrink-0 border-b border-sim-border">
              <span className="text-sm font-semibold text-sim-text tracking-wide">Explorer</span>
              <button onClick={() => setDrawerOpen(false)} className="text-sim-muted hover:text-sim-text hover:bg-sim-border/55 rounded p-1 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Project file tree */}
            <div className="flex-1 overflow-hidden">
              <FileExplorer
                activeFilePath={activeFilePath}
                onOpenNotebook={onOpenNotebook}
                onOpenFile={onOpenFile}
                onDeleteFile={(virtualPath) => {
                  const file = files.find(f => f.path === virtualPath);
                  if (file && onDeleteFile) {
                    onDeleteFile(file.id);
                  }
                }}
              />
            </div>
          </>
        )}

        {/* ━━ SEARCH panel ━━ */}
        {activePanel === 'search' && (
          <>
            <div className="h-14 flex items-center justify-between px-4 shrink-0 border-b border-sim-border">
              <span className="text-sm font-semibold text-sim-text tracking-wide">Search</span>
              <button onClick={() => setDrawerOpen(false)} className="text-sim-muted hover:text-sim-text hover:bg-sim-border/55 rounded p-1 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">

              {/* Search input */}
              <div className="px-2 pt-3 pb-2 shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search in notebooks…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-sim-bg border border-sim-border focus:border-sim-red/50
                      rounded-lg py-2 pl-8 pr-8 text-xs text-sim-text
                      placeholder-sim-muted outline-none transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Result count */}
                {searchQuery.trim() && (
                  <p className="text-[10px] text-gray-600 mt-1.5 px-1">
                    {totalMatches === 0
                      ? 'No results'
                      : `${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in ${searchResults.length} file${searchResults.length !== 1 ? 's' : ''}`}
                  </p>
                )}
              </div>

              {/* Results list */}
              <div className="flex-1 overflow-y-auto">
                {searchQuery.trim() === '' ? (
                  <div className="flex flex-col items-center justify-center pt-12 text-center px-4 opacity-40">
                    <Search className="w-8 h-8 text-gray-600 mb-2" />
                    <span className="text-xs text-gray-500">Type to search cell content</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="text-center pt-12 text-xs text-gray-600 opacity-60">No matches found</div>
                ) : (
                  <div className="py-1">
                    {searchResults.map(fileMatch => (
                      <div key={fileMatch.fileId}>
                        {/* File header — collapsible */}
                        <button
                          onClick={() => toggleFileExpand(fileMatch.fileId)}
                          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-white/5 transition-colors group"
                        >
                          <ChevronRight
                            className={`w-3 h-3 text-gray-500 shrink-0 transition-transform ${expandedFiles.has(fileMatch.fileId) ? 'rotate-90' : ''}`}
                          />
                          <FileCode className="w-3.5 h-3.5 text-sim-red shrink-0" />
                          <span className="text-xs font-medium text-gray-300 truncate flex-1">{fileMatch.fileName}</span>
                          <span className="text-[10px] text-gray-600 shrink-0">
                            {fileMatch.cells.reduce((s, c) => s + c.lines.length, 0)}
                          </span>
                        </button>

                        {/* Cell matches */}
                        {expandedFiles.has(fileMatch.fileId) && fileMatch.cells.map(cellMatch => (
                          <div key={cellMatch.cellId}>
                            {/* Cell header */}
                            <div className="flex items-center gap-1.5 px-5 py-0.5">
                              <span className="text-[9px] uppercase tracking-widest text-gray-600 font-mono">
                                {cellMatch.cellType} cell {cellMatch.cellIndex + 1}
                              </span>
                            </div>

                            {/* Matching lines */}
                            {cellMatch.lines.map((line, li) => (
                              <button
                                key={li}
                                onClick={() => handleMatchClick(fileMatch.fileId, cellMatch.cellId)}
                                className="w-full text-left px-5 py-1 hover:bg-white/5 transition-colors group"
                              >
                                <div className="flex items-start gap-1.5">
                                  <span className="text-[9px] text-gray-700 font-mono w-5 shrink-0 pt-0.5 text-right">
                                    {line.lineNumber}
                                  </span>
                                  <HighlightedLine
                                    text={line.text}
                                    matchStart={line.matchStart}
                                    matchEnd={line.matchEnd}
                                  />
                                </div>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        
        {/* ━━ Bottom Kernel Connector ━━ */}
        <div className="p-3 border-t border-sim-border bg-sim-surface shrink-0 mt-auto">
          <RuntimeMenu onConnect={onConnectKernel} />
        </div>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-sim-surface border border-sim-border shadow-xl rounded-lg py-1 w-36 flex flex-col overflow-hidden text-sim-text"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={e => startRenaming(e, contextMenu.fileId, files.find(f => f.id === contextMenu.fileId)?.name || '')}
            className="flex items-center gap-2 px-3 py-2 text-xs text-sim-text hover:bg-sim-selection text-left transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" /> Rename
          </button>
          <button
            onClick={() => handleDownload(contextMenu.fileId)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-sim-text hover:bg-sim-selection text-left transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </button>
          <div className="h-[1px] bg-sim-border my-1" />
          <button
            onClick={e => requestDelete(e, contextMenu.fileId)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-sim-red hover:bg-sim-red/10 text-left transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────────

const SidebarIcon: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  onClick: () => void;
  label: string;
}> = ({ icon: Icon, isActive, onClick, label }) => (
  <button
    onClick={onClick}
    title={label}
    className={`p-2.5 rounded-xl transition-all duration-150 ${isActive
        ? 'text-sim-red bg-sim-selection'
        : 'text-sim-muted hover:text-sim-text hover:bg-sim-selection'
      }`}
  >
    <Icon className="w-5 h-5" />
  </button>
);

const FileTreeItem: React.FC<{
  id: string;
  name: string;
  fileType?: string;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  isEditing: boolean;
  editValue: string;
  onEditChange: (val: string) => void;
  onEditSubmit: () => void;
}> = ({ id, name, fileType, isActive, onClick, onContextMenu, isEditing, editValue, onEditChange, onEditSubmit }) => {
  let RenderIcon: React.ComponentType<{ className?: string }> = File;
  if (fileType?.startsWith('image/') || name.match(/\.(png|jpg|jpeg|gif|svg)$/i)) RenderIcon = ImageIcon;
  else if (name.match(/\.(py|ipynb|js|ts|tsx)$/i)) RenderIcon = FileCode;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-sim-file-id', id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="select-none mb-0.5">
      <div
        onClick={!isEditing ? onClick : undefined}
        onContextMenu={!isEditing ? onContextMenu : undefined}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        className={`flex items-center gap-2 py-1.5 px-3 rounded-lg cursor-pointer group transition-all duration-200
          ${isActive ? 'bg-sim-selection text-sim-red shadow-sm' : 'text-sim-muted hover:text-sim-text hover:bg-sim-selection'}`}
      >
        <RenderIcon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-sim-red' : 'text-gray-500 group-hover:text-gray-400'}`} />

        {isEditing ? (
          <input
            autoFocus
            value={editValue}
            onChange={e => onEditChange(e.target.value)}
            onBlur={onEditSubmit}
            onKeyDown={e => { if (e.key === 'Enter') onEditSubmit(); }}
            className="bg-black/50 text-white text-xs p-1 w-full rounded border border-sim-red outline-none"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-xs font-medium">{name}</span>
        )}

        {!isEditing && (
          <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onContextMenu} className="p-0.5 hover:text-white rounded">
              <MoreVertical className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};