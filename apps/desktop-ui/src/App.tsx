import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { TopBar } from './components/Layout/TopBar';
import { Sidebar } from './components/Layout/Sidebar';
import { RightSidebar } from './components/Layout/RightSidebar';
import { Notebook } from './components/Notebook/Notebook';
import { FilePreview } from './components/FilePreview';
import { ManageModelsDialog } from './components/ManageModelsDialog';
import { CellData, ProjectFile } from './types';
import { useUIStore } from './state/ui.store';
import { controllerClient, ProjectInfo } from './services/controller.client';
import { filesystemClient } from './services/filesystem.client';
import { notebookAgent } from './services/agent.service';

// Local storage keys for persistence
const STORAGE_KEY_PROJECT = 'notebook-ide-project';
const STORAGE_KEY_NOTEBOOK = 'notebook-ide-current-notebook';
const AUTO_SAVE_INTERVAL = 30000; // Auto-save every 30 seconds

const App: React.FC = () => {
  const { chatOpen, toggleChat, setKernelStatus, setKernelId } = useUIStore();

  // Project state
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null);
  const [currentNotebookPath, setCurrentNotebookPath] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // File preview state
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string; isObjectUrl?: boolean } | null>(null);

  // Manage Models dialog state
  const [showManageModels, setShowManageModels] = useState(false);

  // Toast notification state for Run All completion
  const [runAllToast, setRunAllToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Initialize with a default untitled notebook
  const defaultFileId = useMemo(() => uuidv4(), []);
  const [files, setFiles] = useState<ProjectFile[]>([
    {
      id: defaultFileId,
      name: 'Untitled.ipynb',
      type: 'application/x-ipynb+json',
      cells: [{
        id: uuidv4(),
        type: 'code',
        content: '',
        status: 'idle',
      }]
    }
  ]);

  // Track which file is currently active in the editor
  const [activeFileId, setActiveFileId] = useState<string | null>(defaultFileId);

  // Ref to track activeFileId synchronously for multiple updates in same event loop
  const activeFileIdRef = useRef<string | null>(activeFileId);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  const [activeCellId, setActiveCellId] = useState<string | null>(null);

  // Derived state: Get the active file object
  const activeFile = useMemo(() => files.find(f => f.id === activeFileId), [files, activeFileId]);

  // Derived state: Get the cells of the active file, or empty if no valid notebook selected
  const activeCells = useMemo(() => {
    return activeFile?.cells || [];
  }, [activeFile]);

  // Load saved state on mount
  useEffect(() => {
    const savedProject = localStorage.getItem(STORAGE_KEY_PROJECT);
    const savedNotebook = localStorage.getItem(STORAGE_KEY_NOTEBOOK);

    if (savedProject) {
      try {
        const project = JSON.parse(savedProject);
        setCurrentProject(project);

        // Try to reload the project
        controllerClient.openProject(project.path, project.name)
          .then(() => console.log('Project restored:', project.name))
          .catch(() => {
            // Project no longer exists, clear it
            localStorage.removeItem(STORAGE_KEY_PROJECT);
            setCurrentProject(null);
          });
      } catch (e) {
        console.error('Failed to restore project:', e);
      }
    }

    if (savedNotebook) {
      try {
        const notebook = JSON.parse(savedNotebook);
        if (notebook.path) {
          // Load notebook from disk
          controllerClient.openNotebook(notebook.path)
            .then((result) => {
              const loadedFile: ProjectFile = {
                id: uuidv4(),
                name: result.name,
                type: 'application/x-ipynb+json',
                cells: result.content.cells.map((c: any) => ({
                  id: c.id || uuidv4(),
                  type: c.type === 'markdown' ? 'markdown' : 'code',
                  content: c.content || '',
                  status: 'idle' as const,
                })),
              };
              setFiles([loadedFile]);
              setActiveFileId(loadedFile.id);
              activeFileIdRef.current = loadedFile.id;
              setCurrentNotebookPath(notebook.path);
            })
            .catch((e) => {
              console.error('Failed to load notebook:', e);
              localStorage.removeItem(STORAGE_KEY_NOTEBOOK);
            });
        }
      } catch (e) {
        console.error('Failed to restore notebook:', e);
      }
    }
  }, []);

  // When switching files, reset active cell selection or set to first cell
  useEffect(() => {
    if (activeCells.length > 0) {
      setActiveCellId(activeCells[0].id);
    } else {
      setActiveCellId(null);
    }
  }, [activeFileId]);

  // Mark changes as unsaved when cells change
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [activeCells]);

  // Auto-save periodically
  useEffect(() => {
    if (!currentNotebookPath || !hasUnsavedChanges || !activeFile) return;

    const timer = setTimeout(async () => {
      try {
        await controllerClient.saveNotebook(currentNotebookPath, {
          cells: activeFile.cells?.map(c => ({
            id: c.id,
            type: c.type,
            content: c.content,
          })) || [],
          metadata: {
            name: activeFile.name,
          }
        });
        setHasUnsavedChanges(false);
        console.log('Auto-saved notebook');
      } catch (e) {
        console.error('Auto-save failed:', e);
      }
    }, AUTO_SAVE_INTERVAL);

    return () => clearTimeout(timer);
  }, [activeCells, currentNotebookPath, hasUnsavedChanges, activeFile]);

  // Save to localStorage for crash recovery
  useEffect(() => {
    if (activeFile) {
      localStorage.setItem(STORAGE_KEY_NOTEBOOK, JSON.stringify({
        path: currentNotebookPath,
        name: activeFile.name,
      }));
    }
  }, [activeFile, currentNotebookPath]);

  // Save project to localStorage
  useEffect(() => {
    if (currentProject) {
      localStorage.setItem(STORAGE_KEY_PROJECT, JSON.stringify(currentProject));
    }
  }, [currentProject]);

  // --- Kernel Connection ---
  const handleConnectKernel = useCallback(async () => {
    setKernelStatus('connecting');
    try {
      const info = await controllerClient.startKernel();
      setKernelId(info.id);
      setKernelStatus('idle');
    } catch (e) {
      console.error('Failed to connect kernel:', e);
      setKernelStatus('error');
    }
  }, [setKernelStatus, setKernelId]);

  const handleRestartKernel = useCallback(async () => {
    setKernelStatus('connecting');
    try {
      const info = await controllerClient.restartKernel();
      setKernelId(info.id);
      setKernelStatus('idle');
    } catch (e) {
      console.error('Failed to restart kernel:', e);
      setKernelStatus('error');
    }
  }, [setKernelStatus, setKernelId]);

  // --- Run All Cells ---
  const handleRunAll = useCallback(async () => {
    if (!activeFile?.cells || activeFile.cells.length === 0) return;

    const codeCells = activeFile.cells.filter(c => c.type === 'code' && c.content.trim());
    if (codeCells.length === 0) return;

    setKernelStatus('busy');
    setRunAllToast(null); // Clear any previous toast

    const startTime = performance.now();
    let successCount = 0;
    let hasError = false;

    for (const cell of codeCells) {
      // Update cell status to running
      updateActiveNotebookCells(prev =>
        prev.map(c => c.id === cell.id ? { ...c, status: 'running' as const } : c)
      );

      try {
        const result = await controllerClient.runCell({
          cellId: cell.id,
          code: cell.content,
          notebookId: activeFile?.id || 'default',
        });

        // Update cell with result
        updateActiveNotebookCells(prev =>
          prev.map(c => c.id === cell.id ? {
            ...c,
            status: result.success ? 'success' as const : 'error' as const,
            output: result.output || result.error,
            executionCount: result.executionCount,
          } : c)
        );

        // Stop on error
        if (!result.success) {
          hasError = true;
          break;
        }

        successCount++;

      } catch (e) {
        console.error('Execution error:', e);
        updateActiveNotebookCells(prev =>
          prev.map(c => c.id === cell.id ? {
            ...c,
            status: 'error' as const,
            output: e instanceof Error ? e.message : 'Execution failed',
          } : c)
        );
        hasError = true;
        break;
      }
    }

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Show toast with result
    if (hasError) {
      setRunAllToast({
        message: `Run All stopped after ${successCount}/${codeCells.length} cells (${duration}s)`,
        type: 'error'
      });
    } else {
      setRunAllToast({
        message: `Run All completed: ${successCount} cells in ${duration}s`,
        type: 'success'
      });
    }

    // Auto-hide toast after 5 seconds
    setTimeout(() => setRunAllToast(null), 5000);

    setKernelStatus('idle');
  }, [activeFile, setKernelStatus]);

  // --- File Operations ---
  const handleOpenFile = useCallback(async () => {
    if (!filesystemClient.isSupported()) {
      alert('File System API not supported in this browser');
      return;
    }

    try {
      const notebook = await filesystemClient.openNotebook();
      if (notebook) {
        const newFile: ProjectFile = {
          id: notebook.id,
          name: notebook.name,
          type: 'application/x-ipynb+json',
          cells: notebook.cells.map(c => ({
            id: c.id,
            type: c.type,
            content: c.content,
            output: c.output,
            status: 'idle' as const,
            executionCount: c.executionCount,
          })),
        };
        setFiles(prev => [...prev, newFile]);
        setActiveFileId(newFile.id);
        activeFileIdRef.current = newFile.id;
      }
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  }, []);

  // Open notebook from file path (from file explorer)
  const handleOpenNotebookFromPath = useCallback(async (path: string) => {
    try {
      const result = await controllerClient.openNotebook(path);
      const loadedFile: ProjectFile = {
        id: uuidv4(),
        name: result.name,
        type: 'application/x-ipynb+json',
        cells: result.content.cells.map((c: any) => ({
          id: c.id || uuidv4(),
          type: c.type === 'markdown' ? 'markdown' : 'code',
          content: c.content || '',
          status: 'idle' as const,
        })),
      };

      // Check if already open
      const existing = files.find(f => f.name === result.name);
      if (existing) {
        setActiveFileId(existing.id);
        activeFileIdRef.current = existing.id;
      } else {
        setFiles(prev => [...prev, loadedFile]);
        setActiveFileId(loadedFile.id);
        activeFileIdRef.current = loadedFile.id;
      }

      setCurrentNotebookPath(path);
      setHasUnsavedChanges(false);
    } catch (e: any) {
      alert(`Failed to open notebook: ${e.message}`);
    }
  }, [files]);

  // Handle file selection from file explorer
  const handleFileExplorerSelect = useCallback((path: string, type: 'notebook' | 'data' | 'other') => {
    if (type === 'notebook') {
      handleOpenNotebookFromPath(path);
    } else if (type === 'data' || type === 'other') {
      // Open file preview for data files and other files
      const fileName = path.split(/[/\\]/).pop() || path;
      setPreviewFile({ path, name: fileName });
    }
  }, [handleOpenNotebookFromPath]);

  // Handle project change
  const handleProjectChange = useCallback((project: ProjectInfo | null) => {
    setCurrentProject(project);
    if (project) {
      controllerClient.addRecentProject(project.path, project.name);
    }
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!activeFile) return;

    // If we have a path, save to backend
    if (currentNotebookPath) {
      try {
        await controllerClient.saveNotebook(currentNotebookPath, {
          cells: activeFile.cells?.map(c => ({
            id: c.id,
            type: c.type,
            content: c.content,
          })) || [],
          metadata: {
            name: activeFile.name,
          }
        });
        setHasUnsavedChanges(false);
        console.log('Notebook saved');
      } catch (e: any) {
        alert(`Failed to save: ${e.message}`);
      }
    } else if (currentProject) {
      // Save to project folder
      const savePath = `${currentProject.path}/notebooks/${activeFile.name}`;
      try {
        await controllerClient.saveNotebook(savePath, {
          cells: activeFile.cells?.map(c => ({
            id: c.id,
            type: c.type,
            content: c.content,
          })) || [],
          metadata: {
            name: activeFile.name,
          }
        });
        setCurrentNotebookPath(savePath);
        setHasUnsavedChanges(false);
        console.log('Notebook saved to:', savePath);
      } catch (e: any) {
        alert(`Failed to save: ${e.message}`);
      }
    } else if (filesystemClient.isSupported()) {
      // Fallback to File System Access API
      try {
        await filesystemClient.saveNotebook({
          id: activeFile.id,
          name: activeFile.name,
          cells: activeFile.cells?.map(c => ({
            id: c.id,
            type: c.type,
            content: c.content,
            output: c.output,
            executionCount: c.executionCount,
          })) || [],
        });
        setHasUnsavedChanges(false);
      } catch (e) {
        console.error('Failed to save file:', e);
      }
    } else {
      alert('Please open a project first to save notebooks');
    }
  }, [activeFile, currentNotebookPath, currentProject]);

  const handleNewNotebook = () => {
    const newId = uuidv4();
    const newName = `Notebook_${Math.floor(Math.random() * 1000)}.ipynb`;
    const newFile: ProjectFile = {
      id: newId,
      name: newName,
      type: 'application/x-ipynb+json',
      cells: [{
        id: uuidv4(),
        type: 'code',
        content: '',
        status: 'idle'
      }]
    };

    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newId);
    activeFileIdRef.current = newId;
  };

  const updateActiveNotebookCells = (newCellsOrUpdater: CellData[] | ((prev: CellData[]) => CellData[])) => {
    const targetId = activeFileIdRef.current;
    if (!targetId) return;

    setFiles(prevFiles => prevFiles.map(f => {
      if (f.id === targetId) {
        const updatedCells = typeof newCellsOrUpdater === 'function'
          ? newCellsOrUpdater(f.cells || [])
          : newCellsOrUpdater;

        return { ...f, cells: updatedCells };
      }
      return f;
    }));
  };

  // --- AI Agent Operations ---
  const handleAddCellFromAI = (content: string, type: 'code' | 'markdown') => {
    if (!activeFileIdRef.current) return;

    const newCell: CellData = {
      id: uuidv4(),
      type,
      content,
      status: 'idle',
    };

    updateActiveNotebookCells(prev => [...prev, newCell]);
    setActiveCellId(newCell.id);
  };

  const handleDeleteCellFromAI = (index: number) => {
    if (!activeFileIdRef.current) return;
    updateActiveNotebookCells(prev => {
      const arrayIndex = index - 1;
      if (arrayIndex >= 0 && arrayIndex < prev.length && prev.length > 1) {
        return prev.filter((_, i) => i !== arrayIndex);
      }
      return prev;
    });
  };

  const handleMoveCellFromAI = (fromIndex: number, toIndex: number) => {
    if (!activeFileIdRef.current) return;
    updateActiveNotebookCells(prev => {
      const from = fromIndex - 1;
      const to = toIndex - 1;
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;

      const cells = [...prev];
      const [moved] = cells.splice(from, 1);
      cells.splice(to, 0, moved);
      return cells;
    });
  };

  // Edit existing cell (for error fixing)
  const handleEditCellFromAI = (index: number, content: string, type?: 'code' | 'markdown') => {
    if (!activeFileIdRef.current) return;
    updateActiveNotebookCells(prev => {
      const arrayIndex = index - 1;
      if (arrayIndex >= 0 && arrayIndex < prev.length) {
        return prev.map((c, i) => {
          if (i === arrayIndex) {
            return {
              ...c,
              content,
              type: type || c.type,
              status: 'idle' as const,
              output: undefined, // Clear previous output
            };
          }
          return c;
        });
      }
      return prev;
    });
  };

  // Add packages to Cell 1 (accumulative)
  const handleAddPackagesFromAI = (packages: string[]) => {
    if (!activeFileIdRef.current || packages.length === 0) return;

    updateActiveNotebookCells(prev => {
      if (prev.length === 0) return prev;

      const cell1 = prev[0];
      const existingContent = cell1.content.trim();

      // Build pip install commands
      const newInstalls = packages.map(pkg => `!pip install ${pkg} -q`).join('\n');

      // Check what's already installed
      const existingInstalls = existingContent.split('\n')
        .filter(line => line.trim().startsWith('!pip install'))
        .map(line => {
          const match = line.match(/!pip install\s+(\S+)/);
          return match ? match[1] : '';
        })
        .filter(Boolean);

      // Filter out already installed packages
      const newPackages = packages.filter(pkg =>
        !existingInstalls.some(existing => existing.toLowerCase() === pkg.toLowerCase())
      );

      if (newPackages.length === 0) return prev; // Nothing new to add

      const newInstallLines = newPackages.map(pkg => `!pip install ${pkg} -q`).join('\n');

      // Append to cell 1
      const updatedContent = existingContent
        ? `${existingContent}\n${newInstallLines}`
        : newInstallLines;

      return prev.map((c, i) => i === 0 ? { ...c, content: updatedContent, status: 'idle' as const } : c);
    });
  };

  const handleCreateNotebookFromAI = (name: string) => {
    const newId = uuidv4();
    const newFile: ProjectFile = {
      id: newId,
      name: name.endsWith('.ipynb') ? name : `${name}.ipynb`,
      type: 'application/x-ipynb+json',
      cells: [{
        id: uuidv4(),
        type: 'code',
        content: '',
        status: 'idle'
      }]
    };
    setFiles(prev => [...prev, newFile]);
    setActiveFileId(newId);
    activeFileIdRef.current = newId;
  };

  const handleDeleteNotebookFromAI = (name?: string) => {
    let fileIdToDelete = activeFileIdRef.current;

    if (name) {
      const file = files.find(f => f.name === name);
      if (file) fileIdToDelete = file.id;
    }

    if (fileIdToDelete) {
      setFiles(prev => prev.filter(f => f.id !== fileIdToDelete));

      if (fileIdToDelete === activeFileIdRef.current) {
        const remaining = files.filter(f => f.id !== fileIdToDelete);
        const nextId = remaining.length > 0 ? remaining[0].id : null;
        setActiveFileId(nextId);
        activeFileIdRef.current = nextId;
      }
    }
  };

  // --- Fix Error Handler ---
  const handleFixError = useCallback(async (cellIndex: number, error: string, cellContent: string, allCells: CellData[]) => {
    console.log('App handleFixError called:', { cellIndex, error, cellContent });
    try {
      console.log('Calling controllerClient.fixError...');
      const response = await controllerClient.fixError({
        cellIndex,
        error,
        cellContent,
        context: {
          notebookName: activeFile?.name || 'Untitled',
          cells: allCells.map(c => ({ type: c.type, content: c.content })),
        },
      });
      console.log('fixError response:', response);

      let fixedCellIndex: number | null = null;

      if (response.operations && response.operations.length > 0) {
        for (const op of response.operations) {
          console.log('Executing operation:', op);
          switch (op.type) {
            case 'edit_cell':
              handleEditCellFromAI(op.params.cellIndex, op.params.content, op.params.type);
              fixedCellIndex = op.params.cellIndex;
              break;
            case 'add_package':
              handleAddPackagesFromAI(op.params.packages || []);
              break;
          }
        }

        // Auto-run the fixed cell after a short delay to allow state to update
        if (fixedCellIndex !== null) {
          setTimeout(async () => {
            const arrayIndex = fixedCellIndex! - 1;
            const currentCells = activeFile?.cells || [];
            if (arrayIndex >= 0 && arrayIndex < currentCells.length) {
              const cellToRun = currentCells[arrayIndex];
              console.log('Auto-running fixed cell:', cellToRun.id);

              try {
                const result = await controllerClient.runCell({
                  cellId: cellToRun.id,
                  code: cellToRun.content,
                  notebookId: activeFile?.id || 'default',
                });

                updateActiveNotebookCells(prev =>
                  prev.map(c => c.id === cellToRun.id ? {
                    ...c,
                    status: result.success ? 'success' as const : 'error' as const,
                    output: result.output || result.error,
                    executionCount: result.executionCount,
                  } : c)
                );
              } catch (e) {
                console.error('Auto-run failed:', e);
              }
            }
          }, 500);
        }
      }
    } catch (e) {
      console.error('Error fixing:', e);
    }
  }, [activeFile, handleEditCellFromAI, handleAddPackagesFromAI, updateActiveNotebookCells]);

  // --- Sidebar Operations ---
  const handleRenameFile = (id: string, newName: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, name: newName } : f));
  };

  const handleDeleteFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    if (activeFileId === id) {
      const remaining = files.filter(f => f.id !== id);
      const nextId = remaining.length > 0 ? remaining[0].id : null;
      setActiveFileId(nextId);
      activeFileIdRef.current = nextId;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-sim-bg overflow-hidden text-sim-text">
      <TopBar
        onToggleChat={toggleChat}
        isChatOpen={chatOpen}
        notebookName={activeFile?.name || 'No Notebook Selected'}
        onNewNotebook={handleNewNotebook}
        onOpenFile={handleOpenFile}
        onSaveFile={handleSaveFile}
        onConnectKernel={handleConnectKernel}
        onRestartKernel={handleRestartKernel}
        onRunAll={handleRunAll}
      />
      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar
          files={files}
          setFiles={setFiles}
          activeFileId={activeFileId}
          onFileSelect={(id) => {
            const file = files.find(f => f.id === id);
            if (file) {
              // Check if it's a notebook or data/image file
              const ext = file.name.split('.').pop()?.toLowerCase() || '';
              const isNotebook = ext === 'ipynb';
              const isData = ['csv', 'xlsx', 'xls', 'json', 'parquet', 'pkl'].includes(ext);
              const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);

              if (isNotebook) {
                setActiveFileId(id);
              } else if (isData || isImage || ext === 'txt' || ext === 'py' || ext === 'md') {
                // For uploaded files without backend path, use the file object
                // The path stored is either a backend path (from project explorer) or just the filename (uploaded)
                const hasBackendPath = (file as any).path && (file as any).path.includes('/');
                if (hasBackendPath) {
                  setPreviewFile({ path: (file as any).path, name: file.name });
                } else if (file.file) {
                  // For uploaded files, create object URL
                  setPreviewFile({
                    path: URL.createObjectURL(file.file),
                    name: file.name,
                    isObjectUrl: true
                  } as any);
                } else {
                  setPreviewFile({ path: file.name, name: file.name });
                }
              }
            }
          }}
          onDeleteFile={handleDeleteFile}
          onRenameFile={handleRenameFile}
        />

        {/* Main Content Area - Show Notebook or File Preview */}
        {previewFile ? (
          <FilePreview
            filePath={previewFile.path}
            fileName={previewFile.name}
            isObjectUrl={previewFile.isObjectUrl}
            onClose={() => {
              if (previewFile.isObjectUrl && previewFile.path.startsWith('blob:')) {
                URL.revokeObjectURL(previewFile.path);
              }
              setPreviewFile(null);
            }}
          />
        ) : activeFile && activeFile.cells ? (
          <Notebook
            notebookId={activeFile.id}
            notebookName={activeFile.name}
            cells={activeCells}
            setCells={updateActiveNotebookCells}
            activeCellId={activeCellId}
            setActiveCellId={setActiveCellId}
            onFixError={handleFixError}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-sim-bg text-sim-muted font-mono flex-col gap-4">
            <div className="p-4 rounded-full bg-sim-surface border border-sim-border">
              <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <p>Select a notebook to edit</p>
          </div>
        )}

        <RightSidebar
          isOpen={chatOpen}
          onClose={toggleChat}
          onAddCell={handleAddCellFromAI}
          onDeleteCell={handleDeleteCellFromAI}
          onMoveCell={handleMoveCellFromAI}
          onEditCell={handleEditCellFromAI}
          onAddPackages={handleAddPackagesFromAI}
          onCreateNotebook={handleCreateNotebookFromAI}
          onDeleteNotebook={handleDeleteNotebookFromAI}
          notebookCells={activeCells}
          notebookName={activeFile?.name || 'Untitled'}
          projectFiles={files}
          activeCellId={activeCellId}
          onOpenManageModels={() => setShowManageModels(true)}
        />
      </div>

      {/* Manage Models Dialog */}
      <ManageModelsDialog
        isOpen={showManageModels}
        onClose={() => setShowManageModels(false)}
      />

      {/* Run All Toast Notification */}
      {runAllToast && (
        <div className={`fixed bottom-20 left-1/2 transform -translate-x-1/2 z-[200] px-4 py-2.5 rounded-lg shadow-lg border flex items-center gap-2 text-sm font-medium animate-in fade-in slide-in-from-bottom-4 duration-300 ${runAllToast.type === 'success'
          ? 'bg-green-500/20 border-green-500/50 text-green-400'
          : 'bg-red-500/20 border-red-500/50 text-red-400'
          }`}>
          {runAllToast.type === 'success' ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          )}
          {runAllToast.message}
          <button
            onClick={() => setRunAllToast(null)}
            className="ml-2 opacity-70 hover:opacity-100"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="h-6 bg-[#1e1e1e] border-t border-[#333] flex items-center justify-between px-3 text-[11px] text-gray-500 flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>Python 3.11</span>
          <span>•</span>
          <span>UTF-8</span>
        </div>
        <div className="flex items-center gap-4">
          <span>OPREL Studio v1.0</span>
        </div>
      </div>
    </div>
  );
};

export default App;