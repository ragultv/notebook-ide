/**
 * PlotlyOutputFrame.tsx
 *
 * Renders application/vnd.plotly.v1+json inside a sandboxed iframe.
 * Loads Plotly from CDN so all interactive features (zoom, pan, hover,
 * selection, subplots) work exactly as they do in JupyterLab / VS Code.
 *
 * The iframe communicates its rendered height back via postMessage so
 * the cell can grow/shrink without a fixed height.
 */

import React, { useRef, useEffect, useState } from 'react';

const RESIZE_SCRIPT = `
<script>
  function reportHeight() {
    if (!document.body) return;
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      300
    );
    window.parent.postMessage({ type: 'plotly-resize', height: h }, '*');
  }
  // Set up AFTER load so document.body is guaranteed to exist.
  // ResizeObserver.observe(document.body) throws if called while body is null
  // (script runs synchronously in <head> before <body> is parsed).
  window.addEventListener('load', function() {
    reportHeight();
    if (window.ResizeObserver && document.body) {
      new ResizeObserver(reportHeight).observe(document.body);
    }
  });
</script>
`;

interface PlotlyOutputFrameProps {
    /** Raw application/vnd.plotly.v1+json value — may be string or object */
    data: unknown;
    minHeight?: number;
}

export const PlotlyOutputFrame: React.FC<PlotlyOutputFrameProps> = React.memo(({ data, minHeight = 460 }) => {
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(minHeight);

    useEffect(() => {
        const handler = (ev: MessageEvent) => {
            if (
                ev.data?.type === 'plotly-resize' &&
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

    const figureJson = typeof data === 'string' ? data : JSON.stringify(data);

    const srcDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    #plot { width: 100%; height: 450px; min-height: 450px; }
  </style>
  ${RESIZE_SCRIPT}
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js" charset="utf-8"></script>
</head>
<body>
  <div id="plot"></div>
  <script>
    function showError(msg) {
      document.getElementById('plot').innerHTML =
        '<pre style="color:#f87171;padding:12px;font-family:monospace;font-size:12px;white-space:pre-wrap">' + msg + '</pre>';
    }

    try {
      const fig = ${figureJson};
      const traces = fig.data || (Array.isArray(fig) ? fig : [fig]);

      // Detect whether any trace is 3D so we can supply 3D-specific defaults.
      const has3D = traces.some(t =>
        t.type === 'surface' || t.type === 'scatter3d' || t.type === 'mesh3d' ||
        t.type === 'cone' || t.type === 'streamtube' || t.type === 'volume' ||
        t.type === 'isosurface'
      );

      // For 3D charts, verify WebGL is available before attempting to render.
      if (has3D) {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl2') ||
                   testCanvas.getContext('webgl') ||
                   testCanvas.getContext('experimental-webgl');
        if (!gl) {
          showError('WebGL is not available in this environment.\\n3D charts (surface, scatter3d, mesh3d) require WebGL.');
          throw new Error('no-webgl');
        }
      }

      // Build layout: start with dark-theme defaults, then merge user layout.
      // For 3D charts do NOT inherit 2D xaxis/yaxis grid defaults — they're ignored
      // for 3D traces and can interfere with scene axis rendering.
      const defaults = {
        paper_bgcolor: '#09090b',
        plot_bgcolor: '#09090b',
        font: { color: '#d4d4d4', family: 'system-ui, sans-serif', size: 12 },
        margin: { l: 60, r: 20, t: 50, b: 60 },
        height: 450,
      };
      if (!has3D) {
        defaults.xaxis = { gridcolor: '#2a2a2e', zerolinecolor: '#444', linecolor: '#333' };
        defaults.yaxis = { gridcolor: '#2a2a2e', zerolinecolor: '#444', linecolor: '#333' };
      } else {
        // 3D scene background — ONLY set if user layout doesn't already define scene.
        if (!(fig.layout && fig.layout.scene)) {
          defaults.scene = {
            bgcolor: '#09090b',
            xaxis: { gridcolor: '#2a2a2e', linecolor: '#333', tickfont: { color: '#aaa' }, titlefont: { color: '#ccc' } },
            yaxis: { gridcolor: '#2a2a2e', linecolor: '#333', tickfont: { color: '#aaa' }, titlefont: { color: '#ccc' } },
            zaxis: { gridcolor: '#2a2a2e', linecolor: '#333', tickfont: { color: '#aaa' }, titlefont: { color: '#ccc' } },
          };
        }
      }

      const layout = Object.assign(defaults, fig.layout || {});

      const config = Object.assign({
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: [],
      }, fig.config || {});

      Plotly.newPlot('plot', traces, layout, config)
        .then(() => { window.dispatchEvent(new Event('load')); })
        .catch(e => { showError('Plotly render error:\\n' + e.message); });
    } catch (e) {
      if (e.message !== 'no-webgl') showError('Chart error:\\n' + e.message);
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
            title="Plotly chart"
        />
    );
});

PlotlyOutputFrame.displayName = 'PlotlyOutputFrame';
