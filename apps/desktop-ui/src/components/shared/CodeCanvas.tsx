import React, { useState, useMemo } from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

export interface CodeCanvasProps {
  language?: string;
  code: string;
}

export const CodeCanvas: React.FC<CodeCanvasProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rawLang = (language && language.trim() !== '' && language.toLowerCase() !== 'code')
    ? language.toLowerCase()
    : 'text';

  const highlightedHtml = useMemo(() => {
    try {
      if (rawLang !== 'text' && hljs.getLanguage(rawLang)) {
        return hljs.highlight(code, { language: rawLang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [code, rawLang]);

  return (
    <div className="my-3.5 rounded-2xl border border-white/10 bg-[#141416] shadow-xl overflow-hidden font-mono not-prose group">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#18181a] dark:bg-[#18181b] border-b border-white/10 text-xs text-zinc-400 font-mono">
        <span className="font-mono text-zinc-400 select-none lowercase font-medium">{rawLang}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Copy code"
          >
            {copied ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
      <div className="p-4 overflow-x-auto text-[12px] leading-relaxed text-zinc-200 selection:bg-blue-500/30">
        <pre className="m-0 font-mono bg-transparent border-none p-0 shadow-none text-inherit">
          <code
            className="hljs !bg-transparent !p-0"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
    </div>
  );
};
