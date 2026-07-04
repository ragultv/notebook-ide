import React from 'react';
import { Notebook } from './Notebook/Notebook';
import { FilePreview } from './FilePreview';
import { SettingsPage } from './Settings/SettingsPage';
import { ChatHistory } from './ChatHistory';
import { TabBar } from './TabBar';
import { Tab, ProjectFile, CellData } from '../types';

interface MainContentProps {
  files: ProjectFile[];
  tabs: Tab[];
  activeTab: Tab | undefined;
  activeFile: ProjectFile | undefined;
  activeCells: CellData[];
  activeCellId: string | null;
  activeTabId: string | null;
  handleActivateTab: (id: string) => void;
  handleCloseTab: (id: string) => void;
  updateCells: React.Dispatch<React.SetStateAction<CellData[]>>;
  setActiveCellId: React.Dispatch<React.SetStateAction<string | null>>;
  onCreateNotebook?: (nameOrCells?: string | CellData[], initialCells?: CellData[], path?: string) => string | null;
  updateNotebookCellsById?: (notebookId: string, cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  onModelsChanged?: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({
  files,
  tabs,
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
  const openNotebookTabs = tabs.filter(t => t.type === 'notebook');
  const notebookFiles = openNotebookTabs.map(tab => files.find(f => f.id === tab.id)).filter((f): f is ProjectFile => !!f);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-sim-bg rounded-2xl border border-sim-border shadow-lg">
      {tabs.length > 0 && (
        <div className="flex-shrink-0 h-9 bg-sim-surface border-b border-sim-border overflow-hidden px-1 hidden md:flex items-center">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
          />
        </div>
      )}
      <div className="flex-1 flex overflow-hidden relative">
        {activeTabId === 'chat-history' ? (
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
        ) : openNotebookTabs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center bg-sim-bg text-sim-muted font-mono">
            <span>No notebook selected</span>
          </div>
        ) : null}

        {notebookFiles.map(file => {
          const isCurrentActive = activeTab?.type === 'notebook' && activeFile?.id === file.id;
          return (
            <div
              key={file.id}
              className={`w-full h-full ${isCurrentActive ? 'flex flex-col' : 'hidden'}`}
            >
              <Notebook
                notebookId={file.id}
                notebookName={file.name}
                cells={file.cells || []}
                setCells={(newCellsOrUpdater) => {
                  if (updateNotebookCellsById) {
                    updateNotebookCellsById(file.id, newCellsOrUpdater);
                  } else {
                    updateCells(newCellsOrUpdater);
                  }
                }}
                activeCellId={isCurrentActive ? activeCellId : null}
                setActiveCellId={setActiveCellId}
                onFixError={() => { }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
