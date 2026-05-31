/**
 * VariablePanel.tsx — P2-4: Variable Inspector Panel.
 *
 * Subscribes to `variables` WebSocket events and displays a rich table
 * showing Name | Type | Shape/Columns | Size (MB) | Value preview.
 *
 * Refresh button triggers an on-demand getVariables() call.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VariableInfo {
    name:         string;
    type:         string;
    shape?:       string;
    columns?:     string;
    size_mb?:     number;
    size_bytes?:  number;
    value?:       string;
    dtype?:       string;
    len?:         number;
}

interface VariablePanelProps {
    /** The WS hook's `on` function to subscribe to named events. */
    on?:           (type: string, handler: (msg: any) => void) => void;
    /** Call this to request a fresh variables snapshot from the kernel. */
    getVariables?: () => void;
    /** Whether the kernel is currently busy (disables Refresh). */
    kernelBusy?:  boolean;
    /** Static variables list to display (bypasses WebSocket connection) */
    variables?:   VariableInfo[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export const VariablePanel: React.FC<VariablePanelProps> = ({ on, getVariables, kernelBusy, variables: propsVariables }) => {
    const [variables, setVariables] = useState<VariableInfo[]>([]);
    const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [filter, setFilter] = useState('');

    // Subscribe to variables events from the kernel or use static list
    useEffect(() => {
        if (propsVariables) {
            setVariables(propsVariables);
            setLastRefreshed(new Date());
            setIsRefreshing(false);
            return;
        }

        if (!on || !getVariables) return;

        const handler = (msg: any) => {
            const vars = msg?.data ?? msg?.variables ?? msg ?? [];
            if (Array.isArray(vars)) {
                setVariables(vars);
                setLastRefreshed(new Date());
                setIsRefreshing(false);
            }
        };
        on('variables', handler);
        // Trigger initial fetch on mount
        getVariables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [propsVariables]);

    const handleRefresh = useCallback(() => {
        if (!getVariables) return;
        setIsRefreshing(true);
        getVariables();
        // Auto-clear refreshing state after 3s in case kernel doesn't respond
        setTimeout(() => setIsRefreshing(false), 3000);
    }, [getVariables]);

    const filtered = filter.trim()
        ? variables.filter(v => v.name.toLowerCase().includes(filter.toLowerCase()))
        : variables;

    return (
        <div style={styles.panel}>
            {/* Header */}
            <div style={styles.header}>
                <span style={styles.title}>Variable Inspector</span>
                <div style={styles.headerRight}>
                    {lastRefreshed && (
                        <span style={styles.timestamp}>
                            {lastRefreshed.toLocaleTimeString()}
                        </span>
                    )}
                    {getVariables && (
                        <button
                            id="variable-panel-refresh"
                            style={{
                                ...styles.refreshBtn,
                                opacity: (kernelBusy || isRefreshing) ? 0.5 : 1,
                                cursor:  (kernelBusy || isRefreshing) ? 'not-allowed' : 'pointer',
                            }}
                            onClick={handleRefresh}
                            disabled={kernelBusy || isRefreshing}
                            title="Refresh variables"
                        >
                            {isRefreshing ? '⟳' : '↻'} Refresh
                        </button>
                    )}
                </div>
            </div>

            {/* Filter */}
            <div style={styles.filterRow}>
                <input
                    id="variable-panel-filter"
                    type="text"
                    placeholder="Filter variables..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    style={styles.filterInput}
                />
                {filter && (
                    <button style={styles.clearBtn} onClick={() => setFilter('')}>✕</button>
                )}
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
                <div style={styles.empty}>
                    {variables.length === 0
                        ? 'No variables yet. Run a cell to populate.'
                        : 'No variables match the filter.'}
                </div>
            ) : (
                <div style={styles.tableWrap}>
                    <table style={styles.table}>
                        <thead>
                            <tr style={styles.thead}>
                                <th style={styles.th}>Name</th>
                                <th style={styles.th}>Type</th>
                                <th style={styles.th}>Shape / Len</th>
                                <th style={styles.th}>Size</th>
                                <th style={styles.th}>Value Preview</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((v, i) => (
                                <tr key={v.name} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                                    <td style={{ ...styles.td, ...styles.nameCell }}>{v.name}</td>
                                    <td style={{ ...styles.td, ...styles.typeCell }}>{v.type}</td>
                                    <td style={styles.td}>{formatShape(v)}</td>
                                    <td style={styles.td}>{formatSize(v)}</td>
                                    <td style={{ ...styles.td, ...styles.valueCell }} title={v.value}>
                                        {v.value ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatShape(v: VariableInfo): string {
    if (v.shape) return v.shape;
    if (v.columns) return v.columns;
    if (v.len !== undefined) return `len=${v.len}`;
    return '—';
}

function formatSize(v: VariableInfo): string {
    if (v.size_mb !== undefined && v.size_mb > 0) {
        return v.size_mb < 1 ? `${(v.size_mb * 1024).toFixed(0)} KB` : `${v.size_mb.toFixed(2)} MB`;
    }
    if (v.size_bytes !== undefined && v.size_bytes > 0) {
        if (v.size_bytes < 1024) return `${v.size_bytes} B`;
        if (v.size_bytes < 1024 * 1024) return `${(v.size_bytes / 1024).toFixed(1)} KB`;
        return `${(v.size_bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return '—';
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
    panel: {
        display:         'flex',
        flexDirection:   'column',
        height:          '100%',
        background:      '#1a1b26',
        color:           '#c0caf5',
        fontFamily:      "'JetBrains Mono', 'Fira Code', monospace",
        fontSize:        '12px',
        overflow:        'hidden',
    },
    header: {
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        padding:         '10px 14px',
        background:      '#1f2335',
        borderBottom:    '1px solid #2a2e4a',
        flexShrink:      0,
    },
    title: {
        fontWeight:      700,
        fontSize:        '12px',
        color:           '#7aa2f7',
        letterSpacing:   '0.05em',
        textTransform:   'uppercase',
    },
    headerRight: {
        display:         'flex',
        alignItems:      'center',
        gap:             '10px',
    },
    timestamp: {
        color:           '#565f89',
        fontSize:        '11px',
    },
    refreshBtn: {
        background:      'linear-gradient(135deg, #7aa2f7, #6272a4)',
        border:          'none',
        borderRadius:    '5px',
        color:           '#fff',
        cursor:          'pointer',
        fontSize:        '11px',
        fontWeight:      600,
        padding:         '4px 10px',
        transition:      'all 0.2s ease',
    },
    filterRow: {
        display:         'flex',
        alignItems:      'center',
        gap:             '6px',
        padding:         '8px 14px',
        background:      '#1a1b26',
        borderBottom:    '1px solid #2a2e4a',
        flexShrink:      0,
    },
    filterInput: {
        flex:            1,
        background:      '#1f2335',
        border:          '1px solid #2a2e4a',
        borderRadius:    '5px',
        color:           '#c0caf5',
        fontSize:        '12px',
        padding:         '5px 10px',
        outline:         'none',
    },
    clearBtn: {
        background:      'transparent',
        border:          'none',
        color:           '#565f89',
        cursor:          'pointer',
        fontSize:        '13px',
        padding:         '0 4px',
    },
    tableWrap: {
        flex:            1,
        overflowY:       'auto',
        overflowX:       'auto',
    },
    table: {
        width:           '100%',
        borderCollapse:  'collapse',
        tableLayout:     'fixed',
    },
    thead: {
        position:        'sticky',
        top:             0,
        background:      '#1f2335',
        zIndex:          1,
    },
    th: {
        padding:         '7px 12px',
        textAlign:       'left',
        color:           '#7aa2f7',
        fontSize:        '11px',
        fontWeight:      600,
        textTransform:   'uppercase',
        letterSpacing:   '0.06em',
        borderBottom:    '1px solid #2a2e4a',
        whiteSpace:      'nowrap',
    },
    td: {
        padding:         '6px 12px',
        verticalAlign:   'middle',
        borderBottom:    '1px solid #1a1b26',
    },
    trEven: { background: '#1a1b26' },
    trOdd:  { background: '#1e2030' },
    nameCell: {
        color:           '#9ece6a',
        fontWeight:      600,
        whiteSpace:      'nowrap',
    },
    typeCell: {
        color:           '#e0af68',
        fontStyle:       'italic',
        whiteSpace:      'nowrap',
    },
    valueCell: {
        maxWidth:        '220px',
        overflow:        'hidden',
        textOverflow:    'ellipsis',
        whiteSpace:      'nowrap',
        color:           '#c0caf5',
    },
    empty: {
        padding:         '32px 16px',
        textAlign:       'center',
        color:           '#565f89',
        lineHeight:      1.6,
    },
};

export default VariablePanel;
