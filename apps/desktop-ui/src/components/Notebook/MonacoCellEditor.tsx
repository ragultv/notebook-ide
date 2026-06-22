import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import Editor, { useMonaco } from "@monaco-editor/react";
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

// Line height Monaco uses at fontSize 13 with padding 8+8
const LINE_HEIGHT = 19;
const PADDING_V = 16; // top 8 + bottom 8
const MIN_HEIGHT = 38; // single blank line

/** Compute pixel height for N logical lines (before word-wrap reflow). */
function calcHeight(lineCount: number): number {
    return Math.max(MIN_HEIGHT, lineCount * LINE_HEIGHT + PADDING_V);
}

export const MonacoCellEditor: React.FC<MonacoCellEditorProps> = React.memo(function MonacoCellEditor({
    value,
    onChange,
    onRun,
    onActivate,
    notebookId,
    isActive,
    language = 'python',
    allCells = [],
    cellIndex = 0
}) {
    // Stabilize callbacks via refs — prevents editor remount when parent re-renders
    // (mirrors VS Code's use of stable model/controller refs in CodeEditorWidget)
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onRunRef = useRef(onRun);
    onRunRef.current = onRun;
    const onActivateRef = useRef(onActivate);
    onActivateRef.current = onActivate;
    const monaco = useMonaco();
    const editorRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // ── Theme ──────────────────────────────────────────────────────────────────
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

    // ── Height sync ────────────────────────────────────────────────────────────
    /**
     * The only correct way to auto-size Monaco is:
     *   1. Read editor.getContentHeight() — the authoritative measure post-wrap.
     *   2. Set container height to that value.
     *   3. Call editor.layout() so Monaco knows the new container size.
     *
     * We run this inside requestAnimationFrame to let the DOM flush first,
     * and guard against infinite loops by comparing the last set height.
     */
    const lastHeightRef = useRef<number>(0);
    const rafRef = useRef<number | null>(null);

    const syncHeight = useCallback(() => {
        const editor = editorRef.current;
        const container = containerRef.current;
        if (!editor || !container) return;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            // Guard against unmounted/disposed editors
            if (!mountedRef.current || !editor || editor._isDisposed || !container || !document.body.contains(container)) return;
            try {
                const contentHeight = Math.max(MIN_HEIGHT, editor.getContentHeight());
                if (contentHeight !== lastHeightRef.current) {
                    lastHeightRef.current = contentHeight;
                    container.style.height = `${contentHeight}px`;
                    // Force Monaco to re-layout within the new container dimensions
                    if (container.offsetWidth > 0) {
                        editor.layout({ width: container.offsetWidth, height: contentHeight });
                    } else {
                        editor.layout();
                    }
                }
            } catch (err) {
                // Ignore layout errors on unmounted editors
            }
        });
    }, []);

    // Clean up pending RAFs on unmount
    useEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, []);

    // ── Handle container resizing (e.g. tab unhidden) ──────────────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (let entry of entries) {
                if (entry.contentRect.width > 0 && mountedRef.current && editorRef.current && !editorRef.current._isDisposed) {
                    editorRef.current.layout();
                }
            }
        });

        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, []);

    // ── Focus ──────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (isActive && editorRef.current) {
            editorRef.current.focus();
        }
    }, [isActive]);

    // ── Completions ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!monaco) return;

        const provider = monaco.languages.registerCompletionItemProvider('python', {
            provideCompletionItems: async (model: any, position: any) => {
                const code = model.getValue();
                const offset = model.getOffsetAt(position);
                const contextCode = allCells
                    .slice(0, cellIndex)
                    .map((c: CellData) => c.content)
                    .join('\n');

                try {
                    const { completions } = await controllerClient.getCompletions({
                        code, cursorPos: offset, notebookId, contextCode
                    });

                    const word = model.getWordUntilPosition(position);
                    const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn,
                    };

                    return {
                        suggestions: completions
                            .filter((c: any) => c && typeof c.name === 'string' && c.name.length > 0)
                            .map((c: any) => ({
                                label: c.name,
                                kind: mapJediTypeToMonacoKind(monaco, c.type),
                                insertText: c.name,
                                detail: c.description ?? '',
                                documentation: c.docstring ?? '',
                                range,
                            }))
                    };
                } catch {
                    return { suggestions: [] };
                }
            },
            triggerCharacters: ['.']
        });

        return () => provider.dispose();
    }, [monaco, notebookId, allCells, cellIndex]);

    // ── Mount / Unmount guards ─────────────────────────────────────────────────
    const mountedRef = useRef(true);
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // ── Mount ──────────────────────────────────────────────────────────────────
    const handleEditorDidMount = (editor: any, monaco: any) => {
        editorRef.current = editor;

        editor.onDidFocusEditorText(() => {
            if (onActivateRef.current) onActivateRef.current();
        });

        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
            onRunRef.current();
        });

        if (isActive) {
            editor.focus();
            setTimeout(() => {
                // The editor might have been destroyed while waiting for this timeout (e.g., cell was moved)
                if (mountedRef.current && !editor._isDisposed) {
                    try { editor.focus(); } catch (e) { }
                }
            }, 10);
        }

        // Sync height on every content-size change (new lines, word-wrap reflow, etc.)
        editor.onDidContentSizeChange(() => {
            if (mountedRef.current && !editor._isDisposed) syncHeight();
        });

        // Also sync on model content change — this catches paste events where Monaco
        // may defer content-size computation past the next animation frame. A double
        // RAF guarantees Monaco has finished re-flowing the pasted content before we
        // read getContentHeight(), preventing the "2-line flash then expand" bug.
        editor.onDidChangeModelContent(() => {
            if (!mountedRef.current || editor._isDisposed) return;
            requestAnimationFrame(() => {
                if (mountedRef.current && !editor._isDisposed) {
                    requestAnimationFrame(() => {
                        if (mountedRef.current && !editor._isDisposed) syncHeight();
                    });
                }
            });
        });

        // Initial sync after the editor has finished its first layout pass
        // Two frames: first for Monaco's own init, second for our container resize.
        requestAnimationFrame(() => {
            if (mountedRef.current) {
                requestAnimationFrame(() => {
                    if (mountedRef.current && !editor._isDisposed) syncHeight();
                });
            }
        });
    };

    // ── Render ─────────────────────────────────────────────────────────────────
    // Initial height = line count × line-height. This prevents a jarring jump
    // from 38 px to full height before onDidContentSizeChange fires.
    const initialHeight = calcHeight(value.split('\n').length);

    return (
        <div
            ref={containerRef}
            className="w-full bg-[#09090b] border border-white/5 rounded-xl shadow-inner overflow-hidden no-drag"
            style={{ height: `${initialHeight}px` }}
        >
            <Editor
                height="100%"
                defaultLanguage={language}
                value={value}
                onChange={(val) => onChangeRef.current(val || '')}
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
                    // ↓ Must be FALSE — true makes Monaco fight our manual layout calls
                    automaticLayout: false,
                    padding: { top: 8, bottom: 8 },
                    scrollbar: {
                        vertical: 'hidden',
                        horizontal: 'hidden',
                        alwaysConsumeMouseWheel: false,
                        handleMouseWheel: false,
                    },
                    wordWrap: 'on',
                    fixedOverflowWidgets: true,
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    renderLineHighlight: 'none',
                    contextmenu: false,
                    links: false,
                    renderWhitespace: 'none',
                    occurrencesHighlight: 'off',
                }}
            />
        </div>
    );
}, (prev, next) => {
    // Only re-render when the cell content, active state, or notebook changes.
    // Completion provider changes (allCells, cellIndex) should NOT remount Monaco.
    return (
        prev.value === next.value &&
        prev.isActive === next.isActive &&
        prev.notebookId === next.notebookId &&
        prev.language === next.language
    );
});

MonacoCellEditor.displayName = 'MonacoCellEditor';

// ── Helpers ────────────────────────────────────────────────────────────────────

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
