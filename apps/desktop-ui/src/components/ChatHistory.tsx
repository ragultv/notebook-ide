// Chat History Component - Manual Code Design style
import React, { useState, useEffect } from 'react';
import { X, Search, MessageSquare, Clock, FileText, User, Bot, Loader2, Play, Check } from 'lucide-react';
import { controllerClient } from '../services/controller.client';
import { CellData } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface ChatSession {
  id: string;
  notebook_name: string | null;
  created_at: number;
  last_activity_at: number;
  messageCount: number;
}

interface ChatMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  token_estimate: number | null;
  created_at: number;
}

interface ChatHistoryProps {
  isOpen?: boolean;
  onClose?: () => void;
  onCreateNotebook?: (initialCells?: CellData[]) => string | null; // Returns the new notebook ID, accepts initial cells
  onSwitchToNotebook?: (notebookId: string) => void;
  updateNotebookCells?: (notebookId: string, cells: CellData[] | ((prev: CellData[]) => CellData[])) => void;
  getNotebookId?: () => string | null;
  getNotebookCells?: (notebookId: string) => CellData[] | undefined;
  files?: Array<{ id: string; cells?: CellData[] }>; // Pass files array directly for immediate access
}

export const ChatHistory: React.FC<ChatHistoryProps> = ({
  onCreateNotebook,
  onSwitchToNotebook,
  updateNotebookCells,
  getNotebookId,
  getNotebookCells,
  files,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedOperations, setAppliedOperations] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadMessages(selectedSessionId);
    } else {
      setMessages([]);
    }
  }, [selectedSessionId]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const data = await controllerClient.getChatSessions();
      setSessions(data.sessions);
      if (data.sessions.length > 0 && !selectedSessionId) {
        setSelectedSessionId(data.sessions[0].id);
      }
    } catch (error) {
      console.error('Failed to load chat sessions', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (sessionId: string) => {
    setLoadingMessages(true);
    try {
      const data = await controllerClient.getChatMessages(sessionId);
      setMessages(data.messages);
    } catch (error) {
      console.error('Failed to load messages', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const filteredSessions = sessions.filter(session => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      session.id.toLowerCase().includes(query) ||
      (session.notebook_name && session.notebook_name.toLowerCase().includes(query))
    );
  });

  const selectedSession = sessions.find(s => s.id === selectedSessionId);

  // Extract operations from message content
  const extractOperations = (content: string): Array<{ type: string; params: Record<string, any> }> | null => {
    // Try to find operations in code blocks
    const codeBlockMatch = content.match(/```(?:json|operations)?\s*\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // Not valid JSON
      }
    }

    // Try inline operations format
    const inlineMatch = content.match(/"operations"\s*:\s*(\[[\s\S]*?\])/);
    if (inlineMatch) {
      try {
        const parsed = JSON.parse(inlineMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // Not valid JSON
      }
    }

    // Try unquoted operations format
    const unquotedMatch = content.match(/operations"\s*:\s*(\[[\s\S]*?\])/);
    if (unquotedMatch) {
      try {
        const parsed = JSON.parse(unquotedMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // Not valid JSON
      }
    }

    return null;
  };

  // Strip system context from user messages
  const cleanUserMessage = (content: string): string => {
    // Remove system context blocks
    let cleaned = content;

    // Remove === SYSTEM CONTEXT === blocks
    cleaned = cleaned.replace(/=== SYSTEM CONTEXT ===[\s\S]*?=== END CONTEXT ===/g, '').trim();

    // Remove USER QUERY: prefix if present
    cleaned = cleaned.replace(/^USER QUERY:\s*/i, '').trim();

    // If message starts with "Notebook:" or contains "Current cells:", it's likely context
    if (cleaned.includes('Notebook:') && cleaned.includes('Current cells:')) {
      // Extract just the query part after the context
      const queryMatch = cleaned.match(/USER QUERY:\s*(.+)$/i);
      if (queryMatch) {
        return queryMatch[1].trim();
      }
      // If no explicit USER QUERY, return empty or a placeholder
      return cleaned.split('USER QUERY:').pop()?.trim() || cleaned;
    }

    return cleaned;
  };

  // Strip operations blocks from assistant messages for display
  const stripOperationsForDisplay = (content: string): string => {
    let cleaned = content;
    // Remove code blocks with operations
    cleaned = cleaned.replace(/```(?:json|operations)?\s*\n[\s\S]*?\n```/g, '');
    // Remove inline operations
    cleaned = cleaned.replace(/"operations"\s*:\s*\[[\s\S]*?\]/g, '');
    cleaned = cleaned.replace(/operations"\s*:\s*\[[\s\S]*?\]/g, '');
    // Clean up extra whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
  };

  // Apply operations to a new notebook
  const handleApplyOperations = async (messageId: number, operations: Array<{ type: string; params: Record<string, any> }>) => {
    if (!onCreateNotebook || !onSwitchToNotebook || !updateNotebookCells || !getNotebookCells) {
      alert('Notebook operations are not available.');
      return;
    }

    try {
      console.log('[ChatHistory] Starting to apply operations:', operations.length);

      // Process operations first to build the cells array
      const newCells: Array<{ id: string; type: 'code' | 'markdown'; content: string; status: 'idle' }> = [];

      // Process operations in order to build the cells array
      for (const op of operations) {
        try {
          switch (op.type) {
            case 'add_cell': {
              const cellType = (op.params.type === 'markdown' ? 'markdown' : 'code') as 'code' | 'markdown';
              const content = (op.params.content || '').replace(/\\n/g, '\n');
              newCells.push({
                id: crypto.randomUUID(),
                type: cellType,
                content,
                status: 'idle',
              });
              console.log('[ChatHistory] Added cell:', cellType, content.slice(0, 50));
              break;
            }
            case 'edit_cell': {
              const editType = (op.params.type === 'markdown' ? 'markdown' : 'code') as 'code' | 'markdown' | undefined;
              const content = (op.params.content || '').replace(/\\n/g, '\n');
              const index = op.params.cellIndex;

              // Ensure we have enough cells
              while (newCells.length <= index) {
                newCells.push({
                  id: crypto.randomUUID(),
                  type: 'code',
                  content: '',
                  status: 'idle',
                });
              }

              newCells[index] = {
                ...newCells[index],
                content,
                ...(editType && { type: editType }),
              };
              console.log('[ChatHistory] Edited cell at index:', index);
              break;
            }
            case 'delete_cell': {
              const index = op.params.cellIndex;
              if (index >= 0 && index < newCells.length) {
                newCells.splice(index, 1);
                console.log('[ChatHistory] Deleted cell at index:', index);
              }
              break;
            }
            case 'move_cell': {
              const fromIndex = op.params.fromIndex;
              const toIndex = op.params.toIndex;
              if (fromIndex >= 0 && fromIndex < newCells.length && toIndex >= 0 && toIndex <= newCells.length) {
                const [movedCell] = newCells.splice(fromIndex, 1);
                newCells.splice(toIndex, 0, movedCell);
                console.log('[ChatHistory] Moved cell from', fromIndex, 'to', toIndex);
              }
              break;
            }
          }
        } catch (err) {
          console.error(`[ChatHistory] Error processing operation ${op.type}:`, err);
        }
      }

      if (newCells.length === 0) {
        console.log('[ChatHistory] No cells to apply - operations array was empty');
        alert('No cells to apply from the selected operations.');
        return;
      }

      console.log('[ChatHistory] Processed', newCells.length, 'cells from operations');
      console.log('[ChatHistory] First cell preview:', newCells[0]?.content?.slice(0, 100));

      // Create a new notebook with the cells already set (avoids timing issues)
      const newNotebookId = onCreateNotebook(newCells);

      if (!newNotebookId) {
        alert('Failed to create new notebook.');
        return;
      }

      console.log('[ChatHistory] Created new notebook with cells:', newNotebookId);

      // Switch to the new notebook tab
      if (onSwitchToNotebook) {
        onSwitchToNotebook(newNotebookId);
        // Wait for the switch to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setAppliedOperations(prev => new Set(prev).add(messageId));
      console.log('[ChatHistory] Operations applied successfully');
    } catch (err) {
      console.error('[ChatHistory] Error creating notebook and applying operations:', err);
      alert('Failed to create notebook and apply operations. Please try again.');
    }
  };

  return (
    <div className="w-full h-full bg-sim-bg flex flex-col overflow-hidden font-mono text-sm">
      <div className="w-full h-full flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="h-12 border-b border-sim-border flex items-center px-4 gap-3 bg-sim-bg shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-sim-muted" />
            <span className="text-xs font-medium text-sim-text">Chat History</span>
          </div>
          <div className="w-[1px] h-6 bg-sim-border mx-1" />
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sim-muted" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-sim-surface border border-sim-border rounded-md px-8 py-1.5 text-xs text-sim-text focus:outline-none focus:border-sim-muted transition-colors placeholder-gray-600"
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sessions List */}
          <div className="w-64 border-r border-sim-border bg-sim-surface overflow-y-auto custom-scrollbar shrink-0">
            {loading ? (
              <div className="flex items-center justify-center h-full text-sim-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-sim-muted gap-2 p-4">
                <MessageSquare className="w-8 h-8 opacity-20" />
                <p className="text-xs text-center">No chat sessions found</p>
              </div>
            ) : (
              <div className="p-2">
                {filteredSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setSelectedSessionId(session.id)}
                    className={`w-full text-left p-3 rounded-md mb-2 transition-colors ${selectedSessionId === session.id
                        ? 'bg-sim-selection text-white'
                        : 'bg-sim-bg hover:bg-white/5 text-sim-text'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {session.notebook_name || 'Untitled Notebook'}
                        </div>
                        <div className="text-[10px] text-sim-muted mt-0.5 truncate font-mono">
                          {session.id.slice(0, 8)}...
                        </div>
                      </div>
                      <div className="text-[10px] text-sim-muted shrink-0">
                        {session.messageCount}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-sim-muted mt-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(session.last_activity_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Messages View */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedSessionId ? (
              <>
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-full text-sim-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-sim-muted gap-2">
                    <MessageSquare className="w-8 h-8 opacity-20" />
                    <p className="text-xs">No messages in this session</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                    <div className="max-w-4xl mx-auto space-y-4">
                      {messages.map((message) => {
                        const cleanedUserContent = message.role === 'user' ? cleanUserMessage(message.content) : null;
                        const displayContent = message.role === 'assistant' ? stripOperationsForDisplay(message.content) : cleanedUserContent || message.content;
                        const operations = message.role === 'assistant' ? extractOperations(message.content) : null;
                        const hasOperations = operations && operations.length > 0;
                        const isApplied = appliedOperations.has(message.id);

                        return (
                          <div
                            key={message.id}
                            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'
                              }`}
                          >
                            <div
                              className={`max-w-[80%] rounded-lg p-3 ${message.role === 'user'
                                  ? 'bg-sim-selection text-white'
                                  : 'bg-sim-surface border border-sim-border text-sim-text'
                                }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                {message.role === 'user' ? (
                                  <User className="w-3 h-3" />
                                ) : (
                                  <Bot className="w-3 h-3" />
                                )}
                                <span className="text-[10px] font-medium uppercase">
                                  {message.role === 'user' ? 'You' : 'Assistant'}
                                </span>
                                <span className="text-[10px] text-sim-muted ml-auto">
                                  {formatDate(message.created_at)}
                                </span>
                              </div>
                              <div className="text-xs prose prose-invert max-w-none">
                                {message.role === 'assistant' ? (
                                  <>
                                    {displayContent && (
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeHighlight]}
                                        components={{
                                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                          code: ({ className, children, ...props }) => {
                                            const match = /language-(\w+)/.exec(className || '');
                                            return (
                                              <code className={className} {...props}>
                                                {children}
                                              </code>
                                            );
                                          },
                                          pre: ({ children }) => (
                                            <pre className="bg-black/30 rounded p-2 overflow-x-auto mb-2">
                                              {children}
                                            </pre>
                                          ),
                                        }}
                                      >
                                        {displayContent}
                                      </ReactMarkdown>
                                    )}
                                    {hasOperations && (
                                      <div className="mt-3 pt-3 border-t border-sim-border/50">
                                        <div className="flex items-center justify-between mb-2">
                                          <span className="text-[10px] text-sim-muted">
                                            {operations.length} operation{operations.length !== 1 ? 's' : ''} available
                                          </span>
                                          {isApplied ? (
                                            <div className="flex items-center gap-1 text-[10px] text-green-400">
                                              <Check className="w-3 h-3" />
                                              <span>Applied</span>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => handleApplyOperations(message.id, operations)}
                                              className="flex items-center gap-1 px-2 py-1 bg-sim-red/20 hover:bg-sim-red/30 text-sim-red text-[10px] rounded transition-colors"
                                            >
                                              <Play className="w-3 h-3" />
                                              <span>Apply to Notebook</span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div className="whitespace-pre-wrap">{displayContent}</div>
                                )}
                              </div>
                              {message.token_estimate && (
                                <div className="text-[10px] text-sim-muted mt-2 pt-2 border-t border-sim-border/50">
                                  ~{message.token_estimate} tokens
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-sim-muted">
                <div className="text-center">
                  <MessageSquare className="w-12 h-12 opacity-20 mx-auto mb-2" />
                  <p className="text-xs">Select a session to view messages</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="h-8 border-t border-sim-border bg-sim-bg flex items-center justify-between px-4 text-[10px] text-sim-muted select-none shrink-0">
          <span>{sessions.length} total sessions</span>
          {selectedSession && (
            <span>{selectedSession.messageCount} messages in selected session</span>
          )}
        </div>
      </div>
    </div>
  );
};
