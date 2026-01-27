import { useCallback } from 'react';
import { ProjectFile, Tab, FileType } from '../types';

interface UseFileExplorerReturn {
  handleDeleteFile: (id: string) => void;
  handleImportFiles: (newFiles: ProjectFile[]) => void;
  handleRenameFile: (id: string, newName: string) => void;
}

export const useFileExplorer = (
  files: ProjectFile[],
  setFiles: React.Dispatch<React.SetStateAction<ProjectFile[]>>,
  tabs: Tab[],
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  activeFileId: string | null,
  activeTabId: string | null,
  setActiveFileId: (id: string | null) => void,
  setActiveTabId: (id: string | null) => void,
  activeFileIdRef: React.MutableRefObject<string | null>
): UseFileExplorerReturn => {

  const handleDeleteFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    setTabs(prev => prev.filter(t => t.id !== id));
    
    if (activeFileId === id) {
      const remaining = files.filter(f => f.id !== id);
      const nextId = remaining.length > 0 ? remaining[0].id : null;
      setActiveFileId(nextId);
      activeFileIdRef.current = nextId;
      setActiveTabId(nextId);
    } else if (activeTabId === id) {
      const remainingTabs = tabs.filter(t => t.id !== id);
      const nextTabId = remainingTabs.length > 0 ? remainingTabs[0].id : null;
      setActiveTabId(nextTabId);
    }
  }, [files, tabs, activeFileId, activeTabId, setFiles, setTabs, setActiveFileId, setActiveTabId, activeFileIdRef]);

  const handleImportFiles = useCallback((newFiles: ProjectFile[]) => {
    setFiles(prev => [...prev, ...newFiles]);
    
    const newTabs = newFiles.map(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      let type: FileType = 'other';
      if (ext === 'ipynb') type = 'notebook';
      else if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'bmp', 'webp'].includes(ext || '')) type = 'image';
      else if (['csv', 'json', 'xlsx', 'xls', 'parquet'].includes(ext || '')) type = 'data';

      let path = (f as ProjectFile & { path?: string }).path;
      let isObjectUrl = false;
      if (f.file && !path) {
        path = URL.createObjectURL(f.file);
        isObjectUrl = true;
      } else if (!path) {
        path = f.name;
      }

      return { id: f.id, title: f.name, type, path, data: { isObjectUrl } };
    });

    setTabs(prev => [...prev, ...newTabs]);
    
    if (newTabs.length > 0) {
      const lastId = newTabs[newTabs.length - 1].id;
      setActiveTabId(lastId);
      setActiveFileId(lastId);
      activeFileIdRef.current = lastId;
    }
  }, [setFiles, setTabs, setActiveFileId, setActiveTabId, activeFileIdRef]);

  const handleRenameFile = useCallback((id: string, newName: string) => {
    setFiles(prev => prev.map(f =>
      f.id === id ? { ...f, name: newName } : f
    ));
    setTabs(prev => prev.map(t =>
      t.id === id ? { ...t, title: newName } : t
    ));
  }, [setFiles, setTabs]);

  return {
    handleDeleteFile,
    handleImportFiles,
    handleRenameFile,
  };
};
