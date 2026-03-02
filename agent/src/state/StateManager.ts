/**
 * StateManager - Dual state management for notebook agent
 * 
 * Maintains both AgentState (compact JSON for system prompts) and UIState (rich objects for frontend)
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, C.4
 */

import {
    AgentState,
    UIState,
    AgentMode,
    CompactVariable,
    ExperimentEntry,
    RichVariable,
    Experiment,
    CellState,
    ChatMessage,
    ExecutionHistoryEntry,
    StateManagerConfig,
    VariableInfo,
    ExecutionResult,
    IntrospectionJSON,
    RichVariable as IntrospectedRichVariable,
} from '../types/agent.types';

/**
 * Function type for fetching state from kernel
 */
export type StateSyncFunction = () => Promise<IntrospectionJSON>;

/**
 * State change callback type
 */
export type StateSubscriber = (state: { agent?: AgentState; ui?: UIState }) => void;

/**
 * Simple mutex implementation for thread-safe state access
 */
class Mutex {
    private locked = false;
    private queue: Array<() => void> = [];

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) next();
        } else {
            this.locked = false;
        }
    }
}

/**
 * StateManager class with dual state storage
 * 
 * - AgentState: Compact JSON for LLM system prompts (abbreviated field names)
 * - UIState: Rich objects for frontend display (full field names)
 */
export class StateManager {
    private agentState: AgentState;
    private uiState: UIState;
    private config: StateManagerConfig;
    private subscribers: Set<StateSubscriber>;
    private agentStateLock: Mutex;
    private uiStateLock: Mutex;
    private pollingInterval: number | null = null;
    private lastUpdate: number;
    private notebookId: string;
    private syncFunction: StateSyncFunction | null = null;
    private pollingTimer: ReturnType<typeof setInterval> | null = null;
    private isPollingActive: boolean = false;
    private cachedState: IntrospectionJSON | null = null;

    constructor(notebookId: string, config?: Partial<StateManagerConfig>) {
        this.notebookId = notebookId;
        this.config = {
            pollingInterval: config?.pollingInterval ?? 500,
            maxRecentErrors: config?.maxRecentErrors ?? 10,
            maxExperiments: config?.maxExperiments ?? 20,
        };

        // Initialize agent state with compact format
        this.agentState = {
            v: '1.0',
            ts: Date.now(),
            nb: notebookId,
            m: 'ASK',
            vars: [],
            exec: [],
            exps: [],
            errs: [],
            active: [],
        };

        // Initialize UI state with rich format
        this.uiState = {
            kernelStatus: 'idle',
            variables: [],
            executionHistory: [],
            experiments: [],
            cellStates: {},
            chatHistory: [],
            suggestions: [],
        };

        this.subscribers = new Set();
        this.agentStateLock = new Mutex();
        this.uiStateLock = new Mutex();
        this.lastUpdate = Date.now();
    }

    /**
     * Get the current agent state (compact format for system prompts)
     * 
     * Requirements: 4.4
     */
    getAgentState(): AgentState {
        return { ...this.agentState };
    }

    /**
     * Get the current UI state (rich format for frontend)
     * 
     * Requirements: 4.4
     */
    getUIState(): UIState {
        return { ...this.uiState };
    }

    /**
     * Serialize agent state to JSON string for system prompt generation
     * 
     * Requirements: 4.5
     */
    toSystemPrompt(): string {
        return JSON.stringify(this.agentState);
    }

    /**
     * Serialize UI state to JSON string
     */
    toJSON(): string {
        return JSON.stringify({
            agent: this.agentState,
            ui: this.uiState,
        });
    }

    /**
     * Update agent state with new values
     * Thread-safe with mutex locking
     * 
     * Requirements: 5.1, 5.2
     */
    async updateAgentState(updates: Partial<AgentState>): Promise<void> {
        await this.agentStateLock.acquire();
        try {
            this.agentState = { ...this.agentState, ...updates, ts: Date.now() };
            this.lastUpdate = Date.now();
            this.notifySubscribers({ agent: this.agentState });
        } finally {
            this.agentStateLock.release();
        }
    }

    /**
     * Update UI state with new values
     * Thread-safe with mutex locking
     * 
     * Requirements: 5.1, 5.2
     */
    async updateUIState(updates: Partial<UIState>): Promise<void> {
        await this.uiStateLock.acquire();
        try {
            this.uiState = { ...this.uiState, ...updates };
            this.lastUpdate = Date.now();
            this.notifySubscribers({ ui: this.uiState });
        } finally {
            this.uiStateLock.release();
        }
    }

    /**
     * Perform atomic update on both agent and UI state
     * Acquires locks in consistent order to prevent deadlock
     * 
     * Requirements: 5.2, 5.4
     */
    async atomicUpdate(
        agentUpdates: Partial<AgentState>,
        uiUpdates: Partial<UIState>
    ): Promise<void> {
        // Acquire both locks in consistent order (agent first, then ui)
        await this.agentStateLock.acquire();
        await this.uiStateLock.acquire();
        try {
            this.agentState = { ...this.agentState, ...agentUpdates, ts: Date.now() };
            this.uiState = { ...this.uiState, ...uiUpdates };
            this.lastUpdate = Date.now();
            this.notifySubscribers({ agent: this.agentState, ui: this.uiState });
        } finally {
            this.uiStateLock.release();
            this.agentStateLock.release();
        }
    }

    /**
     * Subscribe to state changes
     * Returns unsubscribe function for cleanup
     * 
     * Requirements: 5.3
     */
    subscribe(subscriber: StateSubscriber): () => void {
        this.subscribers.add(subscriber);
        return () => {
            this.subscribers.delete(subscriber);
        };
    }

    /**
     * Notify all subscribers of state changes
     */
    private notifySubscribers(changes: { agent?: AgentState; ui?: UIState }): void {
        for (const subscriber of this.subscribers) {
            try {
                subscriber(changes);
            } catch (error) {
                console.error('Error notifying state subscriber:', error);
            }
        }
    }

    /**
     * Set the current agent mode
     */
    async setMode(mode: AgentMode): Promise<void> {
        await this.updateAgentState({ m: mode });
    }

    /**
     * Get current agent mode
     */
    getMode(): AgentMode {
        return this.agentState.m;
    }

    /**
     * Add a variable to both agent and UI state
     * Converts from VariableInfo (kernel) to compact/rich formats
     * 
     * Requirements: 4.2, 4.3
     */
    async addVariable(variable: VariableInfo, cellId: string): Promise<void> {
        // Compact variable for agent state
        const compactVar: CompactVariable = {
            n: variable.name,
            t: variable.type,
            s: variable.shape,
            v: variable.value,
            r: variable.references,
        };

        // Rich variable for UI state
        const richVar: RichVariable = {
            id: `var-${variable.name}-${Date.now()}`,
            name: variable.name,
            type: variable.type,
            shape: variable.shape ?? 'scalar',
            value: variable.value,
            preview: variable.value,
            dependencies: [cellId],
            referencedBy: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await this.atomicUpdate(
            { vars: [...this.agentState.vars, compactVar] },
            { variables: [...this.uiState.variables, richVar] }
        );
    }

    /**
     * Update a variable in both states
     */
    async updateVariable(
        name: string,
        updates: Partial<VariableInfo>
    ): Promise<void> {
        await this.agentStateLock.acquire();
        await this.uiStateLock.acquire();
        try {
            // Update compact variable
            const varIndex = this.agentState.vars.findIndex((v) => v.n === name);
            if (varIndex >= 0) {
                const updated: Partial<CompactVariable> = {};
                if (updates.name !== undefined) updated.n = updates.name;
                if (updates.type !== undefined) updated.t = updates.type;
                if (updates.shape !== undefined) updated.s = updates.shape;
                if (updates.value !== undefined) updated.v = updates.value;
                if (updates.references !== undefined) updated.r = updates.references;

                this.agentState.vars[varIndex] = {
                    ...this.agentState.vars[varIndex],
                    ...updated,
                };
            }

            // Update rich variable
            const richIndex = this.uiState.variables.findIndex((v) => v.name === name);
            if (richIndex >= 0) {
                this.uiState.variables[richIndex] = {
                    ...this.uiState.variables[richIndex],
                    ...updates,
                    updatedAt: Date.now(),
                };
            }

            this.lastUpdate = Date.now();
            this.notifySubscribers({ agent: this.agentState, ui: this.uiState });
        } finally {
            this.uiStateLock.release();
            this.agentStateLock.release();
        }
    }

    /**
     * Remove a variable from both states
     */
    async removeVariable(name: string): Promise<void> {
        await this.atomicUpdate(
            { vars: this.agentState.vars.filter((v) => v.n !== name) },
            { variables: this.uiState.variables.filter((v) => v.name !== name) }
        );
    }

    /**
     * Add an execution to history
     */
    async addExecution(result: ExecutionResult, cellId: string): Promise<void> {
        const entry = {
            cellId,
            timestamp: Date.now(),
            executionTime: result.executionTime,
            status: result.success ? ('success' as const) : ('error' as const),
            output: result.output,
        };

        await this.atomicUpdate(
            { exec: [...this.agentState.exec, cellId] },
            { executionHistory: [...this.uiState.executionHistory, entry] }
        );
    }

    /**
     * Update cell state
     */
    async updateCellState(
        cellId: string,
        state: Partial<CellState>
    ): Promise<void> {
        await this.updateUIState({
            cellStates: {
                ...this.uiState.cellStates,
                [cellId]: { ...this.uiState.cellStates[cellId], ...state },
            },
        });
    }

    /**
     * Add a chat message to history
     */
    async addChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<void> {
        const fullMessage: ChatMessage = {
            ...message,
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            timestamp: Date.now(),
        };

        await this.updateUIState({
            chatHistory: [...this.uiState.chatHistory, fullMessage],
        });
    }

    /**
     * Add an error to recent errors
     */
    async addError(error: string): Promise<void> {
        const updatedErrors = [...this.agentState.errs, error].slice(
            -this.config.maxRecentErrors
        );
        await this.updateAgentState({ errs: updatedErrors });
    }

    /**
     * Add a suggestion
     */
    async addSuggestion(suggestion: string): Promise<void> {
        await this.updateUIState({
            suggestions: [...this.uiState.suggestions, suggestion],
        });
    }

    /**
     * Clear all suggestions
     */
    async clearSuggestions(): Promise<void> {
        await this.updateUIState({ suggestions: [] });
    }

    /**
     * Update kernel status
     */
    async setKernelStatus(
        status: 'idle' | 'busy' | 'error' | 'disconnected'
    ): Promise<void> {
        await this.updateUIState({ kernelStatus: status });
    }

    /**
     * Get the notebook ID
     */
    getNotebookId(): string {
        return this.notebookId;
    }

    /**
     * Get last update timestamp
     */
    getLastUpdate(): number {
        return this.lastUpdate;
    }

    /**
     * Set the sync function for polling
     * This function will be called to fetch state from the kernel
     * 
     * Requirements: C.4
     */
    setSyncFunction(syncFn: StateSyncFunction): void {
        this.syncFunction = syncFn;
    }

    /**
     * Start polling for state changes
     * Polls the kernel at the configured interval to detect state mutations
     * 
     * Requirements: C.4
     */
    startPolling(interval?: number): void {
        if (this.isPollingActive) {
            this.stopPolling();
        }

        const pollInterval = interval ?? this.config.pollingInterval;
        this.pollingInterval = pollInterval;
        this.isPollingActive = true;

        // Start the polling loop
        this.pollingTimer = setInterval(async () => {
            await this.pollingLoop();
        }, pollInterval);
    }

    /**
     * Stop polling for state changes
     * 
     * Requirements: C.4
     */
    stopPolling(): void {
        this.isPollingActive = false;
        if (this.pollingTimer !== null) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
        this.pollingInterval = null;
    }

    /**
     * Check if polling is active
     */
    isPolling(): boolean {
        return this.isPollingActive;
    }

    /**
     * Get polling interval
     */
    getPollingInterval(): number | null {
        return this.pollingInterval;
    }

    /**
     * The polling loop that fetches state and detects changes
     * 
     * Requirements: C.4
     */
    private async pollingLoop(): Promise<void> {
        if (!this.isPollingActive || !this.syncFunction) {
            return;
        }

        try {
            const newState = await this.syncFunction();
            const hasChanges = this.detectChanges(this.cachedState, newState);

            if (hasChanges) {
                await this.applyStateUpdate(newState);
                this.cachedState = newState;
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }

    /**
     * Detect changes between cached state and new state
     * Checks for variable changes, execution order changes, and experiment changes
     * 
     * Requirements: C.4
     */
    detectChanges(
        oldState: IntrospectionJSON | null,
        newState: IntrospectionJSON
    ): boolean {
        // If no previous state, this is a change
        if (oldState === null) {
            return true;
        }

        // Check notebook changes
        if (oldState.notebook.cellCount !== newState.notebook.cellCount) {
            return true;
        }

        // Check execution order changes
        if (!this.arraysEqual(oldState.notebook.executionOrder, newState.notebook.executionOrder)) {
            return true;
        }

        // Check variable changes
        if (oldState.variables.length !== newState.variables.length) {
            return true;
        }

        for (const newVar of newState.variables) {
            const oldVar = oldState.variables.find(v => v.name === newVar.name);
            if (!oldVar) {
                return true; // New variable added
            }
            if (oldVar.valuePreview !== newVar.valuePreview) {
                return true; // Variable value changed
            }
            if (oldVar.shape !== newVar.shape) {
                return true; // Variable shape changed
            }
        }

        // Check experiment changes
        if (oldState.experiments.length !== newState.experiments.length) {
            return true;
        }

        for (const newExp of newState.experiments) {
            const oldExp = oldState.experiments.find(e => e.id === newExp.id);
            if (!oldExp) {
                return true; // New experiment added
            }
            if (oldExp.status !== newExp.status) {
                return true; // Experiment status changed
            }
            if (!this.objectsEqual(oldExp.metrics, newExp.metrics)) {
                return true; // Experiment metrics changed
            }
        }

        // Check execution context changes
        if (oldState.executionContext.kernelStatus !== newState.executionContext.kernelStatus) {
            return true;
        }
        if (oldState.executionContext.currentCell !== newState.executionContext.currentCell) {
            return true;
        }

        // Check recent activity changes
        if (oldState.recentActivity.length !== newState.recentActivity.length) {
            return true;
        }

        return false;
    }

    /**
     * Apply state update from introspection JSON
     * Updates both agent state and UI state
     * 
     * Requirements: C.4
     */
    private async applyStateUpdate(introspection: IntrospectionJSON): Promise<void> {
        // Convert introspected variables to compact and rich formats
        const compactVars: CompactVariable[] = introspection.variables.map(v => ({
            n: v.name,
            t: v.type,
            s: v.shape,
            v: v.valuePreview,
            r: v.referencedBy.length,
        }));

        const richVars: RichVariable[] = introspection.variables.map((v, index) => ({
            id: `var-${v.name}-${Date.now()}-${index}`,
            name: v.name,
            type: v.type,
            shape: v.shape,
            value: v.valuePreview,
            preview: v.valuePreview,
            dependencies: v.dependencies,
            referencedBy: v.referencedBy,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }));

        // Update agent state
        await this.updateAgentState({
            vars: compactVars,
            exec: introspection.notebook.executionOrder,
            exps: introspection.experiments.map(e => ({
                id: e.id,
                ts: Date.now(),
                cell: e.cells[0] ?? '',
                desc: e.description,
                status: e.status === 'active' ? 'running' : e.status === 'completed' ? 'success' : 'error',
            })),
        });

        // Update UI state
        await this.updateUIState({
            kernelStatus: introspection.executionContext.kernelStatus as 'idle' | 'busy' | 'error' | 'disconnected',
            variables: richVars,
        });
    }

    /**
     * Helper: Compare two arrays for equality
     */
    private arraysEqual<T>(a: T[] | undefined, b: T[]): boolean {
        if (a === undefined && b === undefined) return true;
        if (a === undefined || b === undefined) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    /**
     * Helper: Compare two objects for equality
     */
    private objectsEqual(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean {
        if (a === undefined && b === undefined) return true;
        if (a === undefined || b === undefined) return false;
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (a[key] !== b[key]) return false;
        }
        return true;
    }
}

/**
 * Create a new StateManager instance
 */
export function createStateManager(
    notebookId: string,
    config?: Partial<StateManagerConfig>
): StateManager {
    return new StateManager(notebookId, config);
}