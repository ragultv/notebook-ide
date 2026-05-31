// """
// Memory Map Visualization Component

// Canvas-based 2D scatter plot for kernel memory variables.
// Supports zoom, pan, hover tooltips, and click-to-navigate.
// """

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  MemorySnapshot,
  MemoryPoint,
  MemoryMapFilters,
  MemoryMapViewport,
  TypeCategory,
} from '../../../../packages/shared-types/memory';
import {
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ArrowLeft,
  Loader2,
  Notebook,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import { ProjectFile } from '../types';
import { controllerClient } from '../services/controller.client';
import { VariablePanel } from './VariablePanel';

interface MemoryMapVisualizationProps {
  notebookId: string;
  snapshot: MemorySnapshot | null;
  onVariableClick?: (variableName: string) => void;
  onRefresh?: () => void;
}

const TYPE_COLORS: Record<TypeCategory, string> = {
  tensor: '#EF4444',       // Red-500 (Alert/Critical)
  array: '#0096FF',        // Brand Primary Blue
  model: '#C8E8FF',        // Brand Pale Cyan
  scalar: '#1070D0',       // Brand Secondary Blue
  collection: '#0040A0',   // Brand Dark Ocean Blue
  function: '#A0D0F0',     // Brand Accent Ice Blue
  object: '#FECACA',       // Red-200
  module: '#7C2D12',       // Red-900
  generator: '#004090',    // Brand Royal Blue
};

export const MemoryMapVisualization: React.FC<MemoryMapVisualizationProps> = ({
  notebookId,
  snapshot,
  onVariableClick,
  onRefresh,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<MemoryMapViewport>({
    centerX: 0,
    centerY: 0,
    scale: 1,
    width: 800,
    height: 600,
  });
  const [filters, setFilters] = useState<MemoryMapFilters>({
    type_categories: new Set(Object.keys(TYPE_COLORS) as TypeCategory[]),
    min_size_bytes: 0,
    max_size_bytes: Infinity,
    recent_only: false,
    recent_threshold_seconds: 60,
    search_query: '',
  });
  const [hoveredPoint, setHoveredPoint] = useState<MemoryPoint | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  // Convert snapshot to renderable points
  const points: MemoryPoint[] = useMemo(() => {
    if (!snapshot || !Array.isArray(snapshot.variables)) return [];

    const now = Date.now() / 1000;
    const coords = snapshot.coordinates_2d || [];

    return snapshot.variables
      .map((v, idx) => {
        const [x, y] = coords[idx] || [0, 0];
        const radius = Math.max(3, Math.min(20, Math.log10(v.size_bytes + 1) * 2));
        const age = now - v.last_access_time;
        const opacity = filters.recent_only
          ? age < filters.recent_threshold_seconds ? 1.0 : 0.2
          : 1.0;

        return {
          metadata: v,
          x,
          y,
          color: TYPE_COLORS[v.type_category] || '#888',
          radius,
          opacity,
        };
      })
      .filter(p => {
        // Apply filters
        if (!filters.type_categories.has(p.metadata.type_category)) return false;
        if (p.metadata.size_bytes < filters.min_size_bytes) return false;
        if (p.metadata.size_bytes > filters.max_size_bytes) return false;
        if (filters.search_query && !p.metadata.name.toLowerCase().includes(filters.search_query.toLowerCase())) return false;
        return true;
      });
  }, [snapshot, filters]);

  // Auto-fit view on initial load
  useEffect(() => {
    if (points.length === 0) return;

    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const scaleX = canvas.width / rangeX * 0.8;
    const scaleY = canvas.height / rangeY * 0.8;
    const scale = Math.min(scaleX, scaleY);

    setViewport(prev => ({ ...prev, centerX, centerY, scale }));
  }, [points.length]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Transform coordinates
    const toScreenX = (x: number) => (x - viewport.centerX) * viewport.scale + canvas.width / 2;
    const toScreenY = (y: number) => (y - viewport.centerY) * viewport.scale + canvas.height / 2;

    // Draw grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      const x = toScreenX(i);
      const y = toScreenY(i);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Draw points
    points.forEach(point => {
      const screenX = toScreenX(point.x);
      const screenY = toScreenY(point.y);

      // Skip if off-screen (with margin)
      if (screenX < -50 || screenX > canvas.width + 50 || screenY < -50 || screenY > canvas.height + 50) {
        return;
      }

      ctx.globalAlpha = point.opacity;
      ctx.fillStyle = point.color;
      ctx.beginPath();
      ctx.arc(screenX, screenY, point.radius, 0, Math.PI * 2);
      ctx.fill();

      // Highlight if hovered
      if (hoveredPoint && hoveredPoint.metadata.name === point.metadata.name) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    ctx.globalAlpha = 1;
  }, [points, viewport, hoveredPoint]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setMousePos({ x: e.clientX, y: e.clientY });

    // Handle dragging
    if (isDragging && dragStart) {
      const dx = (mouseX - dragStart.x) / viewport.scale;
      const dy = (mouseY - dragStart.y) / viewport.scale;
      setViewport(prev => ({
        ...prev,
        centerX: prev.centerX - dx,
        centerY: prev.centerY - dy,
      }));
      setDragStart({ x: mouseX, y: mouseY });
      setHoveredPoint(null); // Clear hover during drag
      return;
    }

    // Find hovered point - use canvas dimensions, not viewport
    const toDataX = (x: number) => (x - canvas.width / 2) / viewport.scale + viewport.centerX;
    const toDataY = (y: number) => (y - canvas.height / 2) / viewport.scale + viewport.centerY;

    // Convert mouse position to canvas coordinates (accounting for display scaling)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = mouseX * scaleX;
    const canvasY = mouseY * scaleY;

    const dataX = toDataX(canvasX);
    const dataY = toDataY(canvasY);

    let closest: MemoryPoint | null = null;
    let minDist = Infinity;

    points.forEach(point => {
      const dx = point.x - dataX;
      const dy = point.y - dataY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const threshold = point.radius / viewport.scale;

      if (dist < threshold && dist < minDist) {
        minDist = dist;
        closest = point;
      }
    });

    setHoveredPoint(closest);
  }, [points, viewport, isDragging, dragStart]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setIsDragging(true);
    setDragStart({ x: mouseX, y: mouseY });
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
    setHoveredPoint(null);
    setMousePos(null);
  }, []);

  const handleClick = useCallback(() => {
    if (hoveredPoint && onVariableClick) {
      onVariableClick(hoveredPoint.metadata.name);
    }
  }, [hoveredPoint, onVariableClick]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setViewport(prev => ({ ...prev, scale: prev.scale * zoomFactor }));
  }, []);

  const handleZoomIn = () => setViewport(prev => ({ ...prev, scale: prev.scale * 1.2 }));
  const handleZoomOut = () => setViewport(prev => ({ ...prev, scale: prev.scale / 1.2 }));
  const handleReset = () => {
    if (points.length === 0) return;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    setViewport(prev => ({ ...prev, centerX, centerY, scale: 1 }));
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="w-full h-full bg-[#09090b] flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="h-12 border-b border-sim-border flex items-center px-4 gap-3 bg-sim-surface shrink-0">
        <Search className="w-4 h-4 text-sim-muted" />
        <input
          type="text"
          placeholder="Filter variables..."
          value={filters.search_query}
          onChange={(e) => setFilters(prev => ({ ...prev, search_query: e.target.value }))}
          className="flex-1 bg-sim-bg border border-sim-border rounded px-3 py-1.5 text-xs text-sim-text focus:outline-none focus:border-sim-muted"
        />
        <div className="flex gap-1">
          <button onClick={handleZoomIn} className="p-1.5 hover:bg-sim-bg rounded" title="Zoom In">
            <ZoomIn className="w-4 h-4 text-sim-muted" />
          </button>
          <button onClick={handleZoomOut} className="p-1.5 hover:bg-sim-bg rounded" title="Zoom Out">
            <ZoomOut className="w-4 h-4 text-sim-muted" />
          </button>
          <button onClick={handleReset} className="p-1.5 hover:bg-sim-bg rounded" title="Reset View">
            <RotateCcw className="w-4 h-4 text-sim-muted" />
          </button>
        </div>
        <button onClick={onRefresh} className="px-3 py-1.5 bg-sim-red text-white text-xs rounded hover:bg-sim-redHover">
          Refresh
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        <canvas
          ref={canvasRef}
          width={1600}
          height={1200}
          className={`w-full h-full ${hoveredPoint ? 'cursor-pointer' : isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          onWheel={handleWheel}
        />

        {/* Tooltip */}
        {hoveredPoint && mousePos && (
          <div
            className="absolute bg-gray-900/95 border-2 border-sim-red/50 rounded-lg p-3 pointer-events-none z-50 text-xs font-mono shadow-xl backdrop-blur-sm"
            style={{
              left: Math.min(mousePos.x + 15, viewport.width - 250),
              top: Math.min(mousePos.y + 15, viewport.height - 200),
              maxWidth: '250px',
            }}
          >
            <div className="font-bold text-sim-red mb-2 text-sm">{hoveredPoint.metadata.name}</div>
            <div className="text-gray-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Type:</span>
                <span className="text-white font-semibold">{hoveredPoint.metadata.type_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Category:</span>
                <span className="text-white">{hoveredPoint.metadata.type_category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Size:</span>
                <span className="text-white font-semibold">{formatBytes(hoveredPoint.metadata.size_bytes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Refs:</span>
                <span className="text-white">{hoveredPoint.metadata.ref_count}</span>
              </div>
              {hoveredPoint.metadata.shape && hoveredPoint.metadata.shape.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Shape:</span>
                  <span className="text-white font-mono text-xs">[{hoveredPoint.metadata.shape.join(', ')}]</span>
                </div>
              )}
              {hoveredPoint.metadata.is_mutable !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Mutable:</span>
                  <span className={hoveredPoint.metadata.is_mutable ? "text-yellow-400" : "text-gray-400"}>
                    {hoveredPoint.metadata.is_mutable ? 'Yes' : 'No'}
                  </span>
                </div>
              )}
              {hoveredPoint.metadata.dependencies && hoveredPoint.metadata.dependencies.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <div className="text-gray-500 mb-1">Dependencies:</div>
                  <div className="text-sim-red text-xs">
                    {hoveredPoint.metadata.dependencies.slice(0, 5).join(', ')}
                    {hoveredPoint.metadata.dependencies.length > 5 && ` (+${hoveredPoint.metadata.dependencies.length - 5} more)`}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-4 right-4 bg-black/80 border border-sim-border rounded-lg p-3 text-[10px] font-mono">
          <div className="font-bold text-white mb-2">Type Legend</div>
          <div className="space-y-1">
            {Object.entries(TYPE_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-sim-muted">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        {snapshot && (
          <div className="absolute bottom-4 left-4 bg-black/80 border border-sim-border rounded-lg p-3 text-[10px] font-mono">
            <div className="text-white space-y-1">
              <div>Variables: {points.length} / {snapshot.variables?.length || 0}</div>
              <div>Total Memory: {formatBytes(snapshot.total_memory_bytes || 0)}</div>
              <div>Algorithm: {(snapshot.algorithm || 'unknown').toUpperCase()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface MemoryMapProps {
  notebooks: ProjectFile[];
  initialNotebookId?: string | null;
  onOpenNotebook: (notebookId: string) => void;
}

const MemoryMap: React.FC<MemoryMapProps> = ({ notebooks, initialNotebookId, onOpenNotebook }) => {
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedNotebook = useMemo(
    () => notebooks.find(n => n.id === selectedNotebookId) || null,
    [notebooks, selectedNotebookId]
  );

  const loadSnapshot = useCallback(async (notebookId: string, silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await controllerClient.getMemorySnapshot(notebookId, 'umap');
      setSnapshot(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load memory snapshot';
      setError(message);
      setSnapshot(null);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!initialNotebookId) return;
    if (!notebooks.some(n => n.id === initialNotebookId)) return;
    setSelectedNotebookId(current => current ?? initialNotebookId);
  }, [initialNotebookId, notebooks]);

  useEffect(() => {
    if (!selectedNotebookId) {
      setSnapshot(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    controllerClient
      .getMemorySnapshot(selectedNotebookId, 'umap')
      .then(data => {
        if (!isMounted) return;
        setSnapshot(data);
      })
      .catch(err => {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : 'Failed to load memory snapshot';
        setError(message);
        setSnapshot(null);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedNotebookId]);

  const handleSelectNotebook = useCallback((notebookId: string) => {
    setSelectedNotebookId(notebookId);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!selectedNotebookId) return;
    loadSnapshot(selectedNotebookId);
  }, [selectedNotebookId, loadSnapshot]);

  const handleVariableClick = useCallback(
    (variableName: string) => {
      if (!selectedNotebookId) return;
      onOpenNotebook(selectedNotebookId);
    },
    [onOpenNotebook, selectedNotebookId]
  );

  const handleBackToList = useCallback(() => {
    setSelectedNotebookId(null);
    setSnapshot(null);
    setError(null);
  }, []);

  if (!selectedNotebookId) {
    return (
      <div className="w-full h-full bg-sim-bg flex flex-col">
        <div className="h-14 border-b border-sim-border flex items-center px-6 text-sm font-medium text-sim-muted bg-sim-surface">
          Select a notebook to inspect its memory footprint
        </div>
        <div className="flex-1 overflow-y-auto p-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {notebooks.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center text-sim-muted border border-dashed border-sim-border rounded-lg p-8">
              <HardDrive className="w-10 h-10 mb-4 text-sim-border" />
              <span className="text-sm">No notebooks loaded yet. Create or open a notebook to begin.</span>
            </div>
          ) : (
            notebooks.map(notebook => (
              <div
                key={notebook.id}
                className="border border-sim-border/70 bg-sim-surface rounded-lg p-4 flex flex-col gap-3 hover:border-sim-muted transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-sim-text truncate" title={notebook.name}>
                      {notebook.name}
                    </div>
                    <div className="text-xs text-sim-muted mt-1">
                      {notebook.cells?.length || 0} cells
                    </div>
                  </div>
                  <button
                    onClick={() => handleSelectNotebook(notebook.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded bg-sim-red text-white hover:bg-sim-redHover"
                  >
                    View Memory
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-sim-muted">
                  <Notebook className="w-4 h-4" />
                  <span>{notebook.path ? notebook.path : 'Unsaved notebook'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-sim-muted">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Open notebook to fix execution errors</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => onOpenNotebook(notebook.id)}
                    className="flex-1 px-3 py-1.5 text-xs rounded border border-sim-border text-sim-muted hover:border-sim-muted"
                  >
                    Open Notebook
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-sim-bg flex flex-col overflow-hidden">
      <div className="h-14 border-b border-sim-border flex items-center gap-3 px-4 bg-sim-surface shrink-0">
        <button
          onClick={handleBackToList}
          className="p-1.5 rounded hover:bg-sim-bg text-sim-muted"
          title="Back to notebooks"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-sim-text truncate">
            {selectedNotebook?.name || 'Notebook Memory'}
          </div>
          <div className="text-xs text-sim-muted truncate">
            Inspect variables to diagnose memory and execution issues.
          </div>
        </div>
        <button
          onClick={() => onOpenNotebook(selectedNotebookId)}
          className="px-3 py-1.5 text-xs font-medium rounded border border-sim-border text-sim-muted hover:border-sim-muted"
        >
          Open Notebook
        </button>
        <button
          onClick={handleRefresh}
          className="px-3 py-1.5 text-xs font-medium rounded bg-sim-red text-white hover:bg-sim-redHover"
        >
          Refresh Snapshot
        </button>
      </div>

      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-sim-bg/60 z-10">
            <Loader2 className="w-6 h-6 text-sim-muted animate-spin" />
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 text-sim-muted">
            <AlertTriangle className="w-6 h-6 text-sim-red" />
            <span className="text-sm max-w-sm">{error}</span>
            <button
              onClick={handleRefresh}
              className="px-3 py-1.5 text-xs font-medium rounded bg-sim-red text-white hover:bg-sim-redHover"
            >
              Try Again
            </button>
          </div>
        )}

        {!error && !snapshot && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-sim-muted gap-2">
            <HardDrive className="w-8 h-8" />
            <span className="text-sm">Run a cell in this notebook to capture a memory snapshot.</span>
          </div>
        )}

        {snapshot && (
          <div className="w-full h-full flex overflow-hidden">
            <div className="flex-1 h-full relative">
              <MemoryMapVisualization
                notebookId={selectedNotebookId}
                snapshot={snapshot}
                onVariableClick={handleVariableClick}
                onRefresh={handleRefresh}
              />
            </div>
            <div className="w-[450px] border-l border-sim-border flex-shrink-0 h-full overflow-hidden flex flex-col">
              <VariablePanel
                variables={snapshot.variables.map(v => ({
                  name: v.name,
                  type: v.type_name,
                  shape: v.shape ? v.shape.join(' × ') : undefined,
                  size_bytes: v.size_bytes,
                  value: undefined,
                }))}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemoryMap;
