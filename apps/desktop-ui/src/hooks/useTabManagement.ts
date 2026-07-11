import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tab, ProjectFile } from '../types';
import { cleanupWidgets } from '../services/widget.service';

interface UseTabManagementReturn {
  tabs: Tab[];
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
  activeTabId: string | null;
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>;
  activeTab: Tab | undefined;
  handleActivateTab: (id: string) => void;
  handleCloseTab: (id: string, event?: React.MouseEvent) => void;
}

const STORAGE_KEY_TABS = 'octoml_open_tabs';
const STORAGE_KEY_ACTIVE_TAB = 'octoml_active_tab_id';

const loadSavedTabs = (): Tab[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_TABS);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const loadSavedActiveTabId = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_TAB) || null;
  } catch {
    return null;
  }
};

export const useTabManagement = (
  files: ProjectFile[],
  activeFileId: string | null,
  setActiveFileId: (id: string | null) => void
): UseTabManagementReturn => {
  const [tabs, setTabs] = useState<Tab[]>(loadSavedTabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(loadSavedActiveTabId);

  // Persist open tabs and active tab to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabs));
    } catch { /* ignore */ }
  }, [tabs]);

  useEffect(() => {
    try {
      if (activeTabId) localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, activeTabId);
      else localStorage.removeItem(STORAGE_KEY_ACTIVE_TAB);
    } catch { /* ignore */ }
  }, [activeTabId]);

  // Restore activeFileId on mount if active tab is a notebook
  useEffect(() => {
    if (activeTabId && !activeFileId) {
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && tab.type === 'notebook') {
        setActiveFileId(activeTabId);
      }
    }
  }, [activeTabId, activeFileId, tabs, setActiveFileId]);

  const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId), [tabs, activeTabId]);

  // Sync activeFileId with tabs - create tab if file is selected but no tab exists
  useEffect(() => {
    if (activeFileId && activeFileId !== activeTabId) {
      const file = files.find(f => f.id === activeFileId);
      if (file) {
        // Check if tab already exists using functional update to avoid dependency on tabs
        setTabs(prev => {
          const existingTab = prev.find(t => t.id === activeFileId);
          if (existingTab) {
            // Tab already exists, don't duplicate
            return prev;
          }
          // Create new tab for this file
          const newTab: Tab = {
            id: file.id,
            title: file.name,
            type: 'notebook',
            path: file.path
          };
          return [...prev, newTab];
        });
        setActiveTabId(activeFileId);
      }
    }
  }, [activeFileId, files, activeTabId]); // Removed 'tabs' from dependencies to prevent duplicates

  const handleActivateTab = useCallback((id: string) => {
    setActiveTabId(id);
    // Update activeFileId only if it's a notebook tab
    const tab = tabs.find(t => t.id === id);
    if (tab && tab.type === 'notebook') {
      setActiveFileId(id);
    } else {
      setActiveFileId(null);
    }
  }, [tabs, setActiveFileId]);

  const handleCloseTab = useCallback((id: string, event?: React.MouseEvent) => {
    event?.stopPropagation();

    // P1-6: Clean up any ipywidget models owned by this tab before removing it.
    // Only notebook tabs create widget contexts — settings/visualization tabs do not.
    const closingTab = tabs.find(t => t.id === id);
    if (closingTab?.type === 'notebook') {
      cleanupWidgets();
    }

    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id);
      if (activeTabId === id && newTabs.length > 0) {
        const tabIndex = prev.findIndex(t => t.id === id);
        const nextTab = newTabs[Math.max(0, tabIndex - 1)];
        setActiveTabId(nextTab.id);
        // Update activeFileId if next tab is a notebook
        if (nextTab.type === 'notebook') {
          setActiveFileId(nextTab.id);
        } else {
          setActiveFileId(null);
        }
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
        setActiveFileId(null);
      }
      return newTabs;
    });
  }, [activeTabId, setActiveFileId, tabs]);

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    handleActivateTab,
    handleCloseTab,
  };
};
