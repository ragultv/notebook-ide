/**
 * AnsiRenderer.tsx
 *
 * Renders ANSI escape sequences as colored React spans.
 * VS Code equivalent: webviewPreloads.ts createOutputItem() + ansi rendering in cell output
 *
 * Supported codes:
 *   \x1b[0m       — reset
 *   \x1b[1m       — bold
 *   \x1b[3m       — italic
 *   \x1b[4m       — underline
 *   \x1b[30-37m   — standard fg colors
 *   \x1b[90-97m   — bright fg colors
 *   \x1b[40-47m   — standard bg colors
 *   \x1b[38;5;Nm  — 256-color fg
 *   \x1b[48;5;Nm  — 256-color bg
 *   \x1b[38;2;R;G;Bm — truecolor fg
 *   \x1b[48;2;R;G;Bm — truecolor bg
 */

import React from 'react';

// ── Color tables ──────────────────────────────────────────────────────────────

const ANSI_FG: Record<number, string> = {
    30: '#4d4d4d', 31: '#cc0000', 32: '#4e9a06', 33: '#c4a000',
    34: '#3465a4', 35: '#75507b', 36: '#06989a', 37: '#d3d7cf',
    90: '#888a85', 91: '#ef2929', 92: '#8ae234', 93: '#fce94f',
    94: '#729fcf', 95: '#ad7fa8', 96: '#34e2e2', 97: '#eeeeec',
};

const ANSI_BG: Record<number, string> = {
    40: '#4d4d4d', 41: '#cc0000', 42: '#4e9a06', 43: '#c4a000',
    44: '#3465a4', 45: '#75507b', 46: '#06989a', 47: '#d3d7cf',
    100: '#888a85', 101: '#ef2929', 102: '#8ae234', 103: '#fce94f',
    104: '#729fcf', 105: '#ad7fa8', 106: '#34e2e2', 107: '#eeeeec',
};

// Standard 6×6×6 color cube for 256-color mode (indices 16–231)
function colorCube(idx: number): string {
    const i = idx - 16;
    const b = i % 6, g = Math.floor(i / 6) % 6, r = Math.floor(i / 36);
    const c = (v: number) => v === 0 ? 0 : 55 + v * 40;
    return `rgb(${c(r)},${c(g)},${c(b)})`;
}

// Grayscale ramp (indices 232–255)
function grayscale(idx: number): string {
    const v = 8 + (idx - 232) * 10;
    return `rgb(${v},${v},${v})`;
}

function resolve256(idx: number): string {
    if (idx < 8) return ANSI_FG[30 + idx] ?? '#fff';
    if (idx < 16) return ANSI_FG[90 + (idx - 8)] ?? '#fff';
    if (idx < 232) return colorCube(idx);
    return grayscale(idx);
}

// ── Span type ────────────────────────────────────────────────────────────────

interface AnsiSpan {
    text: string;
    color?: string;
    bg?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
}

interface AnsiState {
    color?: string;
    bg?: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

// ── Parser ────────────────────────────────────────────────────────────────────

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

export function parseAnsi(text: string): AnsiSpan[] {
    const spans: AnsiSpan[] = [];
    let state: AnsiState = { bold: false, italic: false, underline: false };
    let lastIndex = 0;

    for (const match of text.matchAll(ANSI_RE)) {
        // Text before this escape
        if (match.index! > lastIndex) {
            spans.push({ ...state, text: text.slice(lastIndex, match.index) });
        }

        const codes = match[1].split(';').map(Number);
        let i = 0;
        while (i < codes.length) {
            const code = codes[i];
            if (code === 0) {
                state = { bold: false, italic: false, underline: false };
            } else if (code === 1) {
                state = { ...state, bold: true };
            } else if (code === 3) {
                state = { ...state, italic: true };
            } else if (code === 4) {
                state = { ...state, underline: true };
            } else if (code === 22) {
                state = { ...state, bold: false };
            } else if (code === 23) {
                state = { ...state, italic: false };
            } else if (code === 24) {
                state = { ...state, underline: false };
            } else if (code >= 30 && code <= 37) {
                state = { ...state, color: ANSI_FG[code] };
            } else if (code === 39) {
                const { color: _c, ...rest } = state;
                state = { ...rest };
            } else if (code >= 40 && code <= 47) {
                state = { ...state, bg: ANSI_BG[code] };
            } else if (code === 49) {
                const { bg: _b, ...rest } = state;
                state = { ...rest };
            } else if (code >= 90 && code <= 97) {
                state = { ...state, color: ANSI_FG[code] };
            } else if (code >= 100 && code <= 107) {
                state = { ...state, bg: ANSI_BG[code] };
            } else if (code === 38 && codes[i + 1] === 5) {
                state = { ...state, color: resolve256(codes[i + 2] ?? 0) };
                i += 2;
            } else if (code === 38 && codes[i + 1] === 2) {
                state = { ...state, color: `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})` };
                i += 4;
            } else if (code === 48 && codes[i + 1] === 5) {
                state = { ...state, bg: resolve256(codes[i + 2] ?? 0) };
                i += 2;
            } else if (code === 48 && codes[i + 1] === 2) {
                state = { ...state, bg: `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})` };
                i += 4;
            }
            i++;
        }

        lastIndex = match.index! + match[0].length;
    }

    // Remaining text
    if (lastIndex < text.length) {
        spans.push({ ...state, text: text.slice(lastIndex) });
    }

    return spans;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AnsiRendererProps {
    text: string;
    className?: string;
    /** Base text color override (e.g. 'text-yellow-300' for stderr) */
    defaultColor?: string;
}

export const AnsiRenderer: React.FC<AnsiRendererProps> = React.memo(({ text, className, defaultColor }) => {
    const spans = parseAnsi(text);

    return (
        <span className={className}>
            {spans.map((span, i) => {
                const style: React.CSSProperties = {};
                if (span.color) style.color = span.color;
                else if (defaultColor) style.color = defaultColor;
                if (span.bg) style.backgroundColor = span.bg;
                if (span.bold) style.fontWeight = 'bold';
                if (span.italic) style.fontStyle = 'italic';
                if (span.underline) style.textDecoration = 'underline';

                return (
                    <span key={i} style={Object.keys(style).length > 0 ? style : undefined}>
                        {span.text}
                    </span>
                );
            })}
        </span>
    );
});

AnsiRenderer.displayName = 'AnsiRenderer';

/** Strip ANSI codes — kept for backward compat, prefer AnsiRenderer */
export function stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
