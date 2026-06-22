import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { TopBar, Sidebar, RightSidebar } from './components/Layout';
import { MainContent } from './components/MainContent';
import { ResourcePanel } from './components/Layout/ResourcePanel';
import { ProjectHomescreen } from './components/ProjectHomescreen';
import { useUIStore } from './store/ui.store';
import { useProject } from './context/ProjectContext';
import {
  useNotebookManagement,
  useTabManagement,
  useCellOperations,
  useKernelManagement,
  useFileExplorer,
} from './hooks';

const App: React.FC = () => {
  const defaultFileId = useMemo(() => crypto.randomUUID(), []);
  const { chatOpen, toggleChat, resourcePanelOpen } = useUIStore();
  const { project, isLoading, closeProject } = useProject();

  const [modelsRefreshTrigger, setModelsRefreshTrigger] = useState(0);

  // Resize Logic for RightSidebar
  const [chatWidth, setChatWidth] = useState(380);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      requestAnimationFrame(() => {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth > 280 && newWidth < 800) {
          setChatWidth(newWidth);
        }
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = ''; // Restore selection
    };
  }, [isResizing]);

  const handleStartResizing = useCallback(() => {
    setIsResizing(true);
  }, []);

  const notebook = useNotebookManagement(defaultFileId);
  const tabs = useTabManagement(notebook.files, notebook.activeFileId, notebook.setActiveFileId);
  const cells = useCellOperations(notebook.activeCells, notebook.updateActiveNotebookCells);
  const kernel = useKernelManagement(notebook.activeFileId);
  const fileExplorer = useFileExplorer(
    notebook.files,
    notebook.setFiles,
    tabs.tabs,
    tabs.setTabs,
    notebook.activeFileId,
    tabs.activeTabId,
    notebook.setActiveFileId,
    tabs.setActiveTabId,
    notebook.activeFileIdRef
  );

  // ── Reset files/tabs when the project changes ──────────────────────────────
  // When the user switches to a different project, clear all open notebook tabs
  // and in-memory files so stale content from the previous project doesn't show.
  const prevProjectPath = useRef<string | null>(null);
  useEffect(() => {
    if (!project?.path) return;
    if (prevProjectPath.current !== null && prevProjectPath.current !== project.path) {
      // Project switched — wipe all state
      notebook.setFiles([]);
      notebook.setActiveFileId(null);
      notebook.setCurrentNotebookPath(null);
      tabs.setTabs([]);
      tabs.setActiveTabId(null);
    }
    
    if (prevProjectPath.current !== project.path) {
      prevProjectPath.current = project.path;
      // Auto-start kernel in the background when project opens
      kernel.handleConnectKernel('cpu');
    }
  }, [project?.path]); // intentionally not including notebook/tabs to avoid loops

  // ── Auto-load Default Notebook ───────────────────────────────────────────
  const { manifest } = useProject();
  const defaultNotebookOpened = useRef<string | null>(null);
  
  useEffect(() => {
    if (project?.path && manifest?.defaultNotebook) {
      if (defaultNotebookOpened.current !== project.path) {
        defaultNotebookOpened.current = project.path;
        const name = manifest.defaultNotebook.split('/').pop() || 'getting_started.ipynb';
        notebook.handleOpenNotebook(manifest.defaultNotebook, name);
      }
    }
  }, [project?.path, manifest?.defaultNotebook]);

  // ── Project gate ─────────────────────────────────────────────────────
  // Show homescreen while loading or when no project is open.
  if (isLoading) {
    return (
      <div className="h-screen w-screen bg-sim-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-sim-muted">
          <div className="w-5 h-5 border-2 border-sim-red/30 border-t-sim-red rounded-full animate-spin" />
          <span className="text-sm">Loading OctoML...</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return <ProjectHomescreen />;
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-sim-bg overflow-hidden text-sim-text">
      <TopBar
        onToggleChat={toggleChat}
        isChatOpen={chatOpen}
        notebookName={notebook.activeFile?.name || 'No Notebook Selected'}
        onNewNotebook={notebook.handleNewNotebook}
        onOpenFile={notebook.handleOpenFile}
        onSaveFile={notebook.handleSaveFile}
        onSaveAll={notebook.handleSaveFile}
        onOpenFolder={(_path) => { /* FileExplorer manages project state */ }}
        onRestartKernel={kernel.handleRestartKernel}
        onRunAll={() => kernel.handleRunAll(notebook.activeCells)}
        onOpenMemoryMap={() => {
          const memoryMapTab = tabs.tabs.find(t => t.id === 'memory-map');
          if (!memoryMapTab) {
            tabs.setTabs(prev => [...prev, { id: 'memory-map', title: 'Memory Map', type: 'visualization' as const }]);
          }
          notebook.setActiveFileId(null);
          tabs.setActiveTabId('memory-map');
        }}
      />

      <div className="flex-1 flex overflow-hidden relative p-2 gap-2">
        <Sidebar
          files={notebook.files}
          onImportFiles={fileExplorer.handleImportFiles}
          onClearFiles={() => notebook.setFiles([])}
          activeFileId={notebook.activeFileId}
          onFileSelect={notebook.setActiveFileId}
          onDeleteFile={fileExplorer.handleDeleteFile}
          onRenameFile={fileExplorer.handleRenameFile}
          onCellFocus={(_fileId, cellId) => {
            // setActiveCellId makes the notebook scroll to & highlight the cell
            cells.setActiveCellId(cellId);
          }}
          onOpenNotebook={(virtualPath, name) => {
            // Open a project notebook from the file tree into a new tab
            notebook.handleOpenNotebook(virtualPath, name);
          }}
          onOpenFile={(virtualPath, name) => {
            const existingTab = tabs.tabs.find(t => t.path === virtualPath);
            if (existingTab) {
              tabs.handleActivateTab(existingTab.id);
            } else {
              const ext = name.split('.').pop()?.toLowerCase() || '';
              let type: 'image' | 'data' | 'other' = 'other';
              if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) type = 'image';
              else if (['csv', 'tsv', 'json', 'yaml', 'yml'].includes(ext)) type = 'data';
              
              const newTabId = crypto.randomUUID();
              tabs.setTabs(prev => [...prev, {
                id: newTabId,
                title: name,
                type,
                path: virtualPath
              }]);
              notebook.setActiveFileId(null);
              tabs.setActiveTabId(newTabId);
            }
          }}
          onConnectKernel={kernel.handleConnectKernel}
          onOpenSettings={() => {
            window.octoml?.openSettingsWindow();
          }}
        />


        <MainContent
          files={notebook.files}
          tabs={tabs.tabs}
          activeTab={tabs.activeTab}
          activeFile={notebook.activeFile}
          activeCells={notebook.activeCells}
          activeCellId={cells.activeCellId}
          activeTabId={tabs.activeTabId}
          handleActivateTab={tabs.handleActivateTab}
          handleCloseTab={tabs.handleCloseTab}
          updateCells={notebook.updateActiveNotebookCells}
          setActiveCellId={cells.setActiveCellId}
          onCreateNotebook={notebook.handleNewNotebook}
          updateNotebookCellsById={notebook.updateNotebookCellsById}
          onModelsChanged={() => setModelsRefreshTrigger(prev => prev + 1)}
        />

        {/* ── Right panel area: ResourcePanel XOR RightSidebar ── */}

        {/* Resizer handle — only visible when a right panel is open */}
        {(chatOpen || resourcePanelOpen) && (
          <div
            onMouseDown={handleStartResizing}
            className="group relative w-1 h-full cursor-col-resize z-50 flex-shrink-0"
          >
            <div className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] transition-colors
              ${isResizing ? 'bg-sim-red' : 'bg-white/5 group-hover:bg-sim-red/50'}
            `} />
          </div>
        )}

        <ResourcePanel width={chatWidth} isResizing={isResizing} />

        <RightSidebar
          isOpen={chatOpen}
          onClose={toggleChat}
          onAddCell={cells.handleAddCellFromAI}
          onDeleteCell={cells.handleDeleteCellFromAI}
          onMoveCell={cells.handleMoveCellFromAI}
          onEditCell={cells.handleEditCellFromAI}
          onAddPackages={() => { }}
          onCreateNotebook={notebook.handleNewNotebook}
          onNotebookCreatedByAgent={(path) => {
            const name = path.split('/').pop() || path;
            notebook.handleOpenNotebook(path, name);
          }}
          onDeleteNotebook={() => { }}
          notebookCells={notebook.activeCells}
          notebookName={notebook.activeFile?.name || 'Untitled'}
          projectFiles={notebook.files}
          activeCellId={cells.activeCellId}
          updateNotebookCellsById={notebook.updateNotebookCellsById}
          onOpenManageModels={() => {
            window.octoml?.openSettingsWindow();
          }}
          onOpenChatHistory={() => {
            const chatHistoryTab = tabs.tabs.find(t => t.id === 'chat-history');
            if (!chatHistoryTab) {
              tabs.setTabs(prev => [...prev, { id: 'chat-history', title: 'Chat History', type: 'settings' as const }]);
            }
            // Clear activeFileId when opening settings tab to prevent useEffect from switching back
            notebook.setActiveFileId(null);
            // Set the active tab ID directly
            tabs.setActiveTabId('chat-history');
          }}
          modelsRefreshTrigger={modelsRefreshTrigger}
          width={chatWidth}
          isResizing={isResizing}
          onStartResizing={handleStartResizing}
        />
      </div>
    </div>
  );
};

export default App;
