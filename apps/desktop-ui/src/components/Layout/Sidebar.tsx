import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Folder, Upload, RefreshCw, FileCode, File, Image as ImageIcon, X, Trash2, Edit2, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { ProjectFile, CellData } from '../../types';

interface SidebarProps {
  files: ProjectFile[];
  setFiles: React.Dispatch<React.SetStateAction<ProjectFile[]>>;
  activeFileId: string | null;
  onFileSelect: (id: string) => void;
  onDeleteFile?: (id: string) => void;
  onRenameFile?: (id: string, newName: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  files, 
  setFiles, 
  activeFileId, 
  onFileSelect,
  onDeleteFile,
  onRenameFile
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [showOpenFiles, setShowOpenFiles] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  
  // Rename State
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Close context menu on global click
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

      setFiles(prev => [...prev, ...newProjectFiles]);
      const firstNotebook = newProjectFiles.find(f => f.name.endsWith('.ipynb') && f.cells);
      if (firstNotebook) {
        onFileSelect(firstNotebook.id);
      }
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
      // Reconstruct valid .ipynb JSON
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
          // Split content into lines for better git compatibility/standard format
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
    <div className="flex h-full bg-sim-bg border-r border-sim-border z-10 shrink-0 relative">
      {/* Icon Strip */}
      <div className="w-12 flex flex-col items-center py-4 bg-sim-bg border-r border-sim-border gap-6 z-20">
        <SidebarIcon icon={Folder} isActive={isOpen} onClick={() => setIsOpen(!isOpen)} label="Files" />
      </div>

      {/* Drawer */}
      <div 
        className={`bg-sim-surface transition-all duration-300 ease-in-out flex flex-col overflow-hidden border-r border-sim-border ${
          isOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 border-r-0'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-sim-border">
          <span className="uppercase text-xs font-bold text-sim-muted tracking-wider font-mono">Files</span>
          <button onClick={() => setIsOpen(false)} className="text-sim-muted hover:text-white rounded p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Open Files Section */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <button
            onClick={() => setShowOpenFiles(!showOpenFiles)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-sim-muted hover:text-white uppercase tracking-wide border-b border-sim-border"
          >
            {showOpenFiles ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <FileCode className="w-3 h-3" />
            Open Files ({files.length})
          </button>
          
          {showOpenFiles && (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-1 p-2 border-b border-sim-border bg-sim-bg/50">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={handleFileChange} 
                  multiple 
                  accept=".ipynb,.py,.csv,.json,.txt,.png,.jpg,.jpeg,.svg" 
                />
                <ToolbarButton icon={Upload} label="Upload" onClick={handleUploadClick} />
                <ToolbarButton icon={RefreshCw} label="Refresh" onClick={() => {}} />
                <div className="flex-1"></div>
                <ToolbarButton icon={Trash2} label="Clear" onClick={() => setFiles([])} />
              </div>
              
              {/* File Tree */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-3 text-sm text-sim-text font-mono relative">
                {files.length === 0 && (
                  <div className="text-xs text-sim-muted italic text-center mt-4 opacity-50">
                    No files open.
                    <br/>Open from explorer or upload .ipynb
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
            </>
          )}
        </div>
      </div>

      {/* Context Menu Portal */}
      {contextMenu && (
        <div 
           className="fixed z-50 bg-[#18181b] border border-[#27272a] shadow-xl rounded-md py-1 w-32 flex flex-col animate-in fade-in zoom-in-95 duration-100"
           style={{ top: contextMenu.y, left: contextMenu.x }}
           onClick={(e) => e.stopPropagation()}
        >
           <button 
             onClick={(e) => startRenaming(e, contextMenu.fileId, files.find(f => f.id === contextMenu.fileId)?.name || '')}
             className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-[#27272a] hover:text-white text-left"
           >
             <Edit2 className="w-3.5 h-3.5" /> Rename
           </button>
           <button 
             onClick={() => handleDownload(contextMenu.fileId)}
             className="flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-[#27272a] hover:text-white text-left"
           >
             <Download className="w-3.5 h-3.5" /> Download
           </button>
           <div className="h-[1px] bg-[#27272a] my-1"></div>
           <button 
             onClick={(e) => requestDelete(e, contextMenu.fileId)}
             className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-[#27272a] hover:text-red-300 text-left"
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
    className={`p-2 rounded-lg transition-all ${
      isActive ? 'text-white bg-sim-surface border border-sim-border' : 'text-sim-muted hover:text-white hover:bg-sim-surface'
    }`}
  >
    <Icon className="w-5 h-5" />
  </button>
);

const ToolbarButton: React.FC<{ icon: React.ComponentType<any>; label: string; onClick: () => void }> = ({ icon: Icon, label, onClick }) => (
  <button 
    title={label} 
    onClick={onClick}
    className="p-1.5 text-sim-muted hover:text-white hover:bg-sim-surface rounded transition-colors"
  >
    <Icon className="w-3.5 h-3.5" />
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
  let FileIcon = File;
  if (fileType?.startsWith('image/') || name.match(/\.(png|jpg|jpeg|gif|svg)$/i)) {
    FileIcon = ImageIcon;
  } else if (name.endsWith('.csv') || name.endsWith('.json')) {
    FileIcon = File;
  } else if (name.endsWith('.py') || name.endsWith('.ipynb') || name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.tsx')) {
    FileIcon = FileCode;
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-sim-file-id', id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="select-none mb-1">
      <div 
        onClick={!isEditing ? onClick : undefined}
        onContextMenu={!isEditing ? onContextMenu : undefined}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer group transition-colors hover:bg-sim-selection/50
          ${isActive 
            ? 'bg-sim-selection text-white border-l-2 border-sim-red' 
            : 'text-sim-muted hover:text-gray-200 border-l-2 border-transparent'}
        `}
      >
        <FileIcon className={`w-4 h-4 flex-shrink-0 transition-colors ${isActive ? 'text-sim-red' : 'text-sim-muted group-hover:text-gray-300'}`} />
        
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
           <span className="truncate">{name}</span>
        )}
      </div>
    </div>
  );
};