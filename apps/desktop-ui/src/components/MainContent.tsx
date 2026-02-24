import React from 'react';
import { Notebook } from './Notebook/Notebook';
import { FilePreview } from './FilePreview';
import { ManageModelsDialog } from './ManageModelsDialog';
import { ChatHistory } from './ChatHistory';
import MemoryMap from './MemoryMap';
import { TabBar } from './TabBar';
import { Tab, ProjectFile, CellData } from '../types';

interface MainContentProps {
  files: ProjectFile[];
  activeTab: Tab | undefined;
  activeFile: ProjectFile | undefined;
  activeCells: CellData[];
  activeCellId: string | null;
  activeTabId: string | null;
  handleActivateTab: (id: string) => void;
  handleCloseTab: (id: string) => void;
  updateCells: React.Dispatch<React.SetStateAction<CellData[]>>;
  setActiveCellId: React.Dispatch<React.SetStateAction<string | null>>;
  onCreateNotebook?: () => string | null;
  updateNotebookCellsById?: (notebookId: string, cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  onModelsChanged?: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({
  files,
  activeTab,
  activeFile,
  activeCells,
  activeCellId,
  activeTabId,
  handleActivateTab,
  handleCloseTab,
  updateCells,
  setActiveCellId,
  onCreateNotebook,
  updateNotebookCellsById,
  onModelsChanged,
}) => {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-sim-bg rounded-2xl border border-sim-border shadow-lg">
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
            <ManageModelsDialog onModelsChanged={onModelsChanged} />
          </div>
        ) : activeTabId === 'chat-history' ? (
          <div className="w-full h-full bg-sim-bg">
            <ChatHistory
              onCreateNotebook={onCreateNotebook}
              onSwitchToNotebook={(notebookId) => {
                handleActivateTab(notebookId);
              }}
              getNotebookId={() => activeFile?.id || null}
              files={files}
              getNotebookCells={(notebookId) => {
                return files.find(f => f.id === notebookId)?.cells;
              }}
              updateNotebookCells={(notebookId, cells) => {
                if (updateNotebookCellsById) {
                  updateNotebookCellsById(notebookId, cells);
                } else {
                  console.error('[MainContent] updateNotebookCellsById not provided');
                }
              }}
            />
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
            onFixError={() => { }}
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
