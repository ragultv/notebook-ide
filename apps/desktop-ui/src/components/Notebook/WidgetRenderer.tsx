/**
 * WidgetRenderer — renders ipywidgets inside a cell output area.
 *
 * Rendering pipeline:
 *   1. waitForModel(commId)  — waits until comm_open has registered the model
 *   2. createWidgetView()    — calls HTMLManager.create_view() then display_view()
 *   3. On failure/timeout    — shows htmlFallback (Jupyter's text/html MIME) or
 *                              a "not available" badge
 */

import React, { useEffect, useRef, useState } from 'react';
import { createWidgetView, waitForModel, onWidgetStateChange } from '../../services/widget.service';
import { Puzzle, AlertTriangle } from 'lucide-react';

interface WidgetRendererProps {
    commId: string;
    targetName?: string;
    /** text/html from the same MIME bundle — Jupyter's non-widget fallback */
    htmlFallback?: string;
    className?: string;
}

export const WidgetRenderer: React.FC<WidgetRendererProps> = ({
    commId,
    targetName,
    htmlFallback,
    className = '',
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'ok' | 'fallback' | 'unavailable'>('loading');
    const viewRef = useRef<any>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const renderWidget = async () => {
            // Give React a frame to mount the ref
            await new Promise(r => requestAnimationFrame(r));
            if (!containerRef.current) return;

            // Bug 4 fix: use waitForModel instead of hasWidget — handles
            // the case where display_data arrives before all comm_opens complete.
            const model = await waitForModel(commId, 10_000);

            if (cancelled || !mountedRef.current) return;

            if (!model) {
                setStatus(htmlFallback ? 'fallback' : 'unavailable');
                return;
            }

            if (!containerRef.current) return;

            // Clear loading spinner text manually if needed
            setStatus('ok'); // Need to reveal the container before injecting

            try {
                // Race render against 8-second timeout (5s wasn't enough for large widget trees)
                const result = await Promise.race<any>([
                    createWidgetView(commId, containerRef.current),
                    new Promise<null>(resolve => setTimeout(() => resolve(null), 8_000)),
                ]);

                if (cancelled || !mountedRef.current) return;

                if (result) {
                    viewRef.current = result;
                } else {
                    setStatus(htmlFallback ? 'fallback' : 'unavailable');
                }
            } catch (err) {
                console.warn(`[WidgetRenderer] Render error:`, err);
                if (!cancelled && mountedRef.current) {
                    setStatus(htmlFallback ? 'fallback' : 'unavailable');
                }
            }
        };

        renderWidget();

        return () => {
            cancelled = true;
            if (viewRef.current) {
                try { viewRef.current.remove?.(); } catch { }
                viewRef.current = null;
            }
        };
    }, [commId, htmlFallback]);

    // ── JSX ──────────────────────────────────────────────────────────────────

    return (
        <div className={`widget-wrapper ${className} relative min-h-[40px]`}>

            {status === 'loading' && (
                <div className="flex items-center gap-2 py-3 px-1 text-gray-500 text-xs font-mono animate-pulse">
                    <Puzzle className="w-3.5 h-3.5 opacity-50 shrink-0" />
                    <span>Rendering widget…</span>
                </div>
            )}

            {status === 'fallback' && htmlFallback && (
                <div
                    className="widget-html-fallback"
                    dangerouslySetInnerHTML={{ __html: htmlFallback }}
                />
            )}

            {status === 'unavailable' && (
                <div className="flex items-center gap-2 py-2 text-red-500 text-xs font-mono">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Widget failed to render or timed out</span>
                </div>
            )}

            {/* We always mount the container because Lumino appends directly into it, but we only show it when ok */}
            <div
                ref={containerRef}
                className={`widget-container ${status === 'ok' ? 'block' : 'hidden'}`}
                data-comm-id={commId}
                data-target-name={targetName}
            />

        </div>
    );
};

// ── MIME helpers (used by OutputItem in Cell.tsx) ─────────────────────────────

export function extractWidgetInfo(
    data: Record<string, any>
): { modelId: string; htmlFallback?: string } | null {
    const widgetView = data['application/vnd.jupyter.widget-view+json'];
    if (widgetView?.model_id) {
        return {
            modelId: widgetView.model_id,
            htmlFallback: data['text/html'] as string | undefined,
        };
    }
    return null;
}

export default WidgetRenderer;
