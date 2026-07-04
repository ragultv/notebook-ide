import React, { useRef, useEffect } from 'react';
import { Type, Bold, Italic, Code, Link as LinkIcon, Image as ImageIcon, Quote, List, ListOrdered, Minus, Sigma, Smile, MoreHorizontal, X } from 'lucide-react';

interface TextCellProps {
    content: string;
    isActive: boolean;
    onUpdate: (content: string) => void;
    onActivate: () => void;
    onDeactivate?: () => void;
}

// Helper Tool Button
const ToolBtn: React.FC<{ icon: React.ComponentType<any>; onClick: (e: any) => void; label: string }> = ({ icon: Icon, onClick, label }) => (
    <button
        onClick={(e) => { e.stopPropagation(); onClick(e); }}
        title={label}
        className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors"
    >
        <Icon className="w-4 h-4" />
    </button>
);

// Markdown Renderer
export const renderMarkdown = (text: string) => {
    if (!text) return { __html: '<span class="text-gray-600 italic">Empty markdown cell</span>' };

    let html = text
        // Basic sanitation
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")

        // Headings (no extra margin/padding)
        .replace(/^### (.*$)/gim, '<h3 class="text-xl font-bold text-sim-text/90">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold text-sim-text/95">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold text-sim-text">$1</h1>')

        // Bold / Italic
        .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-bold text-sim-text">$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em class="italic text-sim-muted">$1</em>')

        // Inline code (no padding)
        .replace(/`(.*?)`/gim,
            '<code class="bg-sim-bg border border-sim-border px-1 rounded font-mono text-[0.9em] text-sim-red">$1</code>'
        )

        // Links
        .replace(/\[(.*?)\]\((.*?)\)/gim,
            '<a href="$2" target="_blank" class="text-blue-500 hover:underline">$1</a>'
        )

        // Images (no wrapper padding)
        .replace(/!\[(.*?)\]\((.*?)\)/gim,
            '<img src="$2" alt="$1" class="max-w-full rounded-lg"/>'
        )

        // Blockquote (minimal spacing)
        .replace(/^> (.*$)/gim,
            '<blockquote class="border-l-4 border-sim-red pl-4 italic text-sim-muted">$1</blockquote>'
        )

        // Unordered list (semantic)
        .replace(/^\s*-\s+(.*$)/gim,
            '<li class="list-disc ml-6 text-sim-text">$1</li>'
        )

        // Ordered list
        .replace(/^\s*\d+\.\s+(.*$)/gim,
            '<li class="list-decimal ml-6 text-sim-text">$1</li>'
        )

        // Horizontal rule
        .replace(/^---$/gim,
            '<hr class="border-sim-border my-4"/>'
        )

        // Math
        .replace(/\$\{(.*?)\}/gim,
            '<span class="font-mono text-yellow-500">$1</span>'
        )

        // Line breaks
        .replace(/\n/g, '<br/>')
        // Cleanup line breaks after block elements to fix spacing bugs
        .replace(/<\/li><br\/>/g, '</li>')
        .replace(/<br\/><li>/g, '<li>')
        .replace(/<\/h[1-3]><br\/>/g, (m) => m.replace('<br/>', ''))
        .replace(/<blockquote(.*?)><br\/>/g, '<blockquote$1>');

    return { __html: html };
};

export const TextCell: React.FC<TextCellProps> = ({ content, isActive, onUpdate, onActivate, onDeactivate }) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current && isEditing) {
            textareaRef.current.style.height = 'auto';
            // Set min height to avoid collapse, max height if desired but we want full expansion
            textareaRef.current.style.height = Math.max(300, textareaRef.current.scrollHeight) + 'px';
        }
    }, [content, isEditing]);

    // Sync isEditing with isActive
    useEffect(() => {
        if (!isActive) {
            setIsEditing(false);
        }
    }, [isActive]);

    const handleMarkdownAction = (type: string) => {
        if (!textareaRef.current) return;
        const textarea = textareaRef.current;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);

        let replacement = '';
        let cursorOffset = 0;

        switch (type) {
            case 'bold': replacement = `**${selected || 'text'}**`; cursorOffset = selected ? 0 : -2; break;
            case 'italic': replacement = `*${selected || 'text'}*`; cursorOffset = selected ? 0 : -1; break;
            case 'code': replacement = `\`${selected || 'code'}\``; cursorOffset = selected ? 0 : -1; break;
            case 'heading': replacement = `# ${selected || 'Heading'}`; break;
            case 'link': replacement = `[${selected || 'text'}](url)`; cursorOffset = selected ? 0 : -1; break;
            case 'image': replacement = `![${selected || 'alt'}](url)`; cursorOffset = selected ? 0 : -1; break;
            case 'quote': replacement = `> ${selected || 'quote'}`; break;
            case 'list': replacement = `- ${selected || 'item'}`; break;
            case 'ordered-list': replacement = `1. ${selected || 'item'}`; break;
            case 'divider': replacement = `\n---\n`; break;
            case 'latex': replacement = `$$${selected || 'x'}$$`; cursorOffset = selected ? 0 : -2; break;
            case 'emoji': replacement = `😊`; break;
        }

        const newText = text.substring(0, start) + replacement + text.substring(end);
        onUpdate(newText);

        setTimeout(() => {
            textarea.focus();
            const newPos = start + replacement.length + cursorOffset;
            textarea.setSelectionRange(newPos, newPos);
        }, 0);
    };

    if (!isEditing) {
        return (
            <div
                onDoubleClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                onDragStart={(e) => e.stopPropagation()}
                className={`w-full p-2 pl-0 rounded-lg transition-all duration-200 cursor-text min-h-[40px] no-drag border
          ${isActive ? 'border-transparent bg-transparent' : 'border-transparent bg-transparent'}
        `}
            >
                {!content.trim() ? (
                    <div className="text-sim-muted italic opacity-55 select-none">Double-click to edit markdown...</div>
                ) : (
                    <div className="prose dark:prose-invert prose-sm max-w-none text-sim-text leading-relaxed font-sans" dangerouslySetInnerHTML={renderMarkdown(content)} />
                )}
            </div>
        );
    }

    return (
        <div
            onDragStart={(e) => e.stopPropagation()}
            className="flex flex-col border border-sim-red/30 rounded-lg overflow-hidden bg-sim-surface shadow-2xl w-full transition-all ring-1 ring-sim-red/20"
        >
            {/* Toolbar */}
            <div className="flex items-center flex-wrap gap-1 p-2 bg-sim-bg border-b border-sim-border select-none sticky top-0 z-10 transition-all text-sim-text">
                <ToolBtn icon={Type} onClick={() => handleMarkdownAction('heading')} label="Heading" />
                <ToolBtn icon={Bold} onClick={() => handleMarkdownAction('bold')} label="Bold" />
                <ToolBtn icon={Italic} onClick={() => handleMarkdownAction('italic')} label="Italic" />
                <div className="w-[1px] h-4 bg-sim-border mx-1"></div>
                <ToolBtn icon={Code} onClick={() => handleMarkdownAction('code')} label="Code" />
                <ToolBtn icon={LinkIcon} onClick={() => handleMarkdownAction('link')} label="Link" />
                <ToolBtn icon={ImageIcon} onClick={() => handleMarkdownAction('image')} label="Image" />
                <ToolBtn icon={Quote} onClick={() => handleMarkdownAction('quote')} label="Quote" />
                <div className="w-[1px] h-4 bg-sim-border mx-1"></div>
                <ToolBtn icon={List} onClick={() => handleMarkdownAction('list')} label="Unordered List" />
                <ToolBtn icon={ListOrdered} onClick={() => handleMarkdownAction('ordered-list')} label="Ordered List" />
                <ToolBtn icon={Minus} onClick={() => handleMarkdownAction('divider')} label="Divider" />
                <ToolBtn icon={Sigma} onClick={() => handleMarkdownAction('latex')} label="Latex" />
                <ToolBtn icon={Smile} onClick={() => handleMarkdownAction('emoji')} label="Emoji" />
                <div className="w-[1px] h-4 bg-sim-border mx-1"></div>
                <ToolBtn icon={MoreHorizontal} onClick={() => { }} label="More" />
                <ToolBtn icon={X} onClick={() => setIsEditing(false)} label="Close Editor" />

                <div className="flex-1"></div>
                <div className="px-3 text-[10px] font-mono text-sim-muted uppercase tracking-widest hidden sm:block opacity-50">Markdown Mode</div>
            </div>

            {/* Split View (Auto-expanding) */}
            <div className="grid grid-cols-1 md:grid-cols-2 w-full min-h-[300px] divide-y md:divide-y-0 md:divide-x divide-sim-border bg-sim-bg">
                {/* Editor Pane */}
                <div className="relative w-full h-full min-h-[inherit] no-drag">
                    <div className="absolute top-2 right-2 text-[10px] bg-sim-surface px-2 py-0.5 rounded text-sim-muted font-mono pointer-events-none z-10">MARKDOWN</div>
                    <textarea
                        ref={textareaRef}
                        value={content}
                        onChange={(e) => onUpdate(e.target.value)}
                        className="w-full h-full p-6 bg-transparent resize-none text-sim-text font-mono text-sm leading-relaxed outline-none min-h-[300px] overflow-hidden"
                        placeholder="Type markdown here..."
                        autoFocus
                    />
                </div>
                {/* Preview Pane */}
                <div className="w-full h-full p-6 min-h-[300px] bg-sim-bg no-drag">
                    <div className="prose dark:prose-invert prose-sm max-w-none text-sim-text leading-relaxed font-sans" dangerouslySetInnerHTML={renderMarkdown(content)} />
                </div>
            </div>
        </div>
    );
};
