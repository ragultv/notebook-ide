/**
 * UI State Adapter
 * 
 * Transforms agent state to UI state format for frontend visualization.
 * 
 * Requirements: 4.3, 7.3, 8.5, 3.1
 */

import type {
    AgentState,
    UIState,
    RichVariable,
    Experiment,
    ChatMessage,
    CompactVariable,
    ExperimentEntry,
    CellState,
    ExecutionHistoryEntry,
} from './types/agent.types';

/**
 * Display variable format for frontend
 * Simplified view with dependency information
 */
export interface DisplayVariable {
    id: string;
    name: string;
    type: string;
    shape: string;
    preview: string;
    dependencies: string[];
    referencedBy: string[];
    createdAt: string;
    updatedAt: string;
    referenceCount: number;
}

/**
 * Experiment comparison data for side-by-side view
 */
export interface ExperimentComparisonData {
    experiments: ExperimentComparisonRow[];
    metrics: string[];
    bestValues: Record<string, { experimentId: string; value: number }>;
}

/**
 * Single experiment row for comparison table
 */
export interface ExperimentComparisonRow {
    id: string;
    name: string;
    description: string;
    status: 'active' | 'completed' | 'failed';
    startedAt: string;
    duration: string;
    metrics: Record<string, number>;
    cellCount: number;
}

/**
 * Display chat message format for frontend
 */
export interface DisplayChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    formattedTime: string;
    tokenCount: number;
    summary?: string;
    isSummary?: boolean;
}

/**
 * UI State Adapter
 * 
 * Transforms agent state to UI state format for frontend visualization.
 * Handles variable display with dependencies, experiment comparison view,
 * and chat history formatting.
 */
export class UIStateAdapter {
    /**
     * Transform AgentState to UIState format
     * 
     * @param agentState - The compact agent state
     * @returns Rich UI state for frontend
     * 
     * Requirements: 4.3
     */
    transformAgentStateToUIState(agentState: AgentState): UIState {
        return {
            kernelStatus: this.determineKernelStatus(agentState),
            variables: this.transformVariables(agentState.vars),
            executionHistory: this.transformExecutionHistory(agentState),
            experiments: this.transformExperiments(agentState.exps),
            cellStates: this.initializeCellStates(agentState.exec),
            chatHistory: [],
            suggestions: this.generateSuggestions(agentState),
        };
    }

    /**
     * Format variables for display with dependencies
     * 
     * @param variables - Rich variables to format
     * @returns Display variables for frontend
     * 
     * Requirements: 7.3
     */
    formatVariablesForDisplay(variables: RichVariable[]): DisplayVariable[] {
        return variables.map((v) => ({
            id: v.id,
            name: v.name,
            type: v.type,
            shape: v.shape,
            preview: v.preview,
            dependencies: v.dependencies,
            referencedBy: v.referencedBy,
            createdAt: new Date(v.createdAt).toISOString(),
            updatedAt: new Date(v.updatedAt).toISOString(),
            referenceCount: v.referencedBy.length,
        }));
    }

    /**
     * Format experiments for comparison view
     * 
     * @param experiments - Experiments to format
     * @returns Comparison data for UI
     * 
     * Requirements: 8.5
     */
    formatExperimentsForComparison(experiments: Experiment[]): ExperimentComparisonData {
        const metrics = new Set<string>();
        const experimentRows: ExperimentComparisonRow[] = experiments.map((exp) => {
            Object.keys(exp.metrics).forEach((m) => metrics.add(m));
            const duration = exp.endedAt
                ? this.calculateDuration(exp.startedAt, exp.endedAt)
                : this.calculateDuration(exp.startedAt, Date.now());

            return {
                id: exp.id,
                name: exp.name,
                description: exp.description,
                status: exp.status,
                startedAt: new Date(exp.startedAt).toLocaleString(),
                duration,
                metrics: exp.metrics,
                cellCount: exp.cells.length,
            };
        });

        const bestValues: Record<string, { experimentId: string; value: number }> = {};
        const metricArray = Array.from(metrics);

        for (const metric of metricArray) {
            let bestExp: ExperimentComparisonRow | null = null;
            let bestValue = -Infinity;

            for (const exp of experimentRows) {
                const value = exp.metrics[metric];
                if (value !== undefined && value > bestValue) {
                    bestValue = value;
                    bestExp = exp;
                }
            }

            if (bestExp) {
                bestValues[metric] = { experimentId: bestExp.id, value: bestValue };
            }
        }

        return {
            experiments: experimentRows,
            metrics: metricArray,
            bestValues,
        };
    }

