/**
 * StateManager Tests
 * 
 * Tests for dual state management, polling mechanism, and change detection
 */

import { StateManager, createStateManager } from './StateManager';
import { IntrospectionJSON } from '../types/agent.types';

describe('StateManager', () => {
    let stateManager: StateManager;

    beforeEach(() => {
        stateManager = createStateManager('test-notebook-123');
    });

    describe('Initialization', () => {
        it('should initialize with default config', () => {
            expect(stateManager.getNotebookId()).toBe('test-notebook-123');
            expect(stateManager.getPollingInterval()).toBeNull();
            expect(stateManager.isPolling()).toBe(false);
        });

        it('should initialize with custom config', () => {
            const sm = createStateManager('test-notebook', {
                pollingInterval: 1000,
                maxRecentErrors: 5,
                maxExperiments: 10,
            });
            expect(sm.getNotebookId()).toBe('test-notebook');
        });

        it('should return initial agent state', () => {
            const agentState = stateManager.getAgentState();
            expect(agentState.v).toBe('1.0');
            expect(agentState.nb).toBe('test-notebook-123');
            expect(agentState.m).toBe('ASK');
            expect(agentState.vars).toEqual([]);
            expect(agentState.exec).toEqual([]);
        });

        it('should return initial UI state', () => {
            const uiState = stateManager.getUIState();
            expect(uiState.kernelStatus).toBe('idle');
            expect(uiState.variables).toEqual([]);
            expect(uiState.executionHistory).toEqual([]);
        });
    });

    describe('Polling Control', () => {
        it('should start polling with default interval', () => {
            stateManager.startPolling();
            expect(stateManager.isPolling()).toBe(true);
            expect(stateManager.getPollingInterval()).toBe(500);
            stateManager.stopPolling();
        });

        it('should start polling with custom interval', () => {
            stateManager.startPolling(1000);
            expect(stateManager.isPolling()).toBe(true);
            expect(stateManager.getPollingInterval()).toBe(1000);
            stateManager.stopPolling();
        });

        it('should stop polling', () => {
            stateManager.startPolling();
            expect(stateManager.isPolling()).toBe(true);
            stateManager.stopPolling();
            expect(stateManager.isPolling()).toBe(false);
        });

        it('should handle multiple start calls', () => {
            stateManager.startPolling(500);
            stateManager.startPolling(1000);
            expect(stateManager.getPollingInterval()).toBe(1000);
            stateManager.stopPolling();
        });
    });

    describe('detectChanges', () => {
        it('should detect changes when old state is null', () => {
            const newState = createMockIntrospection();
            const result = stateManager.detectChanges(null, newState);
            expect(result).toBe(true);
        });

        it('should detect variable value changes', () => {
            const oldState = createMockIntrospection({ varValue: 'old-value' });
            const newState = createMockIntrospection({ varValue: 'new-value' });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should detect variable shape changes', () => {
            const oldState = createMockIntrospection({ varShape: '(100, 5)' });
            const newState = createMockIntrospection({ varShape: '(200, 10)' });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should detect new variables', () => {
            const oldState = createMockIntrospection({ varCount: 1 });
            const newState = createMockIntrospection({ varCount: 2 });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should detect execution order changes', () => {
            const oldState = createMockIntrospection({ execOrder: ['cell-1', 'cell-2'] });
            const newState = createMockIntrospection({ execOrder: ['cell-1', 'cell-2', 'cell-3'] });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should detect experiment status changes', () => {
            const oldState = createMockIntrospection({ expStatus: 'active' });
            const newState = createMockIntrospection({ expStatus: 'completed' });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should detect kernel status changes', () => {
            const oldState = createMockIntrospection({ kernelStatus: 'idle' });
            const newState = createMockIntrospection({ kernelStatus: 'busy' });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should not detect changes for identical states', () => {
            const state = createMockIntrospection();
            const result = stateManager.detectChanges(state, state);
            expect(result).toBe(false);
        });

        it('should detect experiment metric changes', () => {
            const oldState = createMockIntrospection({ metrics: { accuracy: 0.85 } });
            const newState = createMockIntrospection({ metrics: { accuracy: 0.90 } });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });

        it('should detect current cell changes', () => {
            const oldState = createMockIntrospection({ currentCell: null });
            const newState = createMockIntrospection({ currentCell: 'cell-1' });
            const result = stateManager.detectChanges(oldState, newState);
            expect(result).toBe(true);
        });
    });

    describe('State Subscriptions', () => {
        it('should notify subscribers on state changes', async () => {
            const subscriber = jest.fn();
            const unsubscribe = stateManager.subscribe(subscriber);

            await stateManager.updateAgentState({ m: 'AGENT' });
            expect(subscriber).toHaveBeenCalledWith(
                expect.objectContaining({ agent: expect.any(Object) })
            );

            unsubscribe();
        });

        it('should allow unsubscribing', async () => {
            const subscriber = jest.fn();
            const unsubscribe = stateManager.subscribe(subscriber);
            unsubscribe();

            await stateManager.updateAgentState({ m: 'AGENT' });
            expect(subscriber).not.toHaveBeenCalled();
        });
    });

    describe('Atomic Updates', () => {
        it('should update both states atomically', async () => {
            await stateManager.atomicUpdate(
                { m: 'AGENT' },
                { kernelStatus: 'busy' }
            );

            const agentState = stateManager.getAgentState();
            const uiState = stateManager.getUIState();

            expect(agentState.m).toBe('AGENT');
            expect(uiState.kernelStatus).toBe('busy');
        });
    });

    describe('Serialization', () => {
        it('should serialize to system prompt format', () => {
            const prompt = stateManager.toSystemPrompt();
            const parsed = JSON.parse(prompt);
            expect(parsed.v).toBe('1.0');
            expect(parsed.nb).toBe('test-notebook-123');
        });

        it('should serialize to JSON format', () => {
            const json = stateManager.toJSON();
            const parsed = JSON.parse(json);
            expect(parsed.agent).toBeDefined();
            expect(parsed.ui).toBeDefined();
        });
    });
});

