/**
 * UIStateAdapter Tests
 * 
 * Tests for UI state transformation and formatting.
 * 
 * Requirements: 4.3, 7.3, 8.5, 3.1
 */

import { UIStateAdapter } from './UIStateAdapter';
import type {
    AgentState,
    RichVariable,
    Experiment,
    ChatMessage,
} from './types/agent.types';

describe('UIStateAdapter', () => {
    let adapter: UIStateAdapter;

    beforeEach(() => {
        adapter = new UIStateAdapter();
    });

    describe('transformAgentStateToUIState', () => {
        it('should transform agent state to UI state', () => {
            const agentState: AgentState = {
                v: '1.0',
                ts: Date.now(),
                nb: 'test-notebook',
                m: 'ASK',
                vars: [
                    { n: 'df', t: 'DataFrame', s: '(100, 5)', v: 'DataFrame preview', r: 3 },
                    { n: 'model', t: 'RandomForest', s: 'n_estimators=100', v: 'fitted', r: 2 },
                ],
                exec: ['cell-1', 'cell-2'],
                exps: [
                    { id: 'exp-1', ts: Date.now(), cell: 'cell-1', desc: 'baseline', status: 'success' },
                ],
                errs: [],
                active: [],
            };

            const uiState = adapter.transformAgentStateToUIState(agentState);

            expect(uiState.kernelStatus).toBe('idle');
            expect(uiState.variables).toHaveLength(2);
            expect(uiState.experiments).toHaveLength(1);
            expect(uiState.cellStates).toHaveProperty('cell-1');
            expect(uiState.cellStates).toHaveProperty('cell-2');
        });

        it('should set kernel status to busy when active cells exist', () => {
            const agentState: AgentState = {
                v: '1.0',
                ts: Date.now(),
                nb: 'test-notebook',
                m: 'AGENT',
                vars: [],
                exec: [],
                exps: [],
                errs: [],
                active: ['cell-1'],
            };

            const uiState = adapter.transformAgentStateToUIState(agentState);

            expect(uiState.kernelStatus).toBe('busy');
        });

        it('should set kernel status to error when errors exist', () => {
            const agentState: AgentState = {
                v: '1.0',
                ts: Date.now(),
                nb: 'test-notebook',
                m: 'AGENT',
                vars: [],
                exec: [],
                exps: [],
                errs: ['Error in cell-1'],
                active: [],
            };

            const uiState = adapter.transformAgentStateToUIState(agentState);

            expect(uiState.kernelStatus).toBe('error');
        });

        it('should generate suggestions based on state', () => {
            const agentState: AgentState = {
                v: '1.0',
                ts: Date.now(),
                nb: 'test-notebook',
                m: 'ASK',
                vars: [],
                exec: [],
                exps: [],
                errs: [],
                active: [],
            };

            const uiState = adapter.transformAgentStateToUIState(agentState);

            expect(uiState.suggestions).toContain('Load data to get started');
        });
    });

    describe('formatVariablesForDisplay', () => {
        it('should format variables for display', () => {
            const variables: RichVariable[] = [
                {
                    id: 'var-1',
                    name: 'df',
                    type: 'DataFrame',
                    shape: '100 rows × 5 columns',
                    value: { head: 'data' },
                    preview: '   col1  col2\n0     1     2',
                    dependencies: ['cell-1'],
                    referencedBy: ['cell-2', 'cell-3'],
                    createdAt: 1699012000000,
                    updatedAt: 1699012345000,
                },
            ];

            const displayVars = adapter.formatVariablesForDisplay(variables);

            expect(displayVars).toHaveLength(1);
            expect(displayVars[0].id).toBe('var-1');
            expect(displayVars[0].name).toBe('df');
            expect(displayVars[0].type).toBe('DataFrame');
            expect(displayVars[0].shape).toBe('100 rows × 5 columns');
            expect(displayVars[0].preview).toBe('   col1  col2\n0     1     2');
            expect(displayVars[0].dependencies).toEqual(['cell-1']);
            expect(displayVars[0].referencedBy).toEqual(['cell-2', 'cell-3']);
            expect(displayVars[0].referenceCount).toBe(2);
        });

        it('should handle empty variables array', () => {
            const displayVars = adapter.formatVariablesForDisplay([]);

            expect(displayVars).toHaveLength(0);
        });

        it('should calculate reference count from referencedBy length', () => {
            const variables: RichVariable[] = [
                {
                    id: 'var-1',
                    name: 'x',
                    type: 'int',
                    shape: 'scalar',
                    value: 42,
                    preview: '42',
                    dependencies: [],
                    referencedBy: ['cell-1', 'cell-2', 'cell-3', 'cell-4'],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                },
            ];

            const displayVars = adapter.formatVariablesForDisplay(variables);

            expect(displayVars[0].referenceCount).toBe(4);
        });
    });

    describe('formatExperimentsForComparison', () => {
        it('should format experiments for comparison', () => {
            const experiments: Experiment[] = [
                {
                    id: 'exp-1',
                    name: 'Baseline Model',
                    description: 'Initial RandomForest with default params',
                    cells: ['cell-1'],
                    status: 'completed',
                    metrics: { accuracy: 0.85, f1: 0.82 },
                    startedAt: 1699012000000,
                    endedAt: 1699013000000,
                },
                {
                    id: 'exp-2',
                    name: 'Optimized Model',
                    description: 'RandomForest with tuned hyperparameters',
                    cells: ['cell-2'],
                    status: 'completed',
                    metrics: { accuracy: 0.89, f1: 0.86 },
                    startedAt: 1699014000000,
                    endedAt: 1699015000000,
                },
            ];

            const comparison = adapter.formatExperimentsForComparison(experiments);

            expect(comparison.experiments).toHaveLength(2);
            expect(comparison.metrics).toContain('accuracy');
            expect(comparison.metrics).toContain('f1');
            expect(comparison.bestValues['accuracy'].experimentId).toBe('exp-2');
            expect(comparison.bestValues['f1'].experimentId).toBe('exp-2');
        });

        it('should handle running experiments', () => {
            const experiments: Experiment[] = [
                {
                    id: 'exp-1',
                    name: 'Running Experiment',
                    description: 'Currently running',
                    cells: ['cell-1'],
                    status: 'active',
                    metrics: { loss: 0.5 },
                    startedAt: Date.now() - 60000,
                    endedAt: undefined,
                },
            ];

            const comparison = adapter.formatExperimentsForComparison(experiments);

            expect(comparison.experiments[0].status).toBe('active');
            expect(comparison.experiments[0].duration).toMatch(/\d+s/);
        });

        it('should handle empty experiments array', () => {
            const comparison = adapter.formatExperimentsForComparison([]);

            expect(comparison.experiments).toHaveLength(0);
            expect(comparison.metrics).toHaveLength(0);
            expect(comparison.bestValues).toEqual({});
        });

        it('should calculate best values correctly', () => {
            const experiments: Experiment[] = [
                {
                    id: 'exp-1',
                    name: 'Exp 1',
                    description: '',
                    cells: [],
                    status: 'completed',
                    metrics: { score: 0.75 },
                    startedAt: Date.now(),
                    endedAt: Date.now(),
                },
                {
                    id: 'exp-2',
                    name: 'Exp 2',
                    description: '',
                    cells: [],
                    status: 'completed',
                    metrics: { score: 0.92 },
                    startedAt: Date.now(),
                    endedAt: Date.now(),
                },
            ];

            const comparison = adapter.formatExperimentsForComparison(experiments);

            expect(comparison.bestValues['score'].experimentId).toBe('exp-2');
            expect(comparison.bestValues['score'].value).toBe(0.92);
        });
    });

    describe('formatChatHistoryForDisplay', () => {
        it('should format chat messages for display', () => {
            const messages: ChatMessage[] = [
                {
                    id: 'msg-1',
                    role: 'user',
                    content: 'Hello, can you help me?',
                    timestamp: 1699012000000,
                    tokenCount: 10,
                },
                {
                    id: 'msg-2',
                    role: 'assistant',
                    content: 'Of course! How can I help?',
                    timestamp: 1699012100000,
                    tokenCount: 8,
                },
            ];

            const displayMessages = adapter.formatChatHistoryForDisplay(messages);

            expect(displayMessages).toHaveLength(2);
            expect(displayMessages[0].id).toBe('msg-1');
            expect(displayMessages[0].role).toBe('user');
            expect(displayMessages[0].content).toBe('Hello, can you help me?');
            expect(displayMessages[0].tokenCount).toBe(10);
            expect(displayMessages[1].role).toBe('assistant');
        });

        it('should handle system messages as summaries', () => {
            const messages: ChatMessage[] = [
                {
                    id: 'msg-1',
                    role: 'system',
                    content: 'Conversation summary',
                    timestamp: Date.now(),
                    tokenCount: 50,
                    summary: 'This is a summary',
                },
            ];

            const displayMessages = adapter.formatChatHistoryForDisplay(messages);

            expect(displayMessages[0].isSummary).toBe(true);
        });

        it('should handle empty messages array', () => {
            const displayMessages = adapter.formatChatHistoryForDisplay([]);

            expect(displayMessages).toHaveLength(0);
        });

        it('should include summary when present', () => {
            const messages: ChatMessage[] = [
                {
                    id: 'msg-1',
                    role: 'user',
                    content: 'Long message content...',
                    timestamp: Date.now(),
                    tokenCount: 100,
                    summary: 'User asked about data analysis',
                },
            ];

            const displayMessages = adapter.formatChatHistoryForDisplay(messages);

            expect(displayMessages[0].summary).toBe('User asked about data analysis');
        });
    });

    describe('Integration Tests', () => {
        it('should handle full agent state transformation', () => {
            const agentState: AgentState = {
                v: '1.0',
                ts: Date.now(),
                nb: 'test-notebook',
                m: 'AGENTIC',
                vars: [
                    { n: 'data', t: 'DataFrame', s: '(1000, 10)', v: 'DataFrame(...)', r: 5 },
                    { n: 'result', t: 'ndarray', s: '(100,)', v: 'array([...])', r: 2 },
                ],
                exec: ['cell-1', 'cell-2', 'cell-3'],
                exps: [
                    { id: 'exp-1', ts: Date.now() - 100000, cell: 'cell-2', desc: 'baseline', status: 'success' },
                    { id: 'exp-2', ts: Date.now(), cell: 'cell-3', desc: 'tuned', status: 'running' },
                ],
                errs: [],
                active: [],
            };

            const uiState = adapter.transformAgentStateToUIState(agentState);

            // Verify all components are present
            expect(uiState.variables).toHaveLength(2);
            expect(uiState.experiments).toHaveLength(2);
            expect(uiState.cellStates).toHaveProperty('cell-1');
            expect(uiState.cellStates).toHaveProperty('cell-2');
            expect(uiState.cellStates).toHaveProperty('cell-3');
            expect(uiState.executionHistory).toHaveLength(3);
        });

        it('should format transformed data correctly', () => {
            const agentState: AgentState = {
                v: '1.0',
                ts: Date.now(),
                nb: 'test-notebook',
                m: 'ASK',
                vars: [
                    { n: 'x', t: 'int', r: 1 },
                ],
                exec: [],
                exps: [],
                errs: [],
                active: [],
            };

            const uiState = adapter.transformAgentStateToUIState(agentState);
            const displayVars = adapter.formatVariablesForDisplay(uiState.variables);

            expect(displayVars[0].shape).toBe('scalar');
            expect(displayVars[0].preview).toBe('');
        });
    });
});