// File Preview Component - Preview CSV, XLSX, JSON, images, and text files
import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Table, Image, FileText, ChevronLeft, ChevronRight, Loader2,
  FileSpreadsheet, ZoomIn, ZoomOut, RotateCcw, Braces, Download,
} from 'lucide-react';
import { controllerClient, BASE_URL } from '../services/controller.client';

interface FilePreviewProps {
  filePath: string;
  fileName: string;
  isObjectUrl?: boolean;
  onClose: () => void;
}

interface TableData {
  headers: string[];
  rows: any[][];
  totalRows: number;
  sheets?: string[];
  currentSheet?: string;
  dtypes?: Record<string, string>;
}

type FileType = 'csv' | 'xlsx' | 'image' | 'json' | 'text' | 'unknown';

// ── JSON Syntax Highlighter ──────────────────────────────────────────────────

function syntaxHighlight(json: string): string {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'text-green-700 dark:text-[#b5cea8]'; // number
      if (/^"/.test(match)) {
        if (/:$/.test(match)) cls = 'text-blue-700 dark:text-[#9cdcfe]'; // key
        else cls = 'text-amber-800 dark:text-[#ce9178]'; // string
      } else if (/true|false/.test(match)) cls = 'text-indigo-700 dark:text-[#569cd6]'; // boolean
      else if (/null/.test(match)) cls = 'text-gray-500 dark:text-[#808080]'; // null
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

const JsonViewer: React.FC<{ content: string }> = ({ content }) => {
  const [parsed, setParsed] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [view, setView] = useState<'pretty' | 'raw'>('pretty');

  useEffect(() => {
    try {
      setParsed(JSON.parse(content));
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
    }
  }, [content]);

  const prettyJson = parsed ? JSON.stringify(parsed, null, 2) : content;
  const highlighted = syntaxHighlight(prettyJson.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

  return (
    <div className="flex flex-col h-full text-sim-text">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-sim-border bg-sim-surface flex-shrink-0">
        <div className="flex items-center gap-1 bg-sim-bg rounded-lg p-0.5 border border-sim-border">
          <button
            onClick={() => setView('pretty')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${view === 'pretty' ? 'bg-sim-red text-white' : 'text-sim-muted hover:text-sim-text'}`}
          >
            Pretty
          </button>
          <button
            onClick={() => setView('raw')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${view === 'raw' ? 'bg-sim-red text-white' : 'text-sim-muted hover:text-sim-text'}`}
          >
            Raw
          </button>
        </div>
        {parseError && <span className="text-xs text-red-500">⚠ {parseError}</span>}
        {parsed && (
          <span className="text-xs text-sim-muted ml-auto">
            {Array.isArray(parsed) ? `Array[${parsed.length}]` : `Object{${Object.keys(parsed).length}}`}
          </span>
        )}
      </div>
      {/* Content */}
      <div className="flex-1 overflow-auto bg-sim-bg p-4 border border-sim-border rounded-lg m-4">
        {view === 'pretty' ? (
          <pre
            className="text-sm font-mono leading-relaxed text-sim-text"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <pre className="text-sm font-mono text-sim-text leading-relaxed whitespace-pre-wrap">{content}</pre>
        )}
      </div>
    </div>
  );
};

// ── Image Viewer ─────────────────────────────────────────────────────────────

const ImageViewer: React.FC<{ imageUrl: string; fileName: string }> = ({ imageUrl, fileName }) => {
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  const zoomIn  = () => setZoom(z => Math.min(z + 0.25, 5));
  const zoomOut = () => setZoom(z => Math.max(z - 0.25, 0.1));
  const reset   = () => setZoom(1);

  return (
    <div className="flex flex-col h-full text-sim-text">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-sim-border bg-sim-surface flex-shrink-0">
        <button onClick={zoomOut} className="p-1.5 rounded hover:bg-sim-border text-sim-muted hover:text-sim-text transition-colors" title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-sim-muted min-w-[50px] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn} className="p-1.5 rounded hover:bg-sim-border text-sim-muted hover:text-sim-text transition-colors" title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={reset} className="p-1.5 rounded hover:bg-sim-border text-sim-muted hover:text-sim-text transition-colors" title="Reset zoom">
          <RotateCcw className="w-4 h-4" />
        </button>
        <span className="ml-auto text-xs text-sim-muted">{fileName}</span>
      </div>
      {/* Image area */}
      <div className="flex-1 overflow-auto bg-sim-bg flex items-center justify-center p-4"
           style={{ backgroundImage: 'radial-gradient(circle, var(--sim-border) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        {error ? (
          <div className="text-red-500 text-sm">Failed to load image</div>
        ) : (
          <img
            src={imageUrl}
            alt={fileName}
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.15s ease' }}
            className="max-w-none object-contain shadow-2xl rounded"
            onError={() => setError(true)}
          />
        )}
      </div>
    </div>
  );
};

// ── Main FilePreview ─────────────────────────────────────────────────────────

export const FilePreview: React.FC<FilePreviewProps> = ({ filePath, fileName, isObjectUrl, onClose }) => {
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [fileType, setFileType]     = useState<FileType>('unknown');
  const [content, setContent]       = useState<string>('');
  const [tableData, setTableData]   = useState<TableData | null>(null);
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [currentPage, setCurrentPage]   = useState(0);
  const [currentSheet, setCurrentSheet] = useState<string | undefined>(undefined);
  const rowsPerPage = 100;

  const getFileType = (name: string): FileType => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'csv')  return 'csv';
    if (['xlsx', 'xls'].includes(ext)) return 'xlsx';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
    if (ext === 'json') return 'json';
    if (['txt', 'md', 'py', 'js', 'ts', 'html', 'css', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'sh', 'bash'].includes(ext)) return 'text';
    return 'unknown';
  };

  const loadFile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setCurrentPage(0);
      const type = getFileType(fileName);
      setFileType(type);

      if (type === 'csv') {
        await loadCSV();
      } else if (type === 'xlsx') {
        await loadXLSX();
      } else if (type === 'image') {
        loadImage();
        setLoading(false);
      } else {
        // text, json, unknown — all loaded as text
        await loadText(type);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  }, [filePath, fileName, isObjectUrl]);

  useEffect(() => { loadFile(); }, [filePath]);
  useEffect(() => {
    if (fileType === 'xlsx' && currentSheet) loadXLSX(currentSheet);
  }, [currentSheet]);

  const loadCSV = async () => {
    if (isObjectUrl) {
      const response = await fetch(filePath);
      parseCSVContent(await response.text());
      return;
    }
    try {
      const data = await controllerClient.previewCSV(filePath, 500);
      setTableData({ headers: data.headers, rows: data.rows, totalRows: data.totalRows, dtypes: data.dtypes });
    } catch {
      const { content } = await controllerClient.readFile(filePath);
      parseCSVContent(content);
    }
  };

  const parseCSVContent = (raw: string) => {
    const lines = raw.split('\n').filter(l => l.trim());
    if (!lines.length) { setTableData({ headers: [], rows: [], totalRows: 0 }); return; }
    const parseCSVLine = (line: string) => {
      const result: string[] = [];
      let cur = '', inQ = false;
      for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      result.push(cur.trim());
      return result;
    };
    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(parseCSVLine);
    setTableData({ headers, rows, totalRows: rows.length });
  };

  const loadXLSX = async (sheet?: string) => {
    if (isObjectUrl) {
      setError('Excel preview requires the file to be inside the project folder.');
      return;
    }
    const data = await controllerClient.previewExcel(filePath, sheet, 500);
    setTableData({ headers: data.headers, rows: data.rows, totalRows: data.totalRows, sheets: data.sheets, currentSheet: data.currentSheet, dtypes: data.dtypes });
    if (!currentSheet && data.currentSheet) setCurrentSheet(data.currentSheet);
  };

  const loadImage = () => {
    setImageUrl(isObjectUrl ? filePath : `${BASE_URL}/files/raw?path=${encodeURIComponent(filePath)}`);
  };

  const loadText = async (_type: FileType) => {
    if (isObjectUrl) {
      const response = await fetch(filePath);
      setContent(await response.text());
      return;
    }
    const { content: text } = await controllerClient.readFile(filePath);
    setContent(text);
  };

  const getIcon = () => {
    switch (fileType) {
      case 'csv':   return <Table className="w-4 h-4 text-green-500" />;
      case 'xlsx':  return <FileSpreadsheet className="w-4 h-4 text-green-600" />;
      case 'image': return <Image className="w-4 h-4 text-purple-500" />;
      case 'json':  return <Braces className="w-4 h-4 text-yellow-600" />;
      default:      return <FileText className="w-4 h-4 text-sim-muted" />;
    }
  };

  const renderTablePreview = () => {
    if (!tableData) return null;
    const startIdx   = currentPage * rowsPerPage;
    const endIdx     = Math.min(startIdx + rowsPerPage, tableData.rows.length);
    const displayRows = tableData.rows.slice(startIdx, endIdx);
    const totalPages = Math.ceil(tableData.rows.length / rowsPerPage);

    return (
      <div className="flex flex-col h-full text-sim-text">
        <div className="px-4 py-2 bg-sim-surface border-b border-sim-border flex items-center justify-between text-xs flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-sim-muted">
              {tableData.totalRows.toLocaleString()} rows × {tableData.headers.length} columns
            </span>
            {tableData.sheets && tableData.sheets.length > 1 && (
              <select
                value={currentSheet || ''}
                onChange={e => setCurrentSheet(e.target.value)}
                className="bg-sim-bg border border-sim-border rounded px-2 py-0.5 text-xs text-sim-text"
              >
                {tableData.sheets.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-sim-text">
              <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}
                className="p-1 hover:bg-sim-border rounded disabled:opacity-30">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-sim-muted">Page {currentPage + 1} / {totalPages}</span>
              <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}
                className="p-1 hover:bg-sim-border rounded disabled:opacity-30">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-sim-surface z-10">
              <tr>
                <th className="px-3 py-2 text-left text-sim-muted font-normal border-b border-sim-border w-10 sticky left-0 bg-sim-surface">#</th>
                {tableData.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-sim-red font-medium border-b border-sim-border min-w-[90px] whitespace-nowrap">
                    {String(h)}
                    {tableData.dtypes?.[h] && (
                      <span className="ml-1.5 text-sim-muted font-normal">{tableData.dtypes[h]}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, ri) => (
                <tr key={ri} className="hover:bg-sim-bg/50 border-b border-sim-border text-sim-text">
                  <td className="px-3 py-1 text-sim-muted sticky left-0 bg-sim-bg">{startIdx + ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1 text-sim-text max-w-[280px] truncate" title={String(cell)}>
                      {cell === null || cell === undefined
                        ? <span className="text-sim-muted italic">null</span>
                        : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderTextPreview = () => (
    <div className="flex-1 overflow-auto bg-sim-bg p-4 border border-sim-border rounded-lg m-4">
      <pre className="text-sm text-sim-text font-mono whitespace-pre-wrap leading-relaxed">{content}</pre>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-sim-bg overflow-hidden">
      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-sim-red" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <div className="text-red-500 mb-2 text-sm font-medium">{error}</div>
            <p className="text-xs text-sim-muted">Try loading this file using pandas or another library in a code cell.</p>
            <button onClick={loadFile} className="mt-3 px-4 py-1.5 bg-sim-red/20 hover:bg-sim-red/30 border border-sim-red/30 rounded-lg text-xs text-sim-red transition-colors">
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          {(fileType === 'csv' || fileType === 'xlsx') && renderTablePreview()}
          {fileType === 'image' && imageUrl && <ImageViewer imageUrl={imageUrl} fileName={fileName} />}
          {fileType === 'json' && <JsonViewer content={content} />}
          {(fileType === 'text' || fileType === 'unknown') && renderTextPreview()}
        </>
      )}
    </div>
  );
};

export default FilePreview;
