/**
 * Shared centered modal dialog component and hook.
 * Used in place of window.prompt / window.alert / window.confirm
 * throughout the app — works in both browser (web) and Electron.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DialogField {
    id: string;
    label: string;
    placeholder?: string;
    defaultValue?: string;
    type?: 'text' | 'password';
}

interface ModalDialogProps {
    title: string;
    description?: string;
    fields: DialogField[];
    confirmLabel?: string;
    danger?: boolean;            // Red confirm button for destructive actions
    onConfirm: (values: Record<string, string>) => void;
    onCancel: () => void;
}

// ── ModalDialog component ─────────────────────────────────────────────────────

export const ModalDialog: React.FC<ModalDialogProps> = ({
    title, description, fields, confirmLabel = 'Confirm', danger = false,
    onConfirm, onCancel,
}) => {
    const [values, setValues] = useState<Record<string, string>>(
        Object.fromEntries(fields.map(f => [f.id, f.defaultValue ?? '']))
    );
    const firstInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const t = setTimeout(() => firstInputRef.current?.focus(), 10);
        return () => clearTimeout(t);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
        if (e.key === 'Enter' && fields.length > 0) { e.stopPropagation(); onConfirm(values); }
    };

    return (
        // Backdrop
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
        >
            {/* Panel */}
            <div
                className="bg-[#18181b] border border-[#3a3a3c] rounded-2xl shadow-2xl shadow-black/80 w-full max-w-md mx-4 overflow-hidden"
                style={{ animation: 'dropdownIn 0.15s ease-out' }}
                onKeyDown={handleKeyDown}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                    <div>
                        <h2 className="text-sm font-semibold text-white">{title}</h2>
                        {description && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>}
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Fields */}
                {fields.length > 0 && (
                    <div className="px-5 pb-3 space-y-3">
                        {fields.map((field, idx) => (
                            <div key={field.id}>
                                <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
                                <input
                                    ref={idx === 0 ? firstInputRef : undefined}
                                    type={field.type ?? 'text'}
                                    value={values[field.id]}
                                    placeholder={field.placeholder}
                                    onChange={e => setValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                                    className="w-full bg-[#27272a] border border-[#3a3a3c] focus:border-sim-red/60
                    rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600
                    outline-none transition-colors font-mono"
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[#09090b]/50 border-t border-[#27272a]">
                    <button
                        onClick={onCancel}
                        className="px-4 py-1.5 text-xs text-gray-400 hover:text-white bg-[#27272a] hover:bg-[#3a3a3c] rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(values)}
                        className={`px-4 py-1.5 text-xs text-white rounded-lg transition-colors font-medium
              ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-sim-red hover:bg-sim-red/90'}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── useCenterDialog hook ──────────────────────────────────────────────────────

type DialogConfig = Omit<ModalDialogProps, 'onConfirm' | 'onCancel'>;

export interface CenterDialogHook {
    show: (cfg: DialogConfig) => Promise<Record<string, string> | null>;
    /** Renders the dialog; mount this somewhere in your component tree */
    Dialog: React.ReactElement | null;
}

export function useCenterDialog(): CenterDialogHook {
    const [config, setConfig] = useState<DialogConfig | null>(null);
    const resolverRef = useRef<((v: Record<string, string> | null) => void) | null>(null);

    const show = useCallback((cfg: DialogConfig): Promise<Record<string, string> | null> => {
        return new Promise(resolve => {
            resolverRef.current = resolve;
            setConfig(cfg);
        });
    }, []);

    const Dialog = config ? (
        <ModalDialog
            {...config}
            onConfirm={values => {
                setConfig(null);
                resolverRef.current?.(values);
            }}
            onCancel={() => {
                setConfig(null);
                resolverRef.current?.(null);
            }}
        />
    ) : null;

    return { show, Dialog };
}
