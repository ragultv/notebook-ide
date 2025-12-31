import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, File, ChevronRight, ChevronDown, Plus, Upload, 
  FolderOpen, RefreshCw, Trash2, Edit2, FileJson, FileText,
  Database, Image, FileCode, MoreVertical, FolderPlus
} from 'lucide-react';
import { controllerClient, FileItem, ProjectInfo } from '../../services/controller.client';

interface FileExplorerProps {
  onFileSelect: (path: string, type: 'notebook' | 'data' | 'other') => void;
  onProjectChange?: (project: ProjectInfo | null) => void;
}

interface TreeNode extends FileItem {
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

const FILE_ICONS: Record<string, React.ComponentType<any>> = {
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

export const FileExplorer: React.FC<FileExplorerProps> = ({ onFileSelect, onProjectChange }) => {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; type: string } | null>(null);
  const [recentProjects, setRecentProjects] = useState<Array<{ path: string; name: string; opened: string }>>([]);
  const [showRecent, setShowRecent] = useState(true);

  // Load recent projects on mount
  useEffect(() => {
    loadRecentProjects();
  }, []);

  const loadRecentProjects = async () => {
    try {
      const result = await controllerClient.getRecentProjects();
      setRecentProjects(result.recent);
    } catch (e) {
      console.error('Failed to load recent projects:', e);
    }
  };

  const loadProjectFiles = useCallback(async (projectPath: string) => {
    setIsLoading(true);
    try {
      const result = await controllerClient.listFiles(projectPath);
      setFiles(result.items.map(item => ({ ...item, children: item.type === 'directory' ? [] : undefined })));
      setExpandedPaths(new Set());
    } catch (e) {
      console.error('Failed to load files:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadFolder = async (path: string): Promise<TreeNode[]> => {
    try {
      const result = await controllerClient.listFiles(path);
      return result.items.map(item => ({ 
        ...item, 
        children: item.type === 'directory' ? [] : undefined 
      }));
    } catch (e) {
      console.error('Failed to load folder:', e);
      return [];
    }
  };

  const toggleFolder = async (node: TreeNode) => {
    const newExpanded = new Set(expandedPaths);
    
    if (expandedPaths.has(node.path)) {
      newExpanded.delete(node.path);
    } else {
      newExpanded.add(node.path);
      // Load children if not loaded
      if (node.type === 'directory' && (!node.children || node.children.length === 0)) {
        const children = await loadFolder(node.path);
        updateNodeChildren(node.path, children);
      }
    }
    
    setExpandedPaths(newExpanded);
  };

  const updateNodeChildren = (path: string, children: TreeNode[]) => {
    setFiles(prev => updateChildrenRecursive(prev, path, children));
  };

  const updateChildrenRecursive = (nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return { ...node, children };
      }
      if (node.children) {
        return { ...node, children: updateChildrenRecursive(node.children, targetPath, children) };
      }
      return node;
    });
  };

  const handleOpenProject = async () => {
    // In a real app, this would open a native folder picker
    // For now, prompt for path
    const path = window.prompt('Enter project folder path:');
    if (!path) return;

    try {
      const result = await controllerClient.openProject(path, path.split(/[/\\]/).pop() || 'Project');
      setProject(result.project);
      onProjectChange?.(result.project);
      await loadProjectFiles(result.project.path);
      await controllerClient.addRecentProject(result.project.path, result.project.name);
      loadRecentProjects();
      setShowRecent(false);
    } catch (e: any) {
      alert(`Failed to open project: ${e.message}`);
    }
  };

  const handleCreateProject = async () => {
    const path = window.prompt('Enter new project folder path:');
    if (!path) return;

    const name = path.split(/[/\\]/).pop() || 'New Project';

    try {
      const result = await controllerClient.createProject(path, name);
      setProject(result.project);
      onProjectChange?.(result.project);
      await loadProjectFiles(result.project.path);
      await controllerClient.addRecentProject(result.project.path, result.project.name);
      loadRecentProjects();
      setShowRecent(false);
    } catch (e: any) {
      alert(`Failed to create project: ${e.message}`);
    }
  };

  const handleOpenRecentProject = async (recentProject: { path: string; name: string }) => {
    try {
      const result = await controllerClient.openProject(recentProject.path, recentProject.name);
      setProject(result.project);
      onProjectChange?.(result.project);
      await loadProjectFiles(result.project.path);
      setShowRecent(false);
    } catch (e: any) {
      alert(`Failed to open project: ${e.message}`);
    }
  };

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

  const handleUploadFiles = async () => {
    if (!project) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.json,.xlsx,.xls,.parquet,.pkl,.txt,.png,.jpg,.jpeg';
    
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      
      const destination = `${project.path}/data`;
      
      try {
        await controllerClient.uploadFiles(Array.from(files), destination);
        await loadProjectFiles(project.path);
        alert('Files uploaded successfully!');
      } catch (e: any) {
        alert(`Upload failed: ${e.message}`);
      }
    };
    
    input.click();
  };