// Helper function to create mock introspection data
function createMockIntrospection(options: {
    varValue?: string;
    varShape?: string;
    varCount?: number;
    execOrder?: string[];
    expStatus?: 'active' | 'completed' | 'failed';
    kernelStatus?: 'idle' | 'busy' | 'error' | 'disconnected';
    currentCell?: string | null;
    metrics?: Record<string, number>;
} = {}): IntrospectionJSON {
    const varCount = options.varCount ?? 1;
    const variables = Array.from({ length: varCount }, (_, i) => ({
        name: `var${i}`,
        type: 'DataFrame',
        shape: options.varShape ?? '(100, 10)',
        valuePreview: options.varValue ?? 'preview',
        definedIn: 'cell-1',
        dependencies: [],
        referencedBy: [],
    }));

    return {
        version: '1.0',
        generatedAt: Date.now(),
        notebook: {
            id: 'test-notebook',
            cellCount: 3,
            executionOrder: options.execOrder ?? ['cell-1', 'cell-2', 'cell-3'],
        },
        variables,
        experiments: [
            {
                id: 'exp-1',
                name: 'Test Experiment',
                description: 'Test description',
                cells: ['cell-1'],
                status: options.expStatus ?? 'active',
                metrics: options.metrics ?? {},
            },
        ],
        executionContext: {
            currentCell: options.currentCell ?? null,
            executionCount: 5,
            kernelStatus: options.kernelStatus ?? 'idle',
            lastExecutionTime: 1.5,
        },
        recentActivity: [
            {
                timestamp: Date.now(),
                type: 'execution',
                description: 'Executed cell-1',
                cellId: 'cell-1',
            },
        ],
    };
}