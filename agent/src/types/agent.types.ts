/**
 * Core type definitions for the No-RAG Notebook Agent
 *
 * Requirements: 1.5, 4.2, 4.3, 2.5, 3.1, 6.1, 9.1
 */

/**
 * Operating mode of the notebook agent
 * - ASK: Direct question answering with full context, NO code execution
 * - AGENT: Cell operations only (create/edit/update/delete cells), NO code execution
 * - AGENTIC: Full autonomous loop - add cell → execute → check output → fix → repeat
 * - PLAN: Generate high-level plans with code snippets, NO execution
 */
export type AgentMode = 'ASK' | 'AGENT' | 'AGENTIC' | 'PLAN';

/**
 * Compact agent state for embedding in system prompts
 * Uses abbreviated field names to minimize token usage
 *
 * Requirements: 4.1, 4.2
 */
export interface AgentState {
    /** Version of the state format */
    v: string;
    /** Timestamp of last update */
    ts: number;
    /** Notebook identifier */
    nb: string;
    /** Current agent mode */
    m: AgentMode;
    /** Compact variables with abbreviated field names */
    vars: CompactVariable[];
    /** Execution order of cells */
    exec: string[];
    /** Active experiment entries */
    exps: ExperimentEntry[];
    /** Recent error messages */
    errs: string[];
    /** Currently active cell IDs */
    active: string[];
}

/**
 * Compact variable representation for agent state
 * Uses abbreviated field names (n, t, s, v, r) for token efficiency
 *
 * Requirements: 4.2
 */
export interface CompactVariable {
    /** Variable name */
    n: string;
    /** Variable type */
    t: string;
    /** Variable shape (e.g., "(1000, 15)" for DataFrame) */
    s?: string;
    /** Preview value for display */
    v?: string;
    /** Reference count - number of cells referencing this variable */
    r: number;
}

/**
 * Experiment entry for agent state
 *
 * Requirements: 8.1, 8.4
 */
export interface ExperimentEntry {
    /** Experiment identifier */
    id: string;
    /** Timestamp of experiment start */
    ts: number;
    /** Associated cell ID */
    cell: string;
    /** Experiment description */
    desc: string;
    /** Experiment status */
    status: 'running' | 'success' | 'error';
}

/**
 * Rich UI state for frontend visualization
 * Includes full field names and metadata for display
 *
 * Requirements: 4.1, 4.3
 */
export interface UIState {
    /** Current kernel status */
    kernelStatus: 'idle' | 'busy' | 'error' | 'disconnected';
    /** Full variable objects with dependencies and metadata */
    variables: RichVariable[];
    /** Execution history entries */
    executionHistory: ExecutionHistoryEntry[];
    /** Experiment records with metrics */
    experiments: Experiment[];
    /** Cell states keyed by cell ID */
    cellStates: Record<string, CellState>;
    /** Chat message history */
    chatHistory: ChatMessage[];
    /** Suggested actions for the user */
    suggestions: string[];
}

/**
 * Rich variable representation for UI display
 * Includes dependencies, references, and timestamps
 *
 * Requirements: 4.3, 7.1, 7.3
 */
export interface RichVariable {
    /** Unique variable identifier */
    id: string;
    /** Variable name */
    name: string;
    /** Variable type */
    type: string;
    /** Human-readable shape description */
    shape: string;
    /** Full variable value (for display) */
    value: unknown;
    /** Preview string for quick display */
    preview: string;
    /** Cell IDs this variable depends on */
    dependencies: string[];
    /** Cell IDs that reference this variable */
    referencedBy: string[];
    /** Timestamp when variable was created */
    createdAt: number;
    /** Timestamp when variable was last updated */
    updatedAt: number;
}

/**
 * Cell execution state
 *
 * Requirements: 2.5
 */
export interface CellState {
    /** Execution status */
    status: 'pending' | 'running' | 'success' | 'error';
    /** Number of times cell was executed */
    executionCount: number;
    /** Last execution duration in seconds */
    executionTime?: number;
    /** Error message if failed */
    error?: string;
}

/**
 * Experiment record for UI display
 *
 * Requirements: 8.1, 8.4, 8.5
 */
export interface Experiment {
    /** Experiment identifier */
    id: string;
    /** Experiment name */
    name: string;
    /** Experiment description */
    description: string;
    /** Associated cell IDs */
    cells: string[];
    /** Experiment status */
    status: 'active' | 'completed' | 'failed';
    /** Recorded metrics */
    metrics: Record<string, number>;
    /** Timestamp when experiment started */
    startedAt: number;
    /** Timestamp when experiment ended */
    endedAt?: number;
}

/**
 * Execution history entry
 *
 * Requirements: 2.5, 6.2
 */
export interface ExecutionHistoryEntry {
    /** Cell identifier */
    cellId: string;
    /** Execution timestamp */
    timestamp: number;
    /** Execution duration in seconds */
    executionTime: number;
    /** Execution status */
    status: 'success' | 'error';
    /** Cell output */
    output: string;
}

/**
 * Chat message with metadata
 *
 * Requirements: 3.1
 */
export interface ChatMessage {
    /** Unique message identifier */
    id: string;
    /** Message role */
    role: 'user' | 'assistant' | 'system';
    /** Message content */
    content: string;
    /** Message timestamp */
    timestamp: number;
    /** Estimated token count */
    tokenCount: number;
    /** Optional summary for this message */
    summary?: string;
}

/**
 * Conversation summary for rolling summary
 *
 * Requirements: 3.2, 3.3
 */
export interface ConversationSummary {
    /** Summary of the conversation */
    summary: string;
    /** Key topics discussed */
    keyTopics: string[];
    /** Decisions made during conversation */
    decisions: string[];
    /** Open questions from the conversation */
    openQuestions: string[];
    /** Timestamp of last update */
    lastUpdated: number;
}

/**
 * Formatted rolling summary for display
 *
 * Requirements: 3.3
 */
export interface RollingSummary {
    /** Markdown-formatted summary */
    content: string;
    /** Timestamp when generated */
    generatedAt: number;
    /** Number of messages summarized */
    messageCount: number;
}

/**
 * Introspection JSON for system prompt embedding
 * Compact representation of notebook state
 *
 * Requirements: 2.1, 2.3, 2.5
 */
export interface IntrospectionJSON {
    /** Format version */
    version: string;
    /** Generation timestamp */
    generatedAt: number;
    /** Notebook information */
    notebook: {
        /** Notebook identifier */
        id: string;
        /** Total cell count */
        cellCount: number;
        /** Execution order of cells */
        executionOrder: string[];
    };
    /** Current variables in the notebook */
    variables: IntrospectedVariable[];
    /** Active and completed experiments */
    experiments: IntrospectedExperiment[];
    /** Current execution context */
    executionContext: ExecutionContext;
    /** Recent activity log */
    recentActivity: ActivityEntry[];
}

/**
 * Variable information for introspection
 *
 * Requirements: 2.1, 2.2, 7.1, 7.2
 */
export interface IntrospectedVariable {
    /** Variable name */
    name: string;
    /** Variable type */
    type: string;
    /** Variable shape */
    shape: string;
    /** Preview of the value */
    valuePreview: string;
    /** Cell ID where variable was defined */
    definedIn: string;
    /** Variables this variable depends on */
    dependencies: string[];
    /** Cells that reference this variable */
    referencedBy: string[];
}

/**
 * Experiment information for introspection
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */
export interface IntrospectedExperiment {
    /** Experiment identifier */
    id: string;
    /** Experiment name */
    name: string;
    /** Experiment description */
    description: string;
    /** Associated cell IDs */
    cells: string[];
    /** Experiment status */
    status: 'active' | 'completed' | 'failed';
    /** Recorded metrics */
    metrics: Record<string, number>;
}

/**
 * Current execution context
 *
 * Requirements: 2.5
 */
export interface ExecutionContext {
    /** Currently executing cell ID or null */
    currentCell: string | null;
    /** Total execution count */
    executionCount: number;
    /** Kernel status */
    kernelStatus: string;
    /** Last execution duration */
    lastExecutionTime: number;
}

/**
 * Activity entry for recent activity tracking
 *
 * Requirements: 2.5
 */
export interface ActivityEntry {
    /** Activity timestamp */
    timestamp: number;
    /** Activity type */
    type: 'execution' | 'edit' | 'chat';
    /** Activity description */
    description: string;
    /** Associated cell ID if applicable */
    cellId?: string;
}

/**
 * Result of code execution
 *
 * Requirements: 6.1, 6.2
 */
export interface ExecutionResult {
    /** Whether execution succeeded */
    success: boolean;
    /** Text output from execution */
    output: string;
    /** Error message if failed */
    error?: string;
    /** Execution duration in seconds */
    executionTime: number;
    /** Cell outputs (streams, displays, etc.) */
    outputs: CellOutput[];
    /** Captured variables after execution */
    variables: VariableInfo[];
}

/**
 * Cell output from code execution
 *
 * Requirements: 6.2
 */
export interface CellOutput {
    /** Output type */
    type: 'stream' | 'result' | 'display' | 'error' | 'widget';
    /** Output data */
    data: unknown;
    /** Stream name if type is 'stream' */
    stream?: 'stdout' | 'stderr';
}

/**
 * Variable information from kernel introspection
 *
 * Requirements: 6.3
 */
