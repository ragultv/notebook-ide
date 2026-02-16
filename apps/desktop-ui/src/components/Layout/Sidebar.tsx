import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Folder, Upload, Trash2, Edit2, Download, X, MoreVertical, File, Image as ImageIcon, FileCode } from 'lucide-react';
import { ProjectFile, CellData } from '../../types';

interface SidebarProps {
  files: ProjectFile[];
  onImportFiles: (files: ProjectFile[]) => void;
  onClearFiles: () => void;
  activeFileId: string | null;
  onFileSelect: (id: string) => void;
  onDeleteFile?: (id: string) => void;
  onRenameFile?: (id: string, newName: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  files,
  onImportFiles,
  onClearFiles,
  activeFileId,
  onFileSelect,
  onDeleteFile,
  onRenameFile
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const parseIpynb = (content: string): CellData[] => {
    try {
      const json = JSON.parse(content);
      if (!json.cells || !Array.isArray(json.cells)) return [];

      return json.cells.map((c: any) => {
        const rawSource = c.source;
        const contentStr = Array.isArray(rawSource) ? rawSource.join('') : (rawSource || '');
        let outputStr = '';
        let status: 'idle' | 'success' | 'error' = 'idle';

        if (c.outputs && c.outputs.length > 0) {
          status = 'success';
          c.outputs.forEach((o: any) => {
            if (o.text) {
              outputStr += Array.isArray(o.text) ? o.text.join('') : o.text;
            } else if (o.data && o.data['text/plain']) {
              const txt = o.data['text/plain'];
              outputStr += Array.isArray(txt) ? txt.join('') : txt;
            }
            if (o.output_type === 'error') {
              status = 'error';
              outputStr += `\n${o.ename}: ${o.evalue}`;
            }
          });
        }

        return {
          id: uuidv4(),
          type: c.cell_type === 'markdown' ? 'markdown' : 'code',
          content: contentStr,
          status: status,
          output: outputStr,
          executionCount: c.execution_count
        };
      });
    } catch (e) {
      console.error("Failed to parse ipynb", e);
      return [];
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const uploadedFiles = Array.from(e.target.files) as File[];
      const newProjectFiles: ProjectFile[] = [];

      for (const f of uploadedFiles) {
        const isNotebook = f.name.endsWith('.ipynb');
        let cells: CellData[] | undefined = undefined;

        if (isNotebook) {
          try {
            const text = await f.text();
            cells = parseIpynb(text);
          } catch (err) {
            console.error(`Error reading file ${f.name}`, err);
          }
        }

        newProjectFiles.push({
          id: uuidv4(),
          name: f.name,
          type: f.type || (isNotebook ? 'application/json' : 'text/plain'),
          file: f,
          cells: cells
        });
      }

      onImportFiles(newProjectFiles);
    }
    if (e.target.value) e.target.value = '';
  };

  const handleContextMenu = (e: React.MouseEvent, fileId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, fileId });
  };

  const startRenaming = (e: React.MouseEvent, fileId: string, currentName: string) => {
    e.stopPropagation();
    setEditingFileId(fileId);
    setEditName(currentName);
    setContextMenu(null);
  };

  const finishRenaming = () => {
    if (editingFileId && onRenameFile) {
      onRenameFile(editingFileId, editName);
    }
    setEditingFileId(null);
  };

  const requestDelete = (e: React.MouseEvent, fileId: string) => {
    e.stopPropagation();
    if (onDeleteFile) onDeleteFile(fileId);
    setContextMenu(null);
  };

  const handleDownload = (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file) return;

    let blob: Blob;

    if (file.name.endsWith('.ipynb') && file.cells) {
      const notebookContent = {
        metadata: {
          kernelspec: {
            display_name: "Python 3",
            language: "python",
            name: "python3"
          },
          language_info: {
            codemirror_mode: { name: "ipython", version: 3 },
            file_extension: ".py",
            mimetype: "text/x-python",
            name: "python",
            nbconvert_exporter: "python",
            pygments_lexer: "ipython3",
            version: "3.8.0"
          }
        },
        nbformat: 4,
        nbformat_minor: 4,
        cells: file.cells.map(cell => ({
          cell_type: cell.type,
          metadata: {},
          source: cell.content.split('\n').map((line, i, arr) => i === arr.length - 1 ? line : line + '\n'),
          outputs: cell.output ? [{
            name: "stdout",
            output_type: "stream",
            text: cell.output.split('\n').map((line, i, arr) => i === arr.length - 1 ? line : line + '\n')
          }] : [],
          execution_count: cell.type === 'code' ? (cell.executionCount || null) : null
        }))
      };

      blob = new Blob([JSON.stringify(notebookContent, null, 2)], { type: 'application/x-ipynb+json' });
    } else if (file.file) {
      blob = file.file;
    } else {
      blob = new Blob([''], { type: 'text/plain' });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setContextMenu(null);
  };

  return (
    <div className="flex h-full bg-[#09090b] z-10 shrink-0 relative rounded-2xl border border-sim-border overflow-hidden shadow-lg transition-all duration-300">
      {/* Icon Strip */}
      <div className="w-14 h-full flex flex-col items-center py-4 bg-[#09090b] gap-6 z-20 shrink-0 border-r border-sim-border/50">
        <SidebarIcon icon={Folder} isActive={isOpen} onClick={() => setIsOpen(!isOpen)} label="Files" />
      </div>

      {/* Drawer */}
      <div
        className={`bg-[#1e1e20] transition-all duration-300 ease-in-out flex flex-col overflow-hidden h-full
          ${isOpen ? 'w-64 opacity-100' : 'w-0 opacity-0'}
        `}
      >
        <div className="h-14 flex items-center justify-between px-4 shrink-0 border-b border-sim-border/30">
          <span className="text-sm font-semibold text-gray-200 tracking-wide">Files</span>
          <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white rounded p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden px-2 py-2">
          {/* File Actions */}
          <div className="flex items-center gap-1 mb-2 px-1">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
              multiple
              accept=".ipynb,.py,.csv,.json,.txt,.png,.jpg,.jpeg,.svg"
            />
            <button
              onClick={handleUploadClick}
              className="flex-1 flex items-center justify-center gap-2 bg-[#2b2b2e] hover:bg-[#3a3a3c] text-xs font-medium text-gray-300 py-1.5 rounded-lg transition-colors"
            >
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
            <button
              onClick={onClearFiles}
              className="flex items-center justify-center p-1.5 bg-[#2b2b2e] hover:bg-sim-red/20 text-gray-400 hover:text-sim-red rounded-lg transition-colors"
              title="Clear All"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="space-y-0.5">
              {files.length === 0 && (
                <div className="flex flex-col items-center justify-center pt-10 text-center px-4 opacity-50">
                  <Folder className="w-8 h-8 text-gray-600 mb-2" />
                  <span className="text-xs text-gray-500">
                    No files open.
                  </span>
                </div>
              )}

              {files.map((file) => (
                <FileTreeItem
                  key={file.id}
                  id={file.id}
                  name={file.name}
                  fileType={file.type}
                  isActive={file.id === activeFileId}
                  onClick={() => onFileSelect(file.id)}
                  onContextMenu={(e) => handleContextMenu(e, file.id)}
                  isEditing={editingFileId === file.id}
                  editValue={editName}
                  onEditChange={setEditName}
                  onEditSubmit={finishRenaming}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu Portal */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#27272a] border border-[#3a3a3c] shadow-xl rounded-lg py-1 w-36 flex flex-col animate-in fade-in zoom-in-95 duration-100 overflow-hidden"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => startRenaming(e, contextMenu.fileId, files.find(f => f.id === contextMenu.fileId)?.name || '')}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-[#3a3a3c] hover:text-white text-left transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" /> Rename
          </button>
          <button
            onClick={() => handleDownload(contextMenu.fileId)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-[#3a3a3c] hover:text-white text-left transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </button>
          <div className="h-[1px] bg-[#3a3a3c] my-1"></div>
          <button
            onClick={(e) => requestDelete(e, contextMenu.fileId)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-sim-red hover:bg-sim-red/10 hover:text-sim-redHover text-left transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
};

const SidebarIcon: React.FC<{ icon: React.ComponentType<any>; isActive: boolean; onClick: () => void; label: string }> = ({
  icon: Icon,
  isActive,
  onClick,
  label
}) => (
  <button
    onClick={onClick}
    title={label}
    className={`p-2.5 rounded-xl transition-all ${isActive ? 'text-sim-red bg-[#1e1e20]' : 'text-gray-500 hover:text-gray-300 hover:bg-[#1e1e20]/50'
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
  let RenderIcon = File;
  if (fileType?.startsWith('image/') || name.match(/\.(png|jpg|jpeg|gif|svg)$/i)) {
    RenderIcon = ImageIcon;
  } else if (name.endsWith('.csv') || name.endsWith('.json')) {
    RenderIcon = File;
  } else if (name.endsWith('.py') || name.endsWith('.ipynb') || name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.tsx')) {
    RenderIcon = FileCode;
  }

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
          ${isActive
            ? 'bg-[#2b2b2e] text-sim-red shadow-sm'
            : 'text-gray-400 hover:text-gray-200 hover:bg-[#2b2b2e]/50'}
        `}
      >
        <RenderIcon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-sim-red' : 'text-gray-500 group-hover:text-gray-400'
          }`} />

        {isEditing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onEditSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditSubmit();
            }}
            className="bg-black/50 text-white text-xs p-1 w-full rounded border border-sim-red outline-none"
            onClick={(e) => e.stopPropagation()}
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