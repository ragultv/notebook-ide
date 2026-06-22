import React from 'react';
import { 
    File, FileCode, FileText, Image as ImageIcon, Database, FileSpreadsheet, 
    FileJson, PlaySquare
} from 'lucide-react';

export const PythonIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 128 128" className={className} fill="currentColor">
    <path d="M64 5.953c-29.219 0-27.938 12.656-27.938 12.656l.031 13.063h28.531v4.188H32.281s-13.688-1.531-13.688 19.344c0 20.875 11.875 19.875 11.875 19.875h6.688v-9.375s-.313-13.438 13.063-13.438h27.938s12.656-.219 12.656-13.031V19.344s1.25-13.391-26.813-13.391zM49.688 13.563c2.406 0 4.313 1.938 4.313 4.344 0 2.375-1.906 4.313-4.313 4.313-2.438 0-4.344-1.938-4.344-4.313 0-2.406 1.906-4.344 4.344-4.344z"/>
    <path d="M64 122.047c29.219 0 27.938-12.656 27.938-12.656l-.031-13.063H63.375v-4.188h32.344s13.688 1.531 13.688-19.344c0-20.875-11.875-19.875-11.875-19.875h-6.688v9.375s.313 13.438-13.063 13.438H49.844s-12.656.219-12.656 13.031v20.844s-1.25 13.391 26.813 13.391zM78.313 114.438c-2.406 0-4.313-1.938-4.313-4.344 0-2.375 1.906-4.313 4.313-4.313 2.438 0 4.344 1.938 4.344 4.313 0 2.406-1.906 4.344-4.344 4.344z"/>
  </svg>
);

export const JupyterIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 128 128" className={className} fill="currentColor">
    <path fill="#F37626" d="M84.773 111.411c-13.375 12.188-34.844 11.063-48.438-2.656s-14.594-35.094-1.969-48.469c.813-.875 2.125-.875 2.938 0l16.156 16.156c.844.813.844 2.125 0 2.938-5.375 5.375-5.375 14.125 0 19.5 5.375 5.406 14.094 5.406 19.5 0 .813-.813 2.125-.813 2.938 0l16.125 16.156c.813.875.813 2.156-7.25 16.375z" />
    <path fill="#767677" d="M43.227 16.589C56.602 4.401 78.07 5.526 91.664 19.245c13.594 13.719 14.594 35.094 1.969 48.469-.813.875-2.125.875-2.938 0L74.539 51.558c-.844-.813-.844-2.125 0-2.938 5.375-5.375 5.375-14.125 0-19.5-5.375-5.406-14.094-5.406-19.5 0-.813.813-2.125.813-2.938 0L35.976 12.964c-.813-.875-.813-2.156 7.25-16.375z" />
    <circle fill="#F37626" cx="24.813" cy="24.813" r="14.313" />
    <circle fill="#767677" cx="103.187" cy="103.187" r="14.313" />
  </svg>
);

export function getFileIcon(extension?: string, className: string = 'w-4 h-4') {
    const ext = extension?.toLowerCase();
    
    // Notebooks & Scripts
    if (ext === '.ipynb') return <PythonIcon className={`${className} text-[#00A38E]`} />;
    if (ext === '.py')    return <PythonIcon className={`${className} text-[#00A38E]`} />;
    
    // Data & Config
    if (ext === '.json')  return <FileJson className={`${className} text-yellow-400`} />;
    if (['.yaml', '.yml', '.toml'].includes(ext || '')) return <FileCode className={`${className} text-yellow-400`} />;
    if (['.csv', '.tsv'].includes(ext || ''))   return <FileSpreadsheet className={`${className} text-green-400`} />;
    if (['.xlsx', '.xls'].includes(ext || ''))  return <FileSpreadsheet className={`${className} text-green-500`} />;
    if (['.pkl', '.pt', '.pth', '.h5', '.onnx', '.joblib'].includes(ext || '')) return <Database  className={`${className} text-red-400`} />;
    
    // Media & Documents
    if (['.md', '.txt', '.rst'].includes(ext || ''))  return <FileText className={`${className} text-sim-muted`} />;
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext || '')) return <ImageIcon className={`${className} text-purple-400`} />;
    if (['.mp4', '.avi', '.mov', '.webm'].includes(ext || '')) return <PlaySquare className={`${className} text-blue-400`} />;
    
    return <File className={`${className} text-sim-muted`} />;
}