export interface VariableInfo {
    /** Variable name */
    name: string;
    /** Variable type */
    type: string;
    /** Variable shape */
    shape?: string;
    /** String preview of value */
    value: string;
    /** Number of references to this variable */
    references: number;
}

/**
 * Execution options for kernel operations
 *
 * Requirements: 6.1, 6.5
 */
export interface ExecutionOptions {
    /** Timeout in milliseconds */
    timeout?: number;
    /** Whether to capture variables */
    captureVariables?: boolean;
    /** Whether to capture execution history */
    captureHistory?: boolean;
}

/**
 * Agent error categories
 *
 * Requirements: 9.1
 */
export type AgentErrorType = 'execution' | 'state' | 'memory' | 'llm' | 'kernel';

/**
 * Kernel error categories
 *
 * Requirements: 6.4, 9.2
 */
export type KernelErrorType = 'execution' | 'timeout' | 'connection' | 'interrupted' | 'unknown';

/**
 * Base kernel error interface
 *
 * Requirements: 6.4, 9.2
 */
export interface KernelError {
    /** Error type category */
    type: KernelErrorType;
    /** Descriptive error message */
    message: string;
    /** Error code for programmatic handling (e.g., 'EXECUTION_ERROR', 'TIMEOUT_ERROR') */
    errorCode: string;
    /** Whether the error is recoverable */
    recoverable: boolean;
    /** Stack trace for debugging */
    stack?: string;
    /** Timestamp of error */
    timestamp: number;
    /** Additional context for debugging */
    context: Record<string, unknown>;
}

/**
 * Execution error - raised when code fails to execute
 *
 * Requirements: 6.4
 */
export interface KernelExecutionError extends KernelError {
    type: 'execution';
    /** The code that caused the error */
    code: string;
    /** Line number where error occurred (if available) */
    lineNumber?: number;
    /** Error name (e.g., "SyntaxError", "NameError") */
    errorName: string;
}

/**
 * Timeout error - raised when execution exceeds timeout
 *
 * Requirements: 6.4
 */
export interface KernelTimeoutError extends KernelError {
    type: 'timeout';
    /** Requested timeout in milliseconds */
    requestedTimeout: number;
    /** Elapsed time in milliseconds */
    elapsedTime: number;
    /** Partial output if available */
    partialOutput?: string;
}

/**
 * Connection error - raised when kernel connection fails
 *
 * Requirements: 6.4
 */
export interface KernelConnectionError extends KernelError {
    type: 'connection';
    /** Kernel ID that failed to connect */
    kernelId: string;
    /** Number of reconnection attempts made */
    reconnectAttempts: number;
    /** Whether the kernel was previously connected */
    wasConnected: boolean;
}

/**
 * Interrupted error - raised when execution is interrupted
 *
 * Requirements: 6.4
 */
export interface KernelInterruptedError extends KernelError {
    type: 'interrupted';
    /** Cell ID that was interrupted */
    cellId?: string;
    /** Whether interrupt was user-initiated */
    userInitiated: boolean;
}

/**
 * Union type for all kernel errors
 *
 * Requirements: 6.4
 */
export type KernelErrorTypeUnion =
    | KernelExecutionError
    | KernelTimeoutError
    | KernelConnectionError
    | KernelInterruptedError;

/**
 * Agent error with context
 *
 * Requirements: 9.1, 9.3, 9.4
 */
export interface AgentError {
    /** Error type category */
    type: AgentErrorType;
    /** Error message */
    message: string;
    /** Whether the error is recoverable */
    recoverable: boolean;
    /** Additional context for debugging */
    context: Record<string, unknown>;
    /** Timestamp of error */
    timestamp: number;
    /** Stack trace if available */
    stack?: string;
}

/**
 * Error resolution result
 *
 * Requirements: 9.2, 9.3
 */
export interface ErrorResolution {
    /** Action taken to resolve */
    action: 'retry' | 'restart' | 'suggest_fix' | 'ignore' | 'fail';
    /** Whether the resolution was successful */
    success: boolean;
    /** Suggestion for the user */
    suggestion?: string;
    /** Additional details */
    details?: Record<string, unknown>;
}

/**
 * Error context for categorization
 *
 * Requirements: 9.1
 */
export interface ErrorContext {
    /** Current agent mode */
    mode: AgentMode;
    /** Current notebook ID */
    notebookId: string;
    /** Cell ID if error occurred during cell execution */
    cellId?: string;
    /** User message that triggered the error */
    userMessage?: string;
}

/**
 * Notebook agent configuration
 *
 * Requirements: 1.5, C.4
 */
export interface NotebookAgentConfig {
    /** Notebook identifier */
    notebookId: string;
    /** Initial agent mode */
    mode: AgentMode;
    /** Number of messages before generating summary */
    summaryThreshold: number;
    /** Introspection refresh interval in milliseconds */
    introspectionInterval: number;
    /** Maximum context tokens */
    maxContextTokens: number;
    /** Maximum summary length in tokens */
    maxSummaryLength: number;
}

