/**
 * useAutosave.ts — P2-3: Debounced autosave hook.
 *
 * Triggers a save 3 seconds after the last cell change. Visual indicator
 * is surfaced via the returned `lastSaved` timestamp and `isSaving` flag.
 *
 * Usage:
 *   const { lastSaved, isSaving, saveNow } = useAutosave(activeFile, cells);
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { filesystemClient, NotebookFile } from '../services/filesystem.client';

export interface AutosaveState {
    /** ISO timestamp of the last successful save, or null if never saved via autosave. */
    lastSaved:  string | null;
    /** True while a save is in-flight. */
    isSaving:   boolean;
    /** Trigger an immediate save outside of the debounce window. */
    saveNow:    () => Promise<void>;
}

/**
 * @param notebook  The active NotebookFile object (contains path, cells, handle).
 * @param cells     The current cells array — changes trigger the debounce timer.
 * @param debounceMs Debounce window in milliseconds. Defaults to 3000 (3 seconds).
 */
export function useAutosave(
    notebook:    NotebookFile | null | undefined,
    cells:       any[],
    debounceMs:  number = 3000
): AutosaveState {
    const [lastSaved, setLastSaved] = useState<string | null>(null);
    const [isSaving,  setIsSaving]  = useState(false);

    const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notebookRef = useRef<NotebookFile | null | undefined>(notebook);
    const cellsRef    = useRef<any[]>(cells);
    const isMounted   = useRef(true);

    // Keep refs up-to-date without triggering effects
    notebookRef.current = notebook;
    cellsRef.current    = cells;

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const performSave = useCallback(async () => {
        const nb = notebookRef.current;
        if (!nb) return;
        // Only autosave if there is a persisted path or handle — never download-spam
        if (!nb.path && !nb.handle) return;

        setIsSaving(true);
        try {
            const notebookWithCells: NotebookFile = { ...nb, cells: cellsRef.current };
            await filesystemClient.saveNotebook(notebookWithCells);
            if (isMounted.current) {
                setLastSaved(new Date().toISOString());
            }
        } catch (e) {
            console.error('[Autosave] Failed to save:', e);
        } finally {
            if (isMounted.current) setIsSaving(false);
        }
    }, []);

    // Debounce on every cells change
    useEffect(() => {
        if (!notebook) return;
        if (!notebook.path && !notebook.handle) return; // no save target — skip silently

        // Clear any pending timer and restart
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(performSave, debounceMs);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cells, notebook?.id]); // react to cell changes and notebook switch

    const saveNow = useCallback(async () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        await performSave();
    }, [performSave]);

    return { lastSaved, isSaving, saveNow };
}
