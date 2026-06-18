/**
 * ProjectContext — Global project state for OctoML.
 *
 * All components that need to know "what project is open" consume this context.
 * The project is fetched from the backend on app startup.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { controllerClient } from '../services/controller.client';

export interface ProjectInfo {
  path: string;
  name: string;
}

export interface ProjectManifest {
  version:         string;
  name:            string;
  description:     string;
  created:         string;
  pythonPath:      string;
  defaultNotebook: string;
}

interface ProjectContextValue {
  project:       ProjectInfo | null;
  manifest:      ProjectManifest | null;
  isLoading:     boolean;
  openProject:   (info: ProjectInfo, manifest?: ProjectManifest | null) => void;
  closeProject:  () => Promise<void>;
  refreshProject: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [project,   setProject]   = useState<ProjectInfo | null>(null);
  const [manifest,  setManifest]  = useState<ProjectManifest | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current project from backend on mount
  const refreshProject = useCallback(async () => {
    try {
      const { project: p } = await controllerClient.getProject();
      if (p) {
        setProject(p);
        // Also fetch manifest
        try {
          const { manifest: mData } = await controllerClient.getProjectMetadata();
          setManifest(mData ?? null);
        } catch {
          setManifest(null);
        }
      } else {
        setProject(null);
        setManifest(null);
      }
    } catch {
      setProject(null);
      setManifest(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshProject(); }, [refreshProject]);

  const openProject = useCallback((info: ProjectInfo, m?: ProjectManifest | null) => {
    setProject(info);
    setManifest(m ?? null);
  }, []);

  const closeProject = useCallback(async () => {
    try {
      await controllerClient.closeProject();
    } catch { /* ignore */ }
    setProject(null);
    setManifest(null);
  }, []);

  return (
    <ProjectContext.Provider value={{ project, manifest, isLoading, openProject, closeProject, refreshProject }}>
      {children}
    </ProjectContext.Provider>
  );
};

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside <ProjectProvider>');
  return ctx;
}