/**
 * State manager configuration
 *
 * Requirements: 4.1, 5.1
 */
export interface StateManagerConfig {
    /** Polling interval in milliseconds */
    pollingInterval: number;
    /** Maximum recent errors to keep */
    maxRecentErrors: number;
    /** Maximum active experiments */
    maxExperiments: number;
}

/**
 * Chat memory configuration
 *
 * Requirements: 3.1, 3.5
 */
export interface ChatMemoryConfig {
    /** Maximum messages before truncation */
    maxMessages: number;
    /** Maximum tokens for chat history */
    maxTokens: number;
    /** Summary generation threshold */
    summaryThreshold: number;
}

/**
 * Kernel interface configuration
 *
 * Requirements: 6.1, 6.5
 */
export interface KernelInterfaceConfig {
    /** Notebook identifier */
    notebookId: string;
    /** Default execution timeout in milliseconds */
    executionTimeout: number;
    /** Maximum retry attempts */
    maxRetries: number;
}

/**
 * Agent response types
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
export type AgentResponseType = 'answer' | 'agent_result' | 'plan' | 'operation';

/**
 * Agent response
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */
export interface AgentResponse {
    /** Response type */
    type: AgentResponseType;
    /** Response content */
    content: string;
    /** Code snippets if applicable */
    code?: string[];
    /** Cells created during execution */
    cells?: string[];
    /** Plan steps if type is 'plan' */
    steps?: PlanStep[];
    /** Whether execution requires user review */
    requiresReview?: boolean;
    /** Response metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Plan step for PLAN mode
 *
 * Requirements: 1.4
 */
export interface PlanStep {
    /** Step description */
    description: string;
    /** Code snippet for this step */
    code: string;
    /** Estimated time for this step */
    estimatedTime: string;
    /** Step order */
    order: number;
}

/**
 * Kernel connection status
 *
 * Requirements: 6.1, 6.4
 */
export type KernelStatus = 'disconnected' | 'connecting' | 'connected' | 'idle' | 'busy' | 'error';

/**
 * Categorized error for kernel operations
 *
 * Requirements: 6.4, 9.2
 */
export interface CategorizedError {
    /** Error type category */
    type: KernelErrorType;
    /** Descriptive error message */
    message: string;
    /** Error code for programmatic handling */
    errorCode: string;
    /** Whether the error is recoverable */
    recoverable: boolean;
    /** Stack trace for debugging */
    stack?: string;
    /** Timestamp of error */
    timestamp: number;
    /** Additional context for debugging */
    context: Record<string, unknown>;
}

/**
 * Streaming callbacks for real-time updates
 */
export interface StreamingCallbacks {
    /** Called when thinking state changes */
    onThinking?: (thinking: boolean) => void;
    /** Called for each text chunk */
    onChunk?: (chunk: string, isOperation?: boolean) => void;
    /** Called when an operation is parsed */
    onOperation?: (operation: { type: string; params: Record<string, any> }) => void;
    /** Called when a step starts (agentic mode) */
    onStepStart?: (step: { index: number; description: string; type: string }) => void;
    /** Called when a step completes (agentic mode) */
    onStepComplete?: (step: { index: number; output?: string; success: boolean }) => void;
    /** Called when plan is ready (plan mode) */
    onPlanReady?: (operations: Array<{ type: string; params: Record<string, any> }>) => void;
    /** Called when streaming is done */
    onDone?: (response: AgentResponse) => void;
    /** Called on error */
    onError?: (error: string) => void;
}

/**
 * Streaming configuration
 */
export interface StreamingConfig {
    /** Whether to stream text chunks */
    streamChunks?: boolean;
    /** Whether to stream operations as they're parsed */
    streamOperations?: boolean;
    /** Whether to show thinking indicator */
    showThinking?: boolean;
    /** Delay between chunks in ms */
    chunkDelay?: number;
    /** Delay between operations in ms */
    operationDelay?: number;
}

/**
 * Indexed cell operation for ordered execution
 */
export interface IndexedCellOperation {
    /** Cell index (0-based) */
    index: number;
    /** Cell type */
    type: 'code' | 'markdown';
    /** Cell content */
    content: string;
    /** Original operation if transformed */
    originalOperation?: { type: string; params: Record<string, any> };
}

/**
 * Agentic step execution result
 */
export interface AgenticStepResult {
    /** Step index */
    index: number;
    /** Step description */
    description: string;
    /** Operation type */
    type: string;
    /** Whether execution succeeded */
    success: boolean;
    /** Output if applicable */
    output?: string;
    /** Error message if failed */
    error?: string;
    /** Cells created/modified */
    cells?: string[];
}
