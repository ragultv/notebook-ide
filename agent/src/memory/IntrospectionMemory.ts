/**
 * IntrospectionMemory - Variable tracking and experiment management
 * 
 * Captures notebook state for system prompt embedding and manages
 * experiment tracking with metrics.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.1, 7.2, 7.4, 8.1, 8.2, 8.3, 8.4
 */

import {
    IntrospectionJSON,
    IntrospectedVariable,
    IntrospectedExperiment,
    Experiment,
    ExperimentEntry,
    ExecutionContext,
    ActivityEntry,
    VariableInfo,
} from '../types/agent.types';

/**
 * Metric entry for tracking experiment metrics with timestamps
 */
interface MetricEntry {
    key: string;
    value: number;
    timestamp: number;
}

/**
 * Internal experiment storage with full details
 */
interface StoredExperiment {
    id: string;
    name: string;
    description: string;
    cells: string[];
    status: 'active' | 'completed' | 'failed';
    metrics: Record<string, number>;
    metricHistory: MetricEntry[];
    startedAt: number;
    endedAt?: number;
}

/**
 * Configuration for introspection memory
 */
export interface IntrospectionMemoryConfig {
    /** Notebook identifier */
    notebookId: string;
    /** Maximum number of experiments to keep */
    maxExperiments: number;
    /** Maximum activity entries to track */
    maxActivityEntries: number;
    /** Refresh interval in milliseconds */
    refreshInterval: number;
}

/**
 * IntrospectionMemory class for managing notebook introspection
 * 
 * Provides variable tracking, experiment management, and introspection
 * JSON generation for system prompt embedding.
 */
export class IntrospectionMemory {
    private config: IntrospectionMemoryConfig;
    private experiments: Map<string, StoredExperiment>;
    private variables: Map<string, IntrospectedVariable>;
    private activityLog: ActivityEntry[];
    private executionContext: ExecutionContext;
    private executionOrder: string[];
    private cellCount: number;
    private lastRefresh: number;
    private version: string;

    /**
     * Create a new IntrospectionMemory instance
     * 
     * @param config - Configuration for introspection memory
     */
    constructor(config: IntrospectionMemoryConfig) {
        this.config = config;
        this.experiments = new Map();
        this.variables = new Map();
        this.activityLog = [];
        this.executionOrder = [];
        this.cellCount = 0;
        this.lastRefresh = 0;
        this.version = '1.0';
        
        // Initialize execution context
        this.executionContext = {
            currentCell: null,
            executionCount: 0,
            kernelStatus: 'idle',
            lastExecutionTime: 0,
        };
    }

    /**
     * Get the current introspection JSON
     * 
     * @returns Current introspection data for system prompt embedding
     * 
     * Requirements: 2.3, 2.4
     */
    async getJSON(): Promise<IntrospectionJSON> {
        return {
            version: this.version,
            generatedAt: Date.now(),
            notebook: {
                id: this.config.notebookId,
                cellCount: this.cellCount,
                executionOrder: [...this.executionOrder],
            },
            variables: Array.from(this.variables.values()),
            experiments: this.getIntrospectedExperiments(),
            executionContext: { ...this.executionContext },
            recentActivity: this.activityLog.slice(-50),
        };
    }

    /**
     * Refresh introspection data from kernel
     * 
     * @param variables - Current variables from kernel
     * @param executionOrder - Current execution order
     * @param cellCount - Current cell count
     * 
     * Requirements: 2.1, 2.3
     */
    async refresh(
        variables: VariableInfo[],
        executionOrder: string[],
        cellCount: number
    ): Promise<void> {
        // Update execution context
        this.executionContext.executionCount = executionOrder.length;
        
        // Update variables
        this.updateVariables(variables);
        
        // Update execution order
        this.executionOrder = executionOrder;
        this.cellCount = cellCount;
        
        this.lastRefresh = Date.now();
    }

    /**
     * Update execution context
     * 
     * @param context - Updated execution context
     */
    updateExecutionContext(context: Partial<ExecutionContext>): void {
        this.executionContext = { ...this.executionContext, ...context };
    }

    // ========================================================================
    // Experiment Management (Requirements: 8.1, 8.2, 8.3, 8.4)
    // ========================================================================

    /**
     * Start a new experiment
     * 
     * Creates an experiment entry with the given name, description,
     * and associated cell IDs.
     * 
     * @param name - Experiment name
     * @param description - Experiment description
     * @param cellIds - Array of cell IDs associated with this experiment
     * @returns Experiment ID
     * 
     * Requirements: 8.1
     */
    async startExperiment(
        name: string,
        description: string,
        cellIds: string[]
    ): Promise<string> {
        const experimentId = this.generateExperimentId();
        const now = Date.now();

        const experiment: StoredExperiment = {
            id: experimentId,
            name,
            description,
            cells: cellIds,
            status: 'active',
            metrics: {},
            metricHistory: [],
            startedAt: now,
        };

        this.experiments.set(experimentId, experiment);

        // Log activity
        this.logActivity('execution', `Started experiment: ${name}`, cellIds[0] || undefined);

        // Enforce experiment limit
        this.enforceExperimentLimit();

        return experimentId;
    }

    /**
     * End an experiment
     * 
     * Updates the experiment status to completed or failed.
     * 
     * @param experimentId - Experiment identifier
     * @param status - Final status ('completed' | 'failed')
     * @returns Whether the experiment was found and updated
     * 
     * Requirements: 8.3
     */
    async endExperiment(
        experimentId: string,
        status: 'completed' | 'failed'
    ): Promise<boolean> {
        const experiment = this.experiments.get(experimentId);
        
        if (!experiment) {
            return false;
        }

        experiment.status = status;
        experiment.endedAt = Date.now();

        // Log activity
        this.logActivity(
            'execution',
            `Ended experiment "${experiment.name}" with status: ${status}`,
            experiment.cells[0] || undefined
        );

        return true;
    }

    /**
     * Log a metric for an experiment
     * 
     * Records a metric with the current timestamp. Multiple metrics
     * with the same key will overwrite previous values in the metrics
     * map, but all values are preserved in the metric history.
     * 
     * @param experimentId - Experiment identifier
     * @param key - Metric key/name
     * @param value - Metric value
     * @returns Whether the experiment was found and metric was logged
     * 
     * Requirements: 8.2
     */
    async logMetric(
        experimentId: string,
        key: string,
        value: number
    ): Promise<boolean> {
        const experiment = this.experiments.get(experimentId);
        
        if (!experiment) {
            return false;
        }

        const metricEntry: MetricEntry = {
            key,
            value,
            timestamp: Date.now(),
        };

        // Add to history
        experiment.metricHistory.push(metricEntry);
        
        // Update current value
        experiment.metrics[key] = value;

        return true;
    }

    /**
     * Log multiple metrics for an experiment at once
     * 
     * @param experimentId - Experiment identifier
     * @param metrics - Object containing metric key-value pairs
     * @returns Whether the experiment was found
     * 
     * Requirements: 8.2
     */
    async logMetrics(
        experimentId: string,
        metrics: Record<string, number>
    ): Promise<boolean> {
        const experiment = this.experiments.get(experimentId);
        
        if (!experiment) {
            return false;
        }

        const now = Date.now();
        
        for (const [key, value] of Object.entries(metrics)) {
            const metricEntry: MetricEntry = {
                key,
                value,
                timestamp: now,
            };

            experiment.metricHistory.push(metricEntry);
            experiment.metrics[key] = value;
        }

        return true;
    }

    /**
     * Get all experiments
     * 
     * @returns Array of all experiments
     * 
     * Requirements: 8.4, 8.5
     */
    getExperiments(): Experiment[] {
        return Array.from(this.experiments.values()).map(exp => ({
            id: exp.id,
            name: exp.name,
            description: exp.description,
            cells: exp.cells,
            status: exp.status,
            metrics: { ...exp.metrics },
            startedAt: exp.startedAt,
            endedAt: exp.endedAt,
        }));
    }

    /**
     * Get a specific experiment by ID
     * 
     * @param experimentId - Experiment identifier
     * @returns Experiment or undefined if not found
     * 
     * Requirements: 8.4
     */
    getExperiment(experimentId: string): Experiment | undefined {
        const exp = this.experiments.get(experimentId);
        
        if (!exp) {
            return undefined;
        }

        return {
            id: exp.id,
            name: exp.name,
            description: exp.description,
            cells: exp.cells,
            status: exp.status,
            metrics: { ...exp.metrics },
            startedAt: exp.startedAt,
            endedAt: exp.endedAt,
        };
    }

    /**
     * Get active experiments only
     * 
     * @returns Array of active experiments
     */
    getActiveExperiments(): Experiment[] {
        return this.getExperiments().filter(exp => exp.status === 'active');
    }

    /**
     * Get completed experiments only
     * 
     * @returns Array of completed experiments
     */
    getCompletedExperiments(): Experiment[] {
        return this.getExperiments().filter(exp => exp.status === 'completed');
    }

    /**
     * Get experiment metrics history
     * 
     * @param experimentId - Experiment identifier
     * @returns Array of metric entries or undefined if experiment not found
     */
    getExperimentMetrics(experimentId: string): MetricEntry[] | undefined {
        const exp = this.experiments.get(experimentId);
        return exp?.metricHistory;
    }

    /**
     * Delete an experiment
     * 
     * @param experimentId - Experiment identifier
     * @returns Whether the experiment was found and deleted
     */
    deleteExperiment(experimentId: string): boolean {
        return this.experiments.delete(experimentId);
    }

    /**
     * Clear all experiments
     */
    clearExperiments(): void {
        this.experiments.clear();
    }

    // ========================================================================
    // Variable Tracking (Requirements: 2.1, 2.2, 7.1, 7.2, 7.4)
    // ========================================================================

    /**
     * Track a new variable
     * 
     * @param name - Variable name
     * @param cellId - Cell ID where variable was defined
     * @param info - Variable information from kernel
     */
    async trackVariable(
        name: string,
        cellId: string,
        info: VariableInfo
    ): Promise<void> {
        const existing = this.variables.get(name);
        
        // Get existing references or start with empty array
        const referencedBy = existing?.referencedBy || [];
        
        // Add cellId to referencedBy if not already present
        if (!referencedBy.includes(cellId)) {
            referencedBy.push(cellId);
        }

        const variable: IntrospectedVariable = {
            name: info.name,
            type: info.type,
            shape: info.shape || 'scalar',
            valuePreview: info.value,
            definedIn: existing?.definedIn || cellId,
            dependencies: existing?.dependencies || [],
            referencedBy,
        };

        this.variables.set(name, variable);
    }

    /**
     * Untrack a variable
     * 
     * @param name - Variable name to remove
     * @returns Whether the variable was found and removed
     */
    async untrackVariable(name: string): Promise<boolean> {
        return this.variables.delete(name);
    }

    /**
     * Update variable dependencies
     * 
     * @param name - Variable name
     * @param dependencies - Array of dependency variable names
     */
    async updateVariableDependencies(
        name: string,
        dependencies: string[]
    ): Promise<void> {
        const variable = this.variables.get(name);
        if (variable) {
            variable.dependencies = dependencies;
        }
    }

    /**
     * Add a cell reference to a variable
     * 
     * @param name - Variable name
     * @param cellId - Cell ID that references this variable
     */
    async addVariableReference(name: string, cellId: string): Promise<void> {
        const variable = this.variables.get(name);
        if (variable && !variable.referencedBy.includes(cellId)) {
            variable.referencedBy.push(cellId);
        }
    }

    /**
     * Get all tracked variables
     * 
     * @returns Array of all tracked variables
     */
    getVariables(): IntrospectedVariable[] {
        return Array.from(this.variables.values());
    }

    /**
     * Get a specific variable
     * 
     * @param name - Variable name
     * @returns Variable or undefined if not found
     */
    getVariable(name: string): IntrospectedVariable | undefined {
        return this.variables.get(name);
    }

    /**
     * Clear all tracked variables
     */
    clearVariables(): void {
        this.variables.clear();
    }

    // ========================================================================
    // Activity Tracking (Requirements: 2.5)
    // ========================================================================

    /**
     * Log an activity entry
     * 
     * @param type - Activity type
     * @param description - Activity description
     * @param cellId - Associated cell ID (optional)
     */
    logActivity(
        type: 'execution' | 'edit' | 'chat',
        description: string,
        cellId?: string
    ): void {
        const entry: ActivityEntry = {
            timestamp: Date.now(),
            type,
            description,
            cellId,
        };

        this.activityLog.push(entry);

        // Enforce activity limit
        if (this.activityLog.length > this.config.maxActivityEntries) {
            this.activityLog = this.activityLog.slice(-this.config.maxActivityEntries);
        }
    }

