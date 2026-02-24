import React, { useEffect, useRef, useState } from 'react';
import Editor, { useMonaco, loader } from "@monaco-editor/react";
import controllerClient from '../../services/controller.client';

import { CellData } from '../../types';

interface MonacoCellEditorProps {
    value: string;
    onChange: (value: string) => void;
    onRun: () => void;
    onActivate?: () => void;
    notebookId: string;
    isActive: boolean;
    language?: string;
    allCells?: CellData[];
    cellIndex?: number;
}

export const MonacoCellEditor: React.FC<MonacoCellEditorProps> = ({
    value,
    onChange,
    onRun,
    onActivate,
    notebookId,
    isActive,
    language = 'python',
    allCells = [],
    cellIndex = 0
}) => {
    const monaco = useMonaco();
    const editorRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Calculate initial height based on content to prevent jumping
    const initialLineCount = value.split('\n').length;
    const initialHeightPx = Math.max(40, initialLineCount * 19 + 16);
    const [editorHeight, setEditorHeight] = useState(initialHeightPx);

    const handleEditorWillMount = (monaco: any) => {
        monaco.editor.defineTheme('notebook-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#09090b',
                'editor.lineHighlightBackground': '#ffffff08',
            }
        });
    };

    // Keep focus logic for when isActive changes on an already mounted component
    useEffect(() => {
        if (isActive && editorRef.current) {
            editorRef.current.focus();
        }
    }, [isActive]);

    useEffect(() => {
        if (monaco) {
            // Register completion provider for python
            const provider = monaco.languages.registerCompletionItemProvider('python', {
                provideCompletionItems: async (model, position) => {
                    const code = model.getValue();
                    const offset = model.getOffsetAt(position);

                    // Gather context code from previous cells
                    const contextCode = allCells
                        .slice(0, cellIndex)
                        .map(c => c.content)
                        .join('\n');

                    try {
                        const { completions } = await controllerClient.getCompletions({
                            code,
                            cursorPos: offset,
                            notebookId,
                            contextCode
                        });

                        const word = model.getWordUntilPosition(position);
                        const range = {
                            startLineNumber: position.lineNumber,
                            endLineNumber: position.lineNumber,
                            startColumn: word.startColumn,
                            endColumn: word.endColumn
                        };

                        const items = completions.map((c: any) => ({
                            label: c.name,
                            kind: mapJediTypeToMonacoKind(monaco, c.type),
                            insertText: c.name,
                            detail: c.description,
                            documentation: c.docstring,
                            range: range
                        }));

                        return { suggestions: items };
                    } catch (error) {
                        console.error('Completion error:', error);
                        return { suggestions: [] };
                    }
                },
                triggerCharacters: ['.']
            });

            return () => provider.dispose();
        }
    }, [monaco, notebookId, allCells, cellIndex]);

    const handleEditorDidMount = (editor: any, monaco: any) => {
        editorRef.current = editor;

        // Auto-activate when focused
        editor.onDidFocusEditorText(() => {
            if (onActivate) onActivate();
        });

        // Add command for Shift+Enter to run cell
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            onRun();
        });

        // Immediate focus if cell is already active (happens on newly added cells)
        if (isActive) {
            editor.focus();
            // Sometimes one focus isn't enough during the layout pass
            setTimeout(() => editor.focus(), 10);
        }

        // Precise height management without infinite loops
        const updateHeight = () => {
            // Calculate height reliably from actual lines instead of relying on Monaco's layout engine
            // which can misreport bounds during React render phases when container width isn't stable.
            const model = editor.getModel();
            const lineCount = model ? model.getLineCount() : 1;
            const newHeightPx = Math.max(40, lineCount * 19 + 16); // 19px per line + 16px padding

            // Sync React state for future renders
            setEditorHeight(newHeightPx);

            // Sync DOM immediately to avoid visual flicker during React render queue
            if (containerRef.current) {
                const newHeightStr = `${newHeightPx}px`;
                if (containerRef.current.style.height !== newHeightStr) {
                    containerRef.current.style.height = newHeightStr;
                    editor.layout();
                }
            }
        };

        updateHeight();
        editor.onDidContentSizeChange(updateHeight);

        // Prevent unwanted scrolling during paste/init
        editor.setScrollTop(0);
    };

    return (
        <div ref={containerRef} className="w-full bg-[#09090b] border border-white/5 rounded-xl shadow-inner overflow-hidden no-drag" style={{ minHeight: '40px', height: `${editorHeight}px` }}>
            <Editor
                height="100%"
                defaultLanguage={language}
                value={value}
                onChange={(val) => {
                    onChange(val || '');
                }}
                theme="notebook-dark"
                onMount={handleEditorDidMount}
                beforeMount={handleEditorWillMount}
                loading={<div className="h-10 flex items-center px-4 text-xs text-gray-500">Loading editor...</div>}
                options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
                    lineNumbers: 'on',
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 10,
                    lineNumbersMinChars: 3,
                    automaticLayout: true,
                    padding: { top: 8, bottom: 8 },
                    scrollbar: {
                        vertical: 'hidden',
                        horizontal: 'auto',
                        alwaysConsumeMouseWheel: false
                    },
                    readOnly: false,
                    wordWrap: 'off',
                    fixedOverflowWidgets: true,
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    renderLineHighlight: 'none',
                    contextmenu: false,
                    links: false,
                    renderWhitespace: 'none',
                    occurrencesHighlight: 'off'
                }}
            />
        </div>
    );
};

function mapJediTypeToMonacoKind(monaco: any, type: string) {
    switch (type) {
        case 'module': return monaco.languages.CompletionItemKind.Module;
        case 'class': return monaco.languages.CompletionItemKind.Class;
        case 'instance': return monaco.languages.CompletionItemKind.Variable;
        case 'function': return monaco.languages.CompletionItemKind.Function;
        case 'param': return monaco.languages.CompletionItemKind.Property;
        case 'path': return monaco.languages.CompletionItemKind.File;
        case 'keyword': return monaco.languages.CompletionItemKind.Keyword;
        case 'statement': return monaco.languages.CompletionItemKind.Variable;
        default: return monaco.languages.CompletionItemKind.Variable;
    }
}

function getWordAtOffset(code: string, offset: number) {
    const before = code.slice(0, offset);
    const match = before.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/);
    return match ? match[1] : '';
}
