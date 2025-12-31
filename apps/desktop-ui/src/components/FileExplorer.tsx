import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, FolderOpen, File, FileCode, FileText, Database, Image, 
  ChevronRight, ChevronDown, Plus, FolderPlus, Upload, RefreshCw,
  MoreVertical, Trash2, Edit2
} from 'lucide-react';
import { controllerClient, ProjectInfo, FileItem } from '../services/controller.client';

interface FileExplorerProps {
  onFileSelect: (path: string, type: 'notebook' | 'data' | 'other') => void;
  onProjectChange?: (project: ProjectInfo | null) => void;
}

interface TreeNode extends FileItem {
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onProjectChange }) => {
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<TreeNode[]>([]);
  const [recentProjects, setRecentProjects] = useState<{ path: string; name: string; opened: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Load recent projects on mount
  useEffect(() => {
    loadRecentProjects();
  }, []);

  const loadRecentProjects = async () => {
    try {
      const result = await controllerClient.getRecentProjects();
      setRecentProjects(result.recent || []);
    } catch (e) {
      console.error('Failed to load recent projects:', e);
    }
  };

  const loadProjectFiles = useCallback(async (path?: string) => {
    setIsLoading(true);
    try {
      const result = await controllerClient.listFiles(path);
      setFiles(result.items.map(item => ({ ...item, children: item.type === 'directory' ? [] : undefined })));
    } catch (e) {
      console.error('Failed to load files:', e);
    }
    setIsLoading(false);
  }, []);

  const handleOpenProject = async () => {
    // Use browser's folder picker
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        // Get the root folder path from the first file
        const firstFile = files[0];
        const relativePath = firstFile.webkitRelativePath;
        const folderName = relativePath.split('/')[0];
        
        // Since browser doesn't give us full path, prompt user
        const fullPath = prompt('Enter the full path to the project folder:', `C:\\Projects\\${folderName}`);
        if (fullPath) {
          try {
            const result = await controllerClient.openProject(fullPath, folderName);
            setCurrentProject(result.project);
            onProjectChange?.(result.project);
            loadProjectFiles();
          } catch (e: any) {
            alert(`Failed to open project: ${e.message}`);
          }
        }
      }
    };
    input.click();
  };

  const handleOpenRecentProject = async (path: string, name: string) => {
    try {
      const result = await controllerClient.openProject(path, name);
      setCurrentProject(result.project);
      onProjectChange?.(result.project);
      loadProjectFiles();
    } catch (e: any) {
      alert(`Failed to open project: ${e.message}`);
    }
  };

  const handleCreateProject = async () => {
    const path = prompt('Enter the full path for the new project:');
    if (!path) return;
    
    const name = path.split(/[/\\]/).pop() || 'New Project';
    
    try {
      const result = await controllerClient.createProject(path, name);
      setCurrentProject(result.project);
      onProjectChange?.(result.project);
      loadProjectFiles();
    } catch (e: any) {
      alert(`Failed to create project: ${e.message}`);
    }
  };

  const handleToggleFolder = async (node: TreeNode) => {
    const newExpanded = new Set(expandedPaths);
    
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      
      // Load children if not loaded
      if (!node.children || node.children.length === 0) {
        try {
          const result = await controllerClient.listFiles(node.path);
          setFiles(prevFiles => updateTreeNode(prevFiles, node.path, {
            children: result.items.map(item => ({ ...item, children: item.type === 'directory' ? [] : undefined }))
          }));
        } catch (e) {
          console.error('Failed to load folder:', e);
        }
      }
    }
    
    setExpandedPaths(newExpanded);
  };

  const updateTreeNode = (nodes: TreeNode[], targetPath: string, update: Partial<TreeNode>): TreeNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return { ...node, ...update };
      }
      if (node.children) {
        return { ...node, children: updateTreeNode(node.children, targetPath, update) };
      }
      return node;
    });
  };

  const handleFileClick = (node: TreeNode) => {
    if (node.type === 'directory') {
      handleToggleFolder(node);
    } else {
      const ext = node.extension?.toLowerCase();
      if (ext === '.ipynb') {
        onFileSelect(node.path, 'notebook');
      } else if (['.csv', '.json', '.xlsx', '.parquet', '.pkl'].includes(ext || '')) {
        onFileSelect(node.path, 'data');
      } else {
        onFileSelect(node.path, 'other');
      }
    }
  };

  const handleUploadData = async () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadFiles = e.target.files;
    if (!uploadFiles || !currentProject) return;

    const destination = `${currentProject.path}/data`;
    
    for (const file of Array.from(uploadFiles)) {
      try {
        await controllerClient.uploadFile(file, `${destination}/${file.name}`);
      } catch (e) {
        console.error('Upload failed:', e);
      }
    }
    
    loadProjectFiles();
    e.target.value = '';
  };

  const handleCreateFolder = async () => {
    if (!currentProject) return;
    
    const name = prompt('Enter folder name:');
    if (!name) return;
    
    try {
      await controllerClient.createFolder(currentProject.path, name);
      loadProjectFiles();
    } catch (e: any) {
      alert(`Failed to create folder: ${e.message}`);
    }
  };

  const handleDelete = async (path: string) => {
    if (!confirm('Are you sure you want to delete this?')) return;
    
    try {
      await controllerClient.deleteFile(path);
      loadProjectFiles();
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    }
    setContextMenu(null);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const getFileIcon = (node: TreeNode) => {
    if (node.type === 'directory') {
      return expandedPaths.has(node.path) ? FolderOpen : Folder;
    }
    
    const ext = node.extension?.toLowerCase();
    switch (ext) {
      case '.ipynb':
        return FileCode;
      case '.py':
        return FileCode;
      case '.csv':
      case '.json':
      case '.xlsx':
      case '.parquet':
        return Database;
      case '.png':
      case '.jpg':
      case '.jpeg':
      case '.gif':
        return Image;
      default:
        return FileText;
    }
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const Icon = getFileIcon(node);
    const isExpanded = expandedPaths.has(node.path);
    
    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-1 py-1 px-2 hover:bg-sim-surface cursor-pointer rounded text-xs"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => handleFileClick(node)}
          onContextMenu={(e) => handleContextMenu(e, node.path)}
        >
          {node.type === 'directory' && (
            <span className="w-3 text-sim-muted">
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
          {node.type !== 'directory' && <span className="w-3" />}
          <Icon className="w-4 h-4 text-sim-muted shrink-0" />
          <span className="truncate text-sim-text">{node.name}</span>
        </div>
        
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // No project open - show welcome screen
  if (!currentProject) {
    return (
      <div className="h-full flex flex-col p-3 text-xs">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept=".csv,.json,.xlsx,.parquet,.pkl,.png,.jpg,.jpeg"
          onChange={handleFileUpload}
        />
        
        <div className="text-center text-sim-muted mb-4">
          <p className="mb-2">No project open</p>
        </div>
        
        <button
          onClick={handleOpenProject}
          className="w-full py-2 px-3 bg-sim-surface hover:bg-sim-border border border-sim-border rounded text-sim-text mb-2 flex items-center gap-2 justify-center"
        >
          <FolderOpen className="w-4 h-4" />
          Open Project
        </button>
        
        <button
          onClick={handleCreateProject}
          className="w-full py-2 px-3 bg-sim-accent hover:bg-sim-accent/80 rounded text-white mb-4 flex items-center gap-2 justify-center"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
        
        {recentProjects.length > 0 && (
          <div className="mt-2">
            <p className="text-sim-muted mb-2 uppercase tracking-wide">Recent Projects</p>
            <div className="space-y-1">
              {recentProjects.slice(0, 5).map((project, i) => (
                <button
                  key={i}
                  onClick={() => handleOpenRecentProject(project.path, project.name)}
                  className="w-full py-1.5 px-2 hover:bg-sim-surface rounded text-left truncate text-sim-text flex items-center gap-2"
                >
                  <Folder className="w-3 h-3 text-sim-muted shrink-0" />
                  <span className="truncate">{project.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Project is open - show file tree
  return (
    <div className="h-full flex flex-col text-xs">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        accept=".csv,.json,.xlsx,.parquet,.pkl,.png,.jpg,.jpeg"
        onChange={handleFileUpload}
      />
      
      {/* Project header */}
      <div className="flex items-center justify-between p-2 border-b border-sim-border bg-sim-bg/50">
        <span className="font-semibold text-sim-text truncate flex-1" title={currentProject.path}>
          {currentProject.name}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleUploadData}
            className="p-1 hover:bg-sim-surface rounded text-sim-muted hover:text-white"
            title="Upload data files"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCreateFolder}
            className="p-1 hover:bg-sim-surface rounded text-sim-muted hover:text-white"
            title="New folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => loadProjectFiles()}
            className="p-1 hover:bg-sim-surface rounded text-sim-muted hover:text-white"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {/* File tree */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-1">
        {isLoading ? (
          <div className="text-center text-sim-muted py-4">Loading...</div>
        ) : files.length === 0 ? (
          <div className="text-center text-sim-muted py-4 italic">Empty project</div>
        ) : (
          files.map(node => renderTreeNode(node))
        )}
      </div>
      
      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-sim-surface border border-sim-border shadow-xl rounded-md py-1 w-32"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleDelete(contextMenu.path)}
            className="flex items-center gap-2 px-3 py-2 w-full text-left text-red-400 hover:bg-sim-bg"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
};
