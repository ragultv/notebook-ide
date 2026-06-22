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
        <div className="flex items-center bg-transparent h-full select-none overflow-x-auto no-scrollbar">
            {tabs.map(tab => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        onClick={() => onActivateTab(tab.id)}
                        className={`
              group flex items-center gap-2 px-3 h-full border-r border-[#27272a] cursor-pointer min-w-[120px] max-w-[200px] text-xs transition-colors
              ${isActive
                                ? 'bg-[#1e1e1e] text-white border-t-2 border-t-sim-red'
                                : 'bg-[#121212] text-gray-500 hover:bg-[#18181b] hover:text-gray-300 border-t-2 border-t-transparent'
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
                p-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10
                ${isActive ? 'text-gray-300' : 'text-gray-500'}
              `}
                        >
                            <X className="w-3 h-3" />
                        </button>
                        {tab.isDirty && !isActive && (
                            <div className="w-2 h-2 rounded-full bg-white/20 ml-1" />
                        )}
                        {tab.isDirty && isActive && (
                            <div className="w-2 h-2 rounded-full bg-white ml-1" />
                        )}
                    </div>
                );
            })}
        </div>
    );
};
