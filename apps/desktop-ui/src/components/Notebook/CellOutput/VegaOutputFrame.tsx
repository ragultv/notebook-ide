/**
 * VegaOutputFrame.tsx
 *
 * Renders Vega, Vega-Lite, and Altair specs inside a sandboxed iframe.
 * Supports:
 *   application/vnd.vega.v5+json      — Vega spec
 *   application/vnd.vegalite.v4+json  — Vega-Lite v4 spec
 *   application/vnd.vegalite.v5+json  — Vega-Lite v5 spec
 *   application/vnd.altair.v1+json    — Altair (same as Vega-Lite)
 *
 * Uses vega-embed which handles both Vega and Vega-Lite automatically.
 */

import React, { useRef, useEffect, useState } from 'react';

const RESIZE_SCRIPT = `
<script>
  function reportHeight() {
    if (!document.body) return;
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      200
    );
    window.parent.postMessage({ type: 'vega-resize', height: h }, '*');
  }
  window.addEventListener('load', function() {
    reportHeight();
    if (window.ResizeObserver && document.body) {
      new ResizeObserver(reportHeight).observe(document.body);
    }
  });
</script>
`;

interface VegaOutputFrameProps {
    /** Raw Vega or Vega-Lite spec — may be string or object */
    spec: unknown;
    minHeight?: number;
}

export const VegaOutputFrame: React.FC<VegaOutputFrameProps> = React.memo(({ spec, minHeight = 300 }) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(minHeight);

    useEffect(() => {
        const handler = (ev: MessageEvent) => {
            if (
                ev.data?.type === 'vega-resize' &&
                typeof ev.data.height === 'number' &&
                ev.data.height > 0 &&
                frameRef.current &&
                ev.source === frameRef.current.contentWindow
            ) {
                setHeight(Math.max(minHeight, ev.data.height + 8));
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [minHeight]);

    const specJson = typeof spec === 'string' ? spec : JSON.stringify(spec);

    const srcDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 4px; background: transparent; overflow: hidden; }
    #vis { width: 100%; }
    .vega-embed { width: 100% !important; }
    .vega-embed canvas, .vega-embed svg { max-width: 100% !important; }
  </style>
  ${RESIZE_SCRIPT}
  <script src="https://cdn.jsdelivr.net/npm/vega@5/build/vega.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-lite@5/build/vega-lite.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-embed@6/build/vega-embed.min.js"></script>
</head>
<body>
  <div id="vis"></div>
  <script>
    try {
      const spec = ${specJson};
      vegaEmbed('#vis', spec, {
        renderer: 'canvas',
        actions: { export: true, source: false, compiled: false, editor: false },
        theme: 'dark',
        config: {
          background: 'transparent',
          font: 'system-ui, sans-serif',
          axis: { gridColor: '#333', tickColor: '#555', labelColor: '#aaa', titleColor: '#ccc' },
          title: { color: '#e0e0e0' },
          legend: { labelColor: '#aaa', titleColor: '#ccc' },
        }
      }).then(() => {
        window.dispatchEvent(new Event('load'));
      }).catch(e => {
        document.body.innerHTML = '<pre style="color:#f88;padding:8px">' + e.message + '</pre>';
      });
    } catch(e) {
      document.body.innerHTML = '<pre style="color:#f88;padding:8px">' + e.message + '</pre>';
    }
  </script>
</body>
</html>`;

    return (
        <iframe
            ref={frameRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
            style={{ width: '100%', height: `${height}px`, border: 'none', display: 'block' }}
            title="Vega chart"
        />
    );
});

VegaOutputFrame.displayName = 'VegaOutputFrame';