    /**
     * Format chat history for frontend display
     * 
     * @param messages - Chat messages to format
     * @returns Display chat messages
     * 
     * Requirements: 3.1
     */
    formatChatHistoryForDisplay(messages: ChatMessage[]): DisplayChatMessage[] {
        return messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
            formattedTime: this.formatTimestamp(msg.timestamp),
            tokenCount: msg.tokenCount,
            summary: msg.summary,
            isSummary: msg.role === 'system',
        }));
    }

    // =========================================================================
    // Private Helper Methods
    // =========================================================================

    /**
     * Determine kernel status from agent state
     */
    private determineKernelStatus(agentState: AgentState): UIState['kernelStatus'] {
        if (agentState.active.length > 0) {
            return 'busy';
        }
        if (agentState.errs.length > 0) {
            return 'error';
        }
        return 'idle';
    }

    /**
     * Transform compact variables to rich variables
     */
    private transformVariables(compactVars: CompactVariable[]): RichVariable[] {
        const now = Date.now();
        return compactVars.map((cv, index) => ({
            id: `var-${index}`,
            name: cv.n,
            type: cv.t,
            shape: cv.s || 'scalar',
            value: cv.v,
            preview: cv.v || '',
            dependencies: [],
            referencedBy: [],
            createdAt: now,
            updatedAt: now,
        }));
    }

    /**
     * Transform experiment entries to experiments
     */
    private transformExperiments(entries: ExperimentEntry[]): Experiment[] {
        return entries.map((entry) => ({
            id: entry.id,
            name: `Experiment ${entry.id}`,
            description: entry.desc,
            cells: [entry.cell],
            status: this.mapExperimentStatus(entry.status),
            metrics: {},
            startedAt: entry.ts,
            endedAt: entry.status !== 'running' ? Date.now() : undefined,
        }));
    }

    /**
     * Map experiment entry status to experiment status
     */
    private mapExperimentStatus(
        status: 'running' | 'success' | 'error'
    ): Experiment['status'] {
        switch (status) {
            case 'running':
                return 'active';
            case 'success':
                return 'completed';
            case 'error':
                return 'failed';
        }
    }

    /**
     * Initialize cell states from execution order
     */
    private initializeCellStates(execOrder: string[]): Record<string, CellState> {
        const states: Record<string, CellState> = {};
        for (const cellId of execOrder) {
            states[cellId] = {
                status: 'pending',
                executionCount: 0,
            };
        }
        return states;
    }

    /**
     * Transform execution history from agent state
     */
    private transformExecutionHistory(agentState: AgentState): ExecutionHistoryEntry[] {
        return agentState.exec.map((cellId, index) => ({
            cellId,
            timestamp: Date.now() - (agentState.exec.length - index) * 1000,
            executionTime: 0.1 * (index + 1),
            status: agentState.errs.length > index ? 'error' : 'success',
            output: `Cell ${cellId} output`,
        }));
    }

    /**
     * Generate suggestions based on agent state
     */
    private generateSuggestions(agentState: AgentState): string[] {
        const suggestions: string[] = [];

        if (agentState.vars.length === 0) {
            suggestions.push('Load data to get started');
        }

        if (agentState.exps.length > 0) {
            suggestions.push('Compare experiment metrics');
        }

        if (agentState.errs.length > 0) {
            suggestions.push('Review and fix errors');
        }

        return suggestions;
    }

    /**
     * Calculate duration between timestamps
     */
    private calculateDuration(startedAt: number, endedAt: number): string {
        const durationMs = endedAt - startedAt;
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }

    /**
     * Format timestamp for display
     */
    private formatTimestamp(timestamp: number): string {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 0) {
            return `${diffDays}d ago`;
        }
        if (diffHours > 0) {
            return `${diffHours}h ago`;
        }
        if (diffMins > 0) {
            return `${diffMins}m ago`;
        }
        return 'Just now';
    }
}

/**
 * Default UI state adapter instance
 */
export const uiStateAdapter = new UIStateAdapter();