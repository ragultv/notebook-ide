import React from 'react';
import { Notebook } from './Notebook/Notebook';
import { FilePreview } from './FilePreview';
import { ManageModelsDialog } from './ManageModelsDialog';
import MemoryMap from './MemoryMap';
import { TabBar } from './TabBar';
import { Tab, ProjectFile, CellData } from '../types';

interface MainContentProps {
  files: ProjectFile[];
  tabs: Tab[];
  activeTabId: string | null;
  activeTab: Tab | undefined;
  activeFile: ProjectFile | undefined;
  activeCells: CellData[];
  activeCellId: string | null;
  handleActivateTab: (id: string) => void;
  handleCloseTab: (id: string) => void;
  updateCells: React.Dispatch<React.SetStateAction<CellData[]>>;
  setActiveCellId: React.Dispatch<React.SetStateAction<string | null>>;
}

export const MainContent: React.FC<MainContentProps> = ({
  files,
  tabs,
  activeTabId,
  activeTab,
  activeFile,
  activeCells,
  activeCellId,
  handleActivateTab,
  handleCloseTab,
  updateCells,
  setActiveCellId,
}) => {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-sim-bg">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivateTab={handleActivateTab}
        onCloseTab={handleCloseTab}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {activeTabId === 'memory-map' ? (
          <div className="w-full h-full bg-sim-bg">
            <MemoryMap
              notebooks={files}
              initialNotebookId={activeFile?.id || null}
              onOpenNotebook={(notebookId) => handleActivateTab(notebookId)}
            />
          </div>
        ) : activeTabId === 'manage-models' ? (
          <div className="w-full h-full bg-sim-bg">
            <ManageModelsDialog onModelsChanged={() => {}} />
          </div>
        ) : activeTab?.type === 'image' || activeTab?.type === 'data' || activeTab?.type === 'other' ? (
          <FilePreview
            filePath={activeTab?.path || ''}
            fileName={activeTab?.title || ''}
            isObjectUrl={activeTab?.data?.isObjectUrl}
            onClose={() => activeTabId && handleCloseTab(activeTabId)}
          />
        ) : activeFile?.cells ? (
          <Notebook
            notebookId={activeFile.id}
            notebookName={activeFile.name}
            cells={activeCells}
            setCells={updateCells}
            activeCellId={activeCellId}
            setActiveCellId={setActiveCellId}
            onFixError={() => {}}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-sim-bg text-sim-muted font-mono">
            <span>No notebook selected</span>
          </div>
        )}
      </div>
    </div>
  );
};