    /**
     * Get recent activity
     * 
     * @param limit - Maximum number of entries to return
     * @returns Recent activity entries
     */
    getRecentActivity(limit?: number): ActivityEntry[] {
        const count = limit || this.config.maxActivityEntries;
        return this.activityLog.slice(-count);
    }

    /**
     * Clear activity log
     */
    clearActivity(): void {
        this.activityLog = [];
    }

    /**
     * Clear activity log (alias for clearActivity)
     * 
     * Requirements: 2.5
     */
    clearActivityLog(): void {
        this.clearActivity();
    }

    /**
     * Log an execution event
     * 
     * @param cellId - Cell ID where execution occurred
     * @param description - Description of the execution
     * 
     * Requirements: 2.5
     */
    logExecution(cellId: string, description: string): void {
        this.logActivity('execution', description, cellId);
    }

    /**
     * Log an edit event
     * 
     * @param cellId - Cell ID that was edited
     * @param description - Description of the edit
     * 
     * Requirements: 2.5
     */
    logEdit(cellId: string, description: string): void {
        this.logActivity('edit', description, cellId);
    }

    /**
     * Log a chat event
     * 
     * @param description - Description of the chat event
     * 
     * Requirements: 2.5
     */
    logChatEvent(description: string): void {
        this.logActivity('chat', description);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Get the current notebook ID
     * 
     * @returns Notebook identifier
     */
    getNotebookId(): string {
        return this.config.notebookId;
    }

    /**
     * Get the last refresh timestamp
     * 
     * @returns Timestamp of last refresh
     */
    getLastRefresh(): number {
        return this.lastRefresh;
    }

    /**
     * Get the number of tracked variables
     * 
     * @returns Variable count
     */
    getVariableCount(): number {
        return this.variables.size;
    }

    /**
     * Get the number of experiments
     * 
     * @returns Experiment count
     */
    getExperimentCount(): number {
        return this.experiments.size;
    }

    /**
     * Clear all introspection data
     */
    clear(): void {
        this.variables.clear();
        this.experiments.clear();
        this.activityLog = [];
        this.executionOrder = [];
        this.cellCount = 0;
        this.lastRefresh = 0;
        
        // Reset execution context
        this.executionContext = {
            currentCell: null,
            executionCount: 0,
            kernelStatus: 'idle',
            lastExecutionTime: 0,
        };
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Update variables from kernel introspection
     */
    private updateVariables(variables: VariableInfo[]): void {
        for (const info of variables) {
            const existing = this.variables.get(info.name);
            
            if (existing) {
                // Update existing variable
                existing.type = info.type;
                existing.shape = info.shape || existing.shape;
                existing.valuePreview = info.value;
            } else {
                // Add new variable
                this.variables.set(info.name, {
                    name: info.name,
                    type: info.type,
                    shape: info.shape || 'scalar',
                    valuePreview: info.value,
                    definedIn: 'unknown',
                    dependencies: [],
                    referencedBy: [],
                });
            }
        }
    }

    /**
     * Get experiments in introspected format
     */
    private getIntrospectedExperiments(): IntrospectedExperiment[] {
        return Array.from(this.experiments.values()).map(exp => ({
            id: exp.id,
            name: exp.name,
            description: exp.description,
            cells: exp.cells,
            status: exp.status,
            metrics: { ...exp.metrics },
        }));
    }

    /**
     * Enforce maximum experiment limit
     */
    private enforceExperimentLimit(): void {
        if (this.experiments.size > this.config.maxExperiments) {
            // Remove oldest experiments
            const entries = Array.from(this.experiments.entries());
            entries.sort((a, b) => a[1].startedAt - b[1].startedAt);
            
            const toRemove = entries.slice(0, this.experiments.size - this.config.maxExperiments);
            for (const [id] of toRemove) {
                this.experiments.delete(id);
            }
        }
    }

    /**
     * Generate a unique experiment ID
     */
    private generateExperimentId(): string {
        return `exp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
}