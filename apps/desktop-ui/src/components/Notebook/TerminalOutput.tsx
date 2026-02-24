import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { controllerClient } from '../../services/controller.client';
import '@xterm/xterm/css/xterm.css';

interface TerminalOutputProps {
    notebookId: string;
    streamData: string[]; // Array of incoming raw PTY data strings
    isRunning: boolean;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({ notebookId, streamData, isRunning }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const processedChunksRef = useRef<number>(0);

    // Initialize xterm.js
    useEffect(() => {
        if (!terminalRef.current) return;

        if (xtermRef.current) {
            xtermRef.current.dispose();
        }

        const terminal = new Terminal({
            cursorBlink: true,
            theme: {
                background: 'transparent',
                foreground: '#c9d1d9',
                cursor: '#58a6ff',
                selectionBackground: '#388bfd33',
                black: '#484f58',
                red: '#ff7b72',
                green: '#3fb950',
                yellow: '#d29922',
                blue: '#58a6ff',
                magenta: '#bc8cff',
                cyan: '#39c5cf',
                white: '#b1bac4',
                brightBlack: '#6e7681',
                brightRed: '#ffa198',
                brightGreen: '#56d364',
                brightYellow: '#e3b341',
                brightBlue: '#79c0ff',
                brightMagenta: '#d2a8ff',
                brightCyan: '#56d4dd',
                brightWhite: '#ffffff'
            },
            fontFamily: '"SF Mono", "Menlo", "Consolas", "Ubuntu Mono", monospace',
            fontSize: 13,
            lineHeight: 1.4, // Gives breathing room matching normal UI
            rightClickSelectsWord: true,
            disableStdin: false,
            scrollback: 5000,
            scrollOnUserInput: true,
        });

        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);

        terminal.open(terminalRef.current);

        // Fix 1: Properly size immediately after mounting to prevent hiding top/bottom
        fitAddon.fit();
        setTimeout(() => {
            try {
                fitAddon.fit();
                if (isRunning) {
                    controllerClient.resizeTerminal(notebookId, terminal.cols, terminal.rows).catch(console.warn);
                }
            } catch (e) {
                console.warn('Failed to fit terminal initially:', e);
            }
        }, 50);

        terminal.onData((data: string) => {
            if (isRunning) {
                controllerClient.sendInput(notebookId, data).catch((err: any) => {
                    console.error('Failed to send terminal input:', err);
                });
            }
        });

        xtermRef.current = terminal;
        fitAddonRef.current = fitAddon;
        processedChunksRef.current = 0;

        // Fix 2: Debounced resize observer
        let resizeTimeout: ReturnType<typeof setTimeout>;
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                try {
                    if (fitAddonRef.current && xtermRef.current?.element?.parentElement) {
                        fitAddonRef.current.fit();
                        const newCols = xtermRef.current.cols;
                        const newRows = xtermRef.current.rows;

                        if (isRunning) {
                            controllerClient.resizeTerminal(notebookId, newCols, newRows).catch(console.warn);
                        }
                    }
                } catch (e) {
                    // Ignore transient sizing errors
                }
            }, 100);
        });

        resizeObserver.observe(terminalRef.current);

        return () => {
            clearTimeout(resizeTimeout);
            resizeObserver.disconnect();
            terminal.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!xtermRef.current || !fitAddonRef.current) return;

        if (streamData.length === 0 || streamData.length < processedChunksRef.current) {
            xtermRef.current.reset(); // Full reset for re-run
            processedChunksRef.current = 0;
            if (streamData.length === 0) return;
        }

        const newChunks = streamData.slice(processedChunksRef.current);
        if (newChunks.length > 0) {
            for (const chunk of newChunks) {
                if (chunk) {
                    xtermRef.current.write(chunk);
                }
            }
            processedChunksRef.current = streamData.length;
        }

        if (xtermRef.current.options.disableStdin !== !isRunning) {
            xtermRef.current.options.disableStdin = !isRunning;
        }

    }, [streamData, isRunning]);

    return (
        <div className="w-full relative bg-[#09090b] rounded-b-xl overflow-hidden border-t border-white/5">
            {/* Custom scrollbar matching application dark mode */}
            <style dangerouslySetInnerHTML={{
                __html: `
                .xterm-viewport::-webkit-scrollbar {
                    width: 14px;
                    background: transparent;
                }
                .xterm-viewport::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.15);
                    border: 4px solid #09090b;
                    border-radius: 8px;
                }
                .xterm-viewport::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.25);
                }
            `}} />

            {/* The xterm container with FIXED height to prevent FitAddon bleeding. 
                Paddings ensure spacing, right padding is kept low to pin scrollbar to edge */}
            <div
                ref={terminalRef}
                className="w-full h-[450px] pl-4 py-4 pr-1 relative"
            />
        </div>
    );
};
