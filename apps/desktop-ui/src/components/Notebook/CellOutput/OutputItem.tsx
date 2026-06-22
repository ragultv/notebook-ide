/**
 * OutputItem.tsx
 *
 * VS Code equivalent: webviewPreloads.ts MIME renderer selection +
 *   cellOutputViewModel.ts resolveMimeTypes()
 *
 * Pure MIME-router — no state, no side effects.
 * Routes a CellOutput to the correct renderer using VS Code's MIME priority order.
 *
 * Rendering pipeline (matches VS Code + JupyterLab):
 *
 *   CellOutput
 *     ↓
 *   resolveMimeType()          — pick best MIME from bundle
 *     ↓
 *   Renderer selected:
 *     widget-view+json         → WidgetRenderer
 *     plotly.v1+json           → PlotlyOutputFrame
 *     vega*.json               → VegaOutputFrame
 *     text/html / svg+xml      → HtmlOutputFrame (sandboxed iframe)
 *     image/png, image/jpeg    → <img>
 *     text/markdown            → rendered markdown
 *     application/json         → formatted JSON
 *     text/plain / stream      → AnsiRenderer (colored text)
 *     error                    → TracebackRenderer
 */

import React from 'react';
import { CellOutput } from '../../../types';
import { WidgetRenderer, extractWidgetInfo } from '../WidgetRenderer';
import { renderMarkdown } from '../TextCell';
import { HtmlOutputFrame } from './HtmlOutputFrame';
import { PlotlyOutputFrame } from './PlotlyOutputFrame';
import { VegaOutputFrame } from './VegaOutputFrame';
import { AnsiRenderer } from './AnsiRenderer';
import { resolveMimeType, isImageMime } from '../../../lib/mimeTypes';

// ── Error traceback renderer ──────────────────────────────────────────────────

const TracebackRenderer: React.FC<{ ename: string; evalue: string; traceback: string[] }> = ({ ename, evalue, traceback }) => {
    const lines = traceback.length > 0 ? traceback.join('\n') : `${ename}: ${evalue}`;
    return (
        <div className="mt-4 overflow-x-auto">
            <AnsiRenderer
                text={lines}
                className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.55]"
                defaultColor="#f87171"
            />
        </div>
    );
};

// ── MIME bundle renderer ──────────────────────────────────────────────────────

const MimeBundleRenderer: React.FC<{ bundle: Record<string, unknown> }> = React.memo(({ bundle }) => {
    const mime = resolveMimeType(bundle);
    if (!mime) return null;

    const data = bundle[mime];

    // 1. Jupyter widget view
    if (mime === 'application/vnd.jupyter.widget-view+json') {
        const modelId = (data as any)?.model_id;
        const htmlFallback = bundle['text/html'] as string | undefined;
        if (modelId) return <WidgetRenderer commId={modelId} htmlFallback={htmlFallback} />;
        return <div className="text-gray-400 text-sm italic p-2">[Widget — model not ready]</div>;
    }

    // 2. Plotly interactive chart
    if (mime === 'application/vnd.plotly.v1+json') {
        return <PlotlyOutputFrame data={data} />;
    }

    // 3. Vega / Vega-Lite / Altair
    if (
        mime === 'application/vnd.vega.v5+json' ||
        mime === 'application/vnd.vegalite.v4+json' ||
        mime === 'application/vnd.vegalite.v5+json' ||
        mime === 'application/vnd.altair.v1+json'
    ) {
        return <VegaOutputFrame spec={data} />;
    }

    // 4. HTML (Bokeh, pandas DataFrame, Plotly fallback, etc.)
    if (mime === 'text/html') {
        // Check if this is actually a widget (ipywidgets sometimes sends HTML)
        try {
            const widgetInfo = extractWidgetInfo(bundle as Record<string, any>);
            if (widgetInfo) return <WidgetRenderer commId={widgetInfo.modelId} />;
        } catch (_) {}
        return <HtmlOutputFrame html={data as string} />;
    }

    // 5. SVG — render in iframe for interactivity (zoom, etc.)
    if (mime === 'image/svg+xml') {
        return <HtmlOutputFrame html={data as string} />;
    }

    // 6. Raster images
    if (isImageMime(mime)) {
        const src = mime === 'image/png'
            ? `data:image/png;base64,${data}`
            : mime === 'image/jpeg'
                ? `data:image/jpeg;base64,${data}`
                : mime === 'image/gif'
                    ? `data:image/gif;base64,${data}`
                    : `data:${mime};base64,${data}`;
        return (
            <div className="flex justify-center py-2">
                <img src={src} alt="Output" className="max-w-full h-auto rounded-lg shadow-sm" />
            </div>
        );
    }

    // 7. Markdown
    if (mime === 'text/markdown') {
        return (
            <div
                className="prose prose-invert prose-sm max-w-none text-gray-200 leading-relaxed font-sans"
                dangerouslySetInnerHTML={renderMarkdown(data as string)}
            />
        );
    }

    // 8. LaTeX
    if (mime === 'text/latex') {
        return (
            <div className="font-mono text-yellow-400 py-2 overflow-x-auto whitespace-pre">
                {data as string}
            </div>
        );
    }

    // 9. JSON
    if (mime === 'application/json') {
        return (
            <div className="bg-[#1e1e20] p-3 rounded-lg border border-white/10 overflow-x-auto text-[13px] font-mono text-[#ce9178]">
                <pre className="break-words whitespace-pre-wrap m-0">
                    {JSON.stringify(data, null, 2)}
                </pre>
            </div>
        );
    }

    // 10. JavaScript (execute in iframe sandbox)
    if (mime === 'application/javascript') {
        const html = `<script>${data as string}</script>`;
        return <HtmlOutputFrame html={html} />;
    }

    // 11. Plain text fallback — render with ANSI colors
    const text = data != null ? String(data) : JSON.stringify(bundle, null, 2);
    return (
        <AnsiRenderer
            text={text}
            className="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-gray-300"
        />
    );
});

