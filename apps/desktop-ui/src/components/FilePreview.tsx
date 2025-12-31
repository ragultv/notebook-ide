// File Preview Component - Preview CSV, XLSX, images, and text files
import React, { useState, useEffect } from 'react';
import { X, Table, Image, FileText, ChevronLeft, ChevronRight, Loader2, FileSpreadsheet } from 'lucide-react';
import { controllerClient } from '../services/controller.client';

interface FilePreviewProps {
  filePath: string;
  fileName: string;
  isObjectUrl?: boolean; // True if filePath is a blob URL from an uploaded file
  onClose: () => void;
}

// CSV/XLSX data type
interface TableData {
  headers: string[];
  rows: any[][];
  totalRows: number;
  sheets?: string[];
  currentSheet?: string;
  dtypes?: Record<string, string>;
}

export const FilePreview: React.FC<FilePreviewProps> = ({ filePath, fileName, isObjectUrl, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'csv' | 'xlsx' | 'image' | 'text' | 'unknown'>('unknown');
  const [content, setContent] = useState<string>('');
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [currentSheet, setCurrentSheet] = useState<string | undefined>(undefined);
  const rowsPerPage = 100;

  useEffect(() => {
    loadFile();
  }, [filePath]);

  useEffect(() => {
    if (fileType === 'xlsx' && currentSheet) {
      loadXLSX(currentSheet);
    }
  }, [currentSheet]);

  const getFileType = (name: string): 'csv' | 'xlsx' | 'image' | 'text' | 'unknown' => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'csv') return 'csv';
    if (['xlsx', 'xls'].includes(ext)) return 'xlsx';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'image';
    if (['txt', 'md', 'json', 'py', 'js', 'ts', 'html', 'css', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log'].includes(ext)) return 'text';
    return 'unknown';
  };

  const loadFile = async () => {
    try {
      setLoading(true);
      setError(null);
      const type = getFileType(fileName);
      setFileType(type);

      if (type === 'csv') {
        await loadCSV();
      } else if (type === 'xlsx') {
        await loadXLSX();
      } else if (type === 'image') {
        loadImage();
      } else {
        await loadText();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const loadCSV = async () => {
    // If it's an object URL (uploaded file), fetch and parse it directly
    if (isObjectUrl) {
      try {
        const response = await fetch(filePath);
        const text = await response.text();
        parseCSVContent(text);
      } catch (err) {
        setError('Failed to read uploaded CSV file');
      }
      return;
    }
    
    // Try backend API first
    try {
      const data = await controllerClient.previewCSV(filePath, 500);
      setTableData({
        headers: data.headers,
        rows: data.rows,
        totalRows: data.totalRows,
        dtypes: data.dtypes,
      });
    } catch (err) {
      // Fallback to manual parsing
      try {
        const { content } = await controllerClient.readFile(filePath);
        parseCSVContent(content);
      } catch {
        setError('Failed to load CSV file');
      }
    }
  };

  const parseCSVContent = (content: string) => {
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      setTableData({ headers: [], rows: [], totalRows: 0 });
      return;
    }

    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => parseCSVLine(line));

    setTableData({
      headers,
      rows,
      totalRows: rows.length,
    });
  };

  const loadXLSX = async (sheet?: string) => {
    if (isObjectUrl) {
      setError('Excel preview requires files to be in the project folder. Use pandas.read_excel() in a code cell.');
      return;
    }
    
    try {
      const data = await controllerClient.previewExcel(filePath, sheet, 500);
      setTableData({
        headers: data.headers,
        rows: data.rows,
        totalRows: data.totalRows,
        sheets: data.sheets,
        currentSheet: data.currentSheet,
        dtypes: data.dtypes,
      });
      if (!currentSheet && data.currentSheet) {
        setCurrentSheet(data.currentSheet);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Excel file. Make sure pandas and openpyxl are installed.');
    }
  };

  const loadImage = () => {
    if (isObjectUrl) {
      // For uploaded files, use the blob URL directly
      setImageUrl(filePath);
    } else {
      setImageUrl(`http://localhost:8000/files/raw?path=${encodeURIComponent(filePath)}`);
    }
  };

  const loadText = async () => {
    if (isObjectUrl) {
      try {
        const response = await fetch(filePath);
        const text = await response.text();
        setContent(text);
      } catch {
        setError('Failed to read uploaded text file');
      }
      return;
    }
    
    const { content } = await controllerClient.readFile(filePath);
    setContent(content);
  };

  const getIcon = () => {
    switch (fileType) {
      case 'csv':
        return <Table className="w-5 h-5 text-green-400" />;
      case 'xlsx':
        return <FileSpreadsheet className="w-5 h-5 text-green-500" />;
      case 'image':
        return <Image className="w-5 h-5 text-purple-400" />;
      default:
        return <FileText className="w-5 h-5 text-blue-400" />;
    }
  };

  const renderTablePreview = () => {
    if (!tableData) return null;

    const startIdx = currentPage * rowsPerPage;
    const endIdx = Math.min(startIdx + rowsPerPage, tableData.rows.length);
    const displayRows = tableData.rows.slice(startIdx, endIdx);
    const totalPages = Math.ceil(tableData.rows.length / rowsPerPage);

    return (
      <div className="flex flex-col h-full">
        {/* Table Info */}
        <div className="px-4 py-2 bg-[#252526] border-b border-[#404040] flex items-center justify-between text-sm flex-shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-gray-400">
              {tableData.totalRows.toLocaleString()} rows × {tableData.headers.length} columns
            </span>
            {/* Sheet selector for Excel */}
            {tableData.sheets && tableData.sheets.length > 1 && (
              <select
                value={currentSheet || ''}
                onChange={(e) => setCurrentSheet(e.target.value)}
                className="bg-[#1e1e1e] border border-[#404040] rounded px-2 py-1 text-sm text-gray-300"
              >
                {tableData.sheets.map(sheet => (
                  <option key={sheet} value={sheet}>{sheet}</option>
                ))}
              </select>
            )}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="p-1 hover:bg-[#3d3d3d] rounded disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-gray-400">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="p-1 hover:bg-[#3d3d3d] rounded disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-[#2d2d2d] z-10">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-normal border-b border-[#404040] w-12 sticky left-0 bg-[#2d2d2d]">#</th>
                {tableData.headers.map((header, i) => (
                  <th key={i} className="px-3 py-2 text-left text-gray-300 font-medium border-b border-[#404040] min-w-[100px] whitespace-nowrap">
                    {String(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-[#252526]">
                  <td className="px-3 py-1.5 text-gray-500 border-b border-[#333] sticky left-0 bg-[#1e1e1e]">
                    {startIdx + rowIdx + 1}
                  </td>
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx} className="px-3 py-1.5 text-gray-300 border-b border-[#333] max-w-[300px] truncate" title={String(cell)}>
                      {cell === null || cell === undefined ? <span className="text-gray-600 italic">null</span> : String(cell)}
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

  const renderImagePreview = () => {
    if (!imageUrl) return null;

    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[#1a1a1a] overflow-auto">
        <img
          src={imageUrl}
          alt={fileName}
          className="max-w-full max-h-[calc(100%-40px)] object-contain"
          onError={() => setError('Failed to load image')}
        />
        <div className="mt-2 text-sm text-gray-500">{fileName}</div>
      </div>
    );
  };

  const renderTextPreview = () => {
    return (
      <div className="flex-1 overflow-auto p-4 bg-[#1a1a1a]">
        <pre className="text-sm text-gray-300 font-mono whitespace-pre-wrap">{content}</pre>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-[#1e1e1e] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-[#252526] border-b border-[#404040] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          {getIcon()}
          <div>
            <h3 className="font-medium text-white text-sm">{fileName}</h3>
            <p className="text-xs text-gray-500 truncate max-w-[400px]">{isObjectUrl ? 'Uploaded file' : filePath}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-[#333] hover:bg-[#444] rounded text-gray-300 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <X className="w-3.5 h-3.5" />
          Close Preview
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#e85d04]" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-red-400 mb-2 text-sm">{error}</div>
            <p className="text-xs text-gray-500">
              You can load this file in a code cell using pandas.
            </p>
          </div>
        </div>
      ) : (
        <>
          {(fileType === 'csv' || fileType === 'xlsx') && renderTablePreview()}
          {fileType === 'image' && renderImagePreview()}
          {(fileType === 'text' || fileType === 'unknown') && renderTextPreview()}
        </>
      )}
    </div>
  );
};

export default FilePreview;
