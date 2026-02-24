import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { TopBar, Sidebar, RightSidebar } from './components/Layout';
import { MainContent } from './components/MainContent';
import { ResourcePanel } from './components/Layout/ResourcePanel';
import { useUIStore } from './store/ui.store';
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
        onConnectKernel={kernel.handleConnectKernel}
        onRestartKernel={kernel.handleRestartKernel}
        onRunAll={() => kernel.handleRunAll(notebook.activeCells, notebook.updateActiveNotebookCells)}
        onOpenMemoryMap={() => {
          const memoryMapTab = tabs.tabs.find(t => t.id === 'memory-map');
          if (!memoryMapTab) {
            tabs.setTabs(prev => [...prev, { id: 'memory-map', title: 'Memory Map', type: 'visualization' as const }]);
          }
          notebook.setActiveFileId(null);
          tabs.setActiveTabId('memory-map');
        }}
        tabs={tabs.tabs}
        activeTabId={tabs.activeTabId}
        onActivateTab={tabs.handleActivateTab}
        onCloseTab={tabs.handleCloseTab}
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
        />

        <MainContent
          files={notebook.files}
          activeTab={tabs.activeTab}
          activeFile={notebook.activeFile}
          activeCells={notebook.activeCells}
          activeCellId={cells.activeCellId}
          activeTabId={tabs.activeTabId}
          handleActivateTab={tabs.handleActivateTab}
          handleCloseTab={tabs.handleCloseTab}
          updateCells={notebook.updateActiveNotebookCells}
          setActiveCellId={cells.setActiveCellId}
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
          onDeleteNotebook={() => { }}
          notebookCells={notebook.activeCells}
          notebookName={notebook.activeFile?.name || 'Untitled'}
          projectFiles={notebook.files}
          activeCellId={cells.activeCellId}
          onOpenManageModels={() => {
            const manageModelsTab = tabs.tabs.find(t => t.id === 'manage-models');
            if (!manageModelsTab) {
              tabs.setTabs(prev => [...prev, { id: 'manage-models', title: 'Language Models', type: 'settings' as const }]);
            }
            notebook.setActiveFileId(null);
            tabs.setActiveTabId('manage-models');
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
