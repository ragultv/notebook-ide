/**
 * HtmlOutputFrame.tsx
 *
 * VS Code equivalent: backLayerWebView.ts + webviewPreloads.ts
 * (src/vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView.ts)
 *
 * Renders ALL rich HTML output (Plotly, Bokeh, Altair, pandas DataFrames,
 * ipywidgets HTML views) inside a sandboxed <iframe>.
 *
 * Why sandboxed iframe?
 *  - Plotly/Bokeh embed their own <script> tags which cannot run in React's DOM
 *  - ipywidgets HTML view requires isolated JS execution context
 *  - VS Code uses a full IFrame (backLayerWebView) for exactly this reason
 *
 * The iframe auto-resizes to its content height via a ResizeObserver message.
 */

import React, { useRef, useEffect, useState } from 'react';

// Injected into every iframe to auto-report content height.
// ResizeObserver setup is deferred to the 'load' event so document.body exists.
// Running new ResizeObserver().observe(document.body) synchronously in <head>
// throws because the body element hasn't been parsed yet.
const RESIZE_SCRIPT = `
<script>
  function reportHeight() {
    if (!document.body) return;
    var h = document.documentElement.scrollHeight || document.body.scrollHeight || 40;
    window.parent.postMessage({ type: 'iframe-resize', height: h }, '*');
  }
  window.addEventListener('load', function() {
    reportHeight();
    if (window.ResizeObserver && document.body) {
      new ResizeObserver(reportHeight).observe(document.body);
    }
  });
</script>
`;

interface HtmlOutputFrameProps {
    html: string;
    /** Fallback minimum height in px (default 40) */
    minHeight?: number;
}

export const HtmlOutputFrame: React.FC<HtmlOutputFrameProps> = React.memo(({ html, minHeight = 40 }) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(minHeight);

    // Listen for height reports from the iframe
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (
                event.data?.type === 'iframe-resize' &&
                typeof event.data.height === 'number' &&
                event.data.height > 0
            ) {
                // Only accept messages from our own iframe
                if (frameRef.current && event.source === frameRef.current.contentWindow) {
                    setHeight(Math.max(minHeight, event.data.height + 8));
                }
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [minHeight]);

    // Build the full HTML document with our resize script injected
    const srcDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 4px;
      background: transparent;
      color: #d4d4d4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
    }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #333; padding: 4px 8px; text-align: left; }
    th { background: #1e1e1e; color: #9cdcfe; }
    tr:nth-child(even) { background: #1a1a1a; }
    img { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; word-break: break-all; }
  </style>
  ${RESIZE_SCRIPT}
</head>
<body>${html}</body>
</html>`;

    return (
        <iframe
            ref={frameRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin allow-popups"
            style={{
                width: '100%',
                height: `${height}px`,
                border: 'none',
                display: 'block',
                transition: 'height 0.1s ease',
            }}
            title="Cell output"
        />
    );
});

HtmlOutputFrame.displayName = 'HtmlOutputFrame';
