/**
 * CellOutputTerminal — Handles ALL output types from a single cell using xterm.js.
 * - text/stream → xterm.js
 * - text/html   → dangerouslySetInnerHTML (sandboxed iframe recommended)
 * - image/png   → <img> tag
 * - error       → xterm.js with red ANSI
 * - input_request → inline input prompt
 */

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useNotebookWebSocket } from '../hooks/useNotebookWebSocket';

// Import xterm.css in your main index.css or App.tsx instead
// import '@xterm/xterm/css/xterm.css';

interface Props {
    cellId: string;
    notebookId: string;
    executionId: string | null;
}

export function CellOutputTerminal({ cellId, notebookId, executionId }: Props) {
    const termRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const [richOutputs, setRichOutputs] = useState<any[]>([]);
    const [inputPrompt, setInputPrompt] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const currentExecId = useRef<string | null>(null);
    const { on, sendStdin } = useNotebookWebSocket(notebookId);

    // Init xterm once
    useEffect(() => {
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: '"JetBrains Mono", monospace',
            theme: { background: '#0f0f14', foreground: '#c8c8d4' },
            convertEol: true,
            scrollback: 5000,
            disableStdin: true    // stdin handled via input prompt UI, not xterm
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(termRef.current!);
        fit.fit();
        xtermRef.current = term;
        fitRef.current = fit;

        const observer = new ResizeObserver(() => fit.fit());
        observer.observe(termRef.current!);
        return () => { observer.disconnect(); term.dispose(); };
    }, []);

    // Listen for output messages
    useEffect(() => {
        if (!executionId) return;

        const cleanups: (() => void)[] = [];

        cleanups.push(on('execution_started', (msg: any) => {
            if (msg.cell_id !== cellId) return;
            currentExecId.current = msg.execution_id;
            xtermRef.current?.clear();
            setRichOutputs([]);
            setInputPrompt(null);
        }));

        cleanups.push(on('output', (msg: any) => {
            if (msg.execution_id !== currentExecId.current) return;
            
            const output = msg.output;
            if (output.type === 'stream') {
                if (output.stream === 'stderr') {
                    xtermRef.current?.write(`\x1b[31m${output.data}\x1b[0m`);
                } else {
                    xtermRef.current?.write(output.data);
                }
                fitRef.current?.fit();
            } else if (output.type === 'result' || output.type === 'display') {
                // Handle widget outputs
                if (output.data?.['application/vnd.jupyter.widget-view+json']) {
                    // Widget output - will be handled by comm messages
                    console.log('[CellOutputTerminal] Widget output detected, waiting for comm_open');
                    return;
                }
                
                if (output.data?.['text/html']) {
                    setRichOutputs(prev => [...prev, { type: 'html', content: output.data['text/html'] }]);
                } else if (output.data?.['image/png']) {
                    setRichOutputs(prev => [...prev, { type: 'image', content: output.data['image/png'] }]);
                } else if (output.data?.['text/plain']) {
                    xtermRef.current?.write(`\x1b[36m${output.data['text/plain']}\x1b[0m\r\n`);
                    fitRef.current?.fit();
                } else if (typeof output.data === 'object' && output.data !== null) {
                    // Handle complex objects by converting to string
                    const displayText = JSON.stringify(output.data, null, 2);
                    xtermRef.current?.write(`\x1b[36m${displayText}\x1b[0m\r\n`);
                    fitRef.current?.fit();
                }
            }
        }));

        cleanups.push(on('execution_error', (msg: any) => {
            if (msg.execution_id !== currentExecId.current) return;
            xtermRef.current?.write(`\r\n\x1b[31mError: ${msg.error}\x1b[0m\r\n`);
            fitRef.current?.fit();
        }));

        cleanups.push(on('input_request', (msg: any) => {
            if (msg.execution_id !== currentExecId.current) return;
            setInputPrompt(msg.prompt);
        }));

        return () => cleanups.forEach(c => c());
    }, [cellId, executionId, on]);

    const submitInput = () => {
        if (!currentExecId.current || !inputPrompt) return;
        sendStdin(currentExecId.current, inputValue);
        xtermRef.current?.write(`${inputValue}\r\n`);
        setInputPrompt(null);
        setInputValue('');
    };

    return (
        <div className="w-full">
            <div ref={termRef} style={{ minHeight: 40, width: '100%' }} />

            {richOutputs.map((out, i) => (
                <div key={i} style={{ marginTop: 8 }}>
                    {out.type === 'html' && <div dangerouslySetInnerHTML={{ __html: out.content }} />}
                    {out.type === 'image' && <img src={`data:image/png;base64,${out.content}`} style={{ maxWidth: '100%' }} />}
                </div>
            ))}

            {inputPrompt && (
                <div style={{ display: 'flex', gap: 8, padding: 8, background: '#1a1a2e' }}>
                    <span style={{ color: '#9cdcfe', fontFamily: 'monospace' }}>{inputPrompt}</span>
                    <input
                        autoFocus
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && submitInput()}
                        style={{ 
                            background: 'transparent', 
                            border: 'none', 
                            outline: 'none',
                            color: '#c8c8d4', 
                            fontFamily: 'monospace', 
                            flex: 1 
                        }}
                    />
                </div>
            )}
        </div>
    );
}