  const handleCreateFolder = async (parentPath: string) => {
    const name = window.prompt('Enter folder name:');
    if (!name) return;

    try {
      await controllerClient.createFolder(parentPath, name);
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      alert(`Failed to create folder: ${e.message}`);
    }
  };

  const handleDeleteFile = async (path: string) => {
    if (!window.confirm('Are you sure you want to delete this?')) return;

    try {
      await controllerClient.deleteFile(path);
      if (project) await loadProjectFiles(project.path);
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path: node.path, type: node.type });
  };

  const FileIcon: React.FC<{ extension?: string; isDir: boolean }> = ({ extension, isDir }) => {
    if (isDir) return <Folder className="w-4 h-4 text-yellow-500" />;
    const IconComponent = FILE_ICONS[extension || ''] || File;
    const color = extension === '.ipynb' ? 'text-orange-400' 
      : extension === '.py' ? 'text-blue-400'
      : ['.csv', '.json', '.xlsx', '.parquet'].includes(extension || '') ? 'text-green-400'
      : 'text-gray-400';
    return <IconComponent className={`w-4 h-4 ${color}`} />;
  };

  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-sim-border/50 rounded text-sm
            ${isSelected ? 'bg-sim-red/20 text-white' : 'text-gray-300'}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => handleFileClick(node)}
          onContextMenu={(e) => handleContextMenu(e, node)}
        >
          {node.type === 'directory' && (
            <span className="w-4 h-4 flex items-center justify-center">
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
          {node.type !== 'directory' && <span className="w-4" />}
          <FileIcon extension={node.extension} isDir={node.type === 'directory'} />
          <span className="truncate flex-1">{node.name}</span>
          {node.size && <span className="text-xs text-gray-500">{formatSize(node.size)}</span>}
        </div>
        
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="h-full flex flex-col bg-sim-bg text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-sim-border">
        <span className="text-xs font-semibold uppercase text-gray-400">Explorer</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenProject}
            className="p-1 hover:bg-sim-border rounded"
            title="Open Project"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={handleCreateProject}
            className="p-1 hover:bg-sim-border rounded"
            title="New Project"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          {project && (
            <>
              <button
                onClick={handleUploadFiles}
                className="p-1 hover:bg-sim-border rounded"
                title="Upload Data Files"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                onClick={() => loadProjectFiles(project.path)}
                className="p-1 hover:bg-sim-border rounded"
                title="Refresh"
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!project && showRecent ? (
          <div className="p-3">
            <div className="text-sm text-gray-400 mb-3">Recent Projects</div>
            {recentProjects.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-4">
                No recent projects
              </div>
            ) : (
              <div className="space-y-1">
                {recentProjects.map((rp, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleOpenRecentProject(rp)}
                    className="w-full text-left px-2 py-2 rounded hover:bg-sim-border/50 group"
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm truncate">{rp.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 truncate pl-6">{rp.path}</div>
                  </button>
                ))}
              </div>
            )}
            
            <div className="mt-4 space-y-2">
              <button
                onClick={handleOpenProject}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-sim-red/20 hover:bg-sim-red/30 text-sim-red border border-sim-red/50 rounded text-sm"
              >
                <FolderOpen className="w-4 h-4" />
                Open Project
              </button>
              <button
                onClick={handleCreateProject}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-sim-border hover:bg-sim-muted text-white border border-sim-border rounded text-sm"
              >
                <FolderPlus className="w-4 h-4" />
                Create New Project
              </button>
            </div>
          </div>
        ) : project ? (
          <div>
            {/* Project Name */}
            <div className="px-3 py-2 bg-sim-surface/50 border-b border-sim-border flex items-center gap-2">
              <Folder className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-medium truncate">{project.name}</span>
            </div>
            
            {/* File Tree */}
            <div className="py-1">
              {files.map(node => renderTreeNode(node))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No project open
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-sim-surface border border-sim-border rounded shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'directory' && (
            <button
              onClick={() => { handleCreateFolder(contextMenu.path); setContextMenu(null); }}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-sim-border flex items-center gap-2"
            >
              <FolderPlus className="w-4 h-4" />
              New Folder
            </button>
          )}
          <button
            onClick={() => { handleDeleteFile(contextMenu.path); setContextMenu(null); }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-sim-border flex items-center gap-2 text-red-400"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default FileExplorer;
