import React from 'react';
import { X, Settings } from 'lucide-react';
import { Tab } from '../types';
import { getFileIcon } from './shared/FileIcons';

export interface TabBarProps {
    tabs: Tab[];
    activeTabId: string | null;
    onActivateTab: (id: string) => void;
    onCloseTab: (id: string, e: React.MouseEvent) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, onActivateTab, onCloseTab }) => {
    const getIcon = (tab: Tab) => {
        if (tab.type === 'settings') return <Settings className="w-3.5 h-3.5 text-gray-400" />;
        const extension = tab.title.includes('.') ? tab.title.substring(tab.title.lastIndexOf('.')) : undefined;
        return getFileIcon(extension, "w-3.5 h-3.5");
    };

    return (
        <div className="flex items-center gap-1 bg-transparent h-full select-none overflow-x-auto no-scrollbar px-1">
            {tabs.map(tab => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        onClick={() => onActivateTab(tab.id)}
                        className={`
                            group relative flex items-center gap-2 px-3 py-1.5 my-0.5 rounded-lg cursor-pointer min-w-[110px] max-w-[200px] text-xs transition-all
                            ${isActive
                                ? 'bg-white/10 dark:bg-zinc-800/80 text-sim-text font-medium shadow-sm border border-white/10'
                                : 'bg-transparent text-sim-muted hover:bg-white/5 dark:hover:bg-zinc-800/40 hover:text-sim-text border border-transparent'
                            }
                        `}
                    >
                        <span className="flex-shrink-0 opacity-80">{getIcon(tab)}</span>
                        <span className="truncate flex-1 font-mono">{tab.title}</span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onCloseTab(tab.id, e);
                            }}
                            className={`
                                p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10
                                ${isActive ? 'text-sim-text' : 'text-sim-muted'}
                            `}
                        >
                            <X className="w-3 h-3" />
                        </button>
                        {tab.isDirty && !isActive && (
                            <div className="w-1.5 h-1.5 rounded-full bg-sim-muted ml-1 opacity-50" />
                        )}
                        {tab.isDirty && isActive && (
                            <div className="w-1.5 h-1.5 rounded-full bg-red-400 ml-1" />
                        )}
                    </div>
                );
            })}
        </div>
    );
};
