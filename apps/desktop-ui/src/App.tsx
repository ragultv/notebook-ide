import React, { useMemo } from 'react';
import { TopBar, Sidebar, RightSidebar } from './components/Layout';
import { MainContent } from './components/MainContent';
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
  const { chatOpen, toggleChat } = useUIStore();

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
      />

      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar
          files={notebook.files}
          onImportFiles={fileExplorer.handleImportFiles}
          onClearFiles={() => notebook.setFiles([])}
          activeFileId={notebook.activeFileId}
          onFileSelect={notebook.setActiveFileId}
          onDeleteFile={fileExplorer.handleDeleteFile}
          onRenameFile={fileExplorer.handleRenameFile}
        />

        <MainContent
          files={notebook.files}
          tabs={tabs.tabs}
          activeTabId={tabs.activeTabId}
          activeTab={tabs.activeTab}
          activeFile={notebook.activeFile}
          activeCells={notebook.activeCells}
          activeCellId={cells.activeCellId}
          handleActivateTab={tabs.handleActivateTab}
          handleCloseTab={tabs.handleCloseTab}
          updateCells={notebook.updateActiveNotebookCells}
          setActiveCellId={cells.setActiveCellId}
        />

        <RightSidebar
          isOpen={chatOpen}
          onClose={toggleChat}
          onAddCell={cells.handleAddCellFromAI}
          onDeleteCell={cells.handleDeleteCellFromAI}
          onMoveCell={cells.handleMoveCellFromAI}
          onEditCell={cells.handleEditCellFromAI}
          onAddPackages={() => {}}
          onCreateNotebook={notebook.handleNewNotebook}
          onDeleteNotebook={() => {}}
          notebookCells={notebook.activeCells}
          notebookName={notebook.activeFile?.name || 'Untitled'}
          projectFiles={notebook.files}
          activeCellId={cells.activeCellId}
          onOpenManageModels={() => {
            const manageModelsTab = tabs.tabs.find(t => t.id === 'manage-models');
            if (!manageModelsTab) {
              tabs.setTabs(prev => [...prev, { id: 'manage-models', title: 'Language Models', type: 'settings' as const }]);
            }
            // Clear activeFileId when opening settings tab to prevent useEffect from switching back
            notebook.setActiveFileId(null);
            // Set the active tab ID directly
            tabs.setActiveTabId('manage-models');
          }}
        />
      </div>
    </div>
  );
};

export default App;