MimeBundleRenderer.displayName = 'MimeBundleRenderer';

// ── OutputItem ────────────────────────────────────────────────────────────────

export const OutputItem: React.FC<{ output: CellOutput }> = React.memo(({ output }) => {
    // ── Widget (comm-based) ───────────────────────────────────────────────────
    if (output.type === 'widget' && output.commId) {
        return <WidgetRenderer commId={output.commId} targetName={output.targetName} />;
    }

    // ── Image (already base64, explicit type) ─────────────────────────────────
    if (output.type === 'image' && output.data) {
        return (
            <div className="flex justify-center py-2">
                <img
                    src={`data:${output.mimeType || 'image/png'};base64,${output.data}`}
                    alt="Output"
                    className="max-w-full h-auto rounded-lg shadow-sm"
                />
            </div>
        );
    }

    // ── HTML (explicit type, no bundle) ───────────────────────────────────────
    if (output.type === 'html' && output.data && typeof output.data === 'string') {
        try {
            const widgetInfo = extractWidgetInfo({} as Record<string, any>);
            if (widgetInfo) return <WidgetRenderer commId={widgetInfo.modelId} />;
        } catch (_) {}
        return <HtmlOutputFrame html={output.data} />;
    }

    // ── MIME bundle (display_data / execute_result) ───────────────────────────
    if (
        output.type === 'result' ||
        output.type === 'display'
    ) {
        if (typeof output.data === 'object' && output.data !== null) {
            return <MimeBundleRenderer bundle={output.data as Record<string, unknown>} />;
        }
        // Scalar result (plain text)
        const text = String(output.data ?? '');
        return (
            <AnsiRenderer
                text={text}
                className="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-gray-300"
            />
        );
    }

    // ── Error / traceback ─────────────────────────────────────────────────────
    if (output.type === 'error') {
        const ename = (output as any).ename ?? 'Error';
        const evalue = (output as any).evalue ?? String(output.data ?? '');
        const traceback = (output as any).traceback ?? [];
        return <TracebackRenderer ename={ename} evalue={evalue} traceback={traceback} />;
    }

    // ── Stream (stdout / stderr) — may contain ANSI codes ────────────────────
    if (output.type === 'stream' || output.type === 'text') {
        const text = String(output.data ?? '');
        const isStderr = output.stream === 'stderr';
        return (
            <AnsiRenderer
                text={text}
                className={`whitespace-pre-wrap break-words font-mono text-[13px] leading-5 ${isStderr ? 'text-yellow-300' : 'text-gray-300'}`}
                defaultColor={isStderr ? '#fde047' : '#d1d5db'}
            />
        );
    }

    // ── Generic fallback ──────────────────────────────────────────────────────
    return (
        <AnsiRenderer
            text={String(output.data ?? '')}
            className="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-gray-300"
        />
    );
});

OutputItem.displayName = 'OutputItem';

// Re-export for files that import stripAnsi from OutputItem
export { stripAnsi } from './AnsiRenderer';
