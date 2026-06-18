/**
 * useProjectFileTree — manages the VS Code-style file tree for the active project.
 *
 * Features:
 *  - Loads the full project tree from the backend on mount
 *  - Polling every 5 seconds to detect external file changes
 *  - Expand/collapse directories
 *  - Tree state is kept in memory (no persisted expansion state)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { controllerClient } from '../services/controller.client';
import { useProject } from '../context/ProjectContext';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FileTreeNode {
    name:        string;
    virtualPath: string;
    type:        'file' | 'directory';
    extension?:  string;
    size?:       number;
    modified?:   string;
    children?:   FileTreeNode[];
}

export interface FileTreeState {
    nodes:           FileTreeNode[];
    isLoading:       boolean;
    error:           string | null;
    expandedPaths:   Set<string>;
    selectedPath:    string | null;
    // actions
    toggleExpand:    (virtualPath: string) => void;
    setSelected:     (virtualPath: string | null) => void;
    refresh:         () => Promise<void>;
    expandPath:      (virtualPath: string) => void;
    collapseAll:     () => void;
}

const POLL_INTERVAL = 5000; // ms

export function useProjectFileTree(): FileTreeState {
    const { project } = useProject();

    const [nodes,         setNodes]         = useState<FileTreeNode[]>([]);
    const [isLoading,     setIsLoading]     = useState(false);
    const [error,         setError]         = useState<string | null>(null);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/', '/notebooks', '/data']));
    const [selectedPath,  setSelectedPath]  = useState<string | null>(null);

    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── Fetch tree ──────────────────────────────────────────────────────────────

    const refresh = useCallback(async () => {
        if (!project) return;
        setIsLoading(true);
        setError(null);
        try {
            const data = await controllerClient.getFileTree();
            setNodes(data.tree || []);
        } catch (e: any) {
            setError(e.message || 'Failed to load file tree');
        } finally {
            setIsLoading(false);
        }
    }, [project]);

    // Initial load + polling
    useEffect(() => {
        if (!project) {
            setNodes([]);
            return;
        }

        refresh();

        // Set up polling for external file changes
        pollingRef.current = setInterval(() => {
            refresh();
        }, POLL_INTERVAL);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [project, refresh]);

    // ── Actions ─────────────────────────────────────────────────────────────────

    const toggleExpand = useCallback((virtualPath: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(virtualPath)) next.delete(virtualPath);
            else next.add(virtualPath);
            return next;
        });
    }, []);

    const expandPath = useCallback((virtualPath: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            // Expand all parent paths too
            const parts = virtualPath.split('/').filter(Boolean);
            let path = '';
            for (const part of parts) {
                path += '/' + part;
                next.add(path);
            }
            return next;
        });
    }, []);

    const collapseAll = useCallback(() => {
        setExpandedPaths(new Set());
    }, []);

    const setSelected = useCallback((virtualPath: string | null) => {
        setSelectedPath(virtualPath);
    }, []);

    return {
        nodes,
        isLoading,
        error,
        expandedPaths,
        selectedPath,
        toggleExpand,
        setSelected,
        refresh,
        expandPath,
        collapseAll,
    };
}
