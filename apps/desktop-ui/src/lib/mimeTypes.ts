/**
 * mimeTypes.ts — MIME type priority resolution.
 *
 * VS Code equivalent: notebookCommon.ts NOTEBOOK_DISPLAY_ORDER +
 *   cellOutputViewModel.ts resolveMimeTypes()
 *
 * When a cell returns a MIME bundle (multiple representations), this module
 * picks the best one following the same priority order VS Code uses.
 */

// ── Priority list (highest priority first) ────────────────────────────────────
// Mirrors VS Code's NOTEBOOK_DISPLAY_ORDER from notebookCommon.ts
export const NOTEBOOK_DISPLAY_ORDER: readonly string[] = [
    // Interactive widget — highest priority (model data over any HTML fallback)
    'application/vnd.jupyter.widget-view+json',

    // Interactive charts
    'application/vnd.plotly.v1+json',
    'application/vnd.vega.v5+json',
    'application/vnd.vegalite.v4+json',
    'application/vnd.vegalite.v5+json',
    'application/vnd.altair.v1+json',

    // Structured data
    'application/json',

    // Script (executed in sandbox)
    'application/javascript',

    // Rich HTML (pandas DataFrame, Bokeh, etc.)
    'text/html',

    // Vector graphics
    'image/svg+xml',

    // Markdown
    'text/markdown',

    // LaTeX
    'text/latex',

    // Raster images
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',

    // Plain text — always last
    'text/plain',
];

// ── resolveMimeType ───────────────────────────────────────────────────────────

/**
 * Given a MIME bundle (map of mimeType → data), return the best MIME type
 * to render, following NOTEBOOK_DISPLAY_ORDER.
 *
 * Returns null if the bundle is empty or has no recognizable MIME type.
 */
export function resolveMimeType(bundle: Record<string, unknown>): string | null {
    for (const mime of NOTEBOOK_DISPLAY_ORDER) {
        if (bundle[mime] !== undefined) return mime;
    }
    // Fallback: return the first key found in the bundle
    const keys = Object.keys(bundle);
    return keys.length > 0 ? keys[0] : null;
}

/**
 * Returns true if this MIME type should be rendered in a sandboxed iframe.
 * Matches VS Code's "backLayerWebView" rendering decision.
 */
export function requiresIframe(mime: string): boolean {
    return (
        mime === 'text/html' ||
        mime === 'image/svg+xml' ||
        mime === 'application/javascript' ||
        mime === 'application/vnd.plotly.v1+json' ||
        mime === 'application/vnd.vega.v5+json' ||
        mime === 'application/vnd.vegalite.v4+json' ||
        mime === 'application/vnd.vegalite.v5+json' ||
        mime === 'application/vnd.altair.v1+json'
    );
}

/** Return true if this is a raster image MIME type. */
export function isImageMime(mime: string): boolean {
    return mime.startsWith('image/') && mime !== 'image/svg+xml';
}
