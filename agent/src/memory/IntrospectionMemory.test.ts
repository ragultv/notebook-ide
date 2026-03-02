/**
 * Unit tests for IntrospectionMemory class
 * 
 * Tests variable tracking, experiment management, and introspection JSON generation.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.5, 7.1, 7.2, 7.4, 8.1, 8.2, 8.3, 8.4
 */

import { IntrospectionMemory } from './IntrospectionMemory';
import { IntrospectionJSON, VariableInfo } from '../types/agent.types';

describe('IntrospectionMemory', () => {
    let introspectionMemory: IntrospectionMemory;
    const defaultConfig = {
        notebookId: 'test-notebook-123',
        maxExperiments: 10,
        maxActivityEntries: 100,
        refreshInterval: 500,
    };

    beforeEach(() => {
        introspectionMemory = new IntrospectionMemory(defaultConfig);
    });

    describe('constructor', () => {
        it('should initialize with provided config', () => {
            expect(introspectionMemory.getNotebookId()).toBe('test-notebook-123');
        });

        it('should start with empty experiments', () => {
            expect(introspectionMemory.getExperiments()).toEqual([]);
        });

        it('should start with empty variables', () => {
            expect(introspectionMemory.getVariables()).toEqual([]);
        });
    });

    describe('getJSON', () => {
        it('should return valid introspection JSON', async () => {
            const json = await introspectionMemory.getJSON();

            expect(json.version).toBe('1.0');
            expect(json.generatedAt).toBeGreaterThan(0);
            expect(json.notebook.id).toBe('test-notebook-123');
            expect(json.notebook.cellCount).toBe(0);
            expect(json.notebook.executionOrder).toEqual([]);
            expect(json.variables).toEqual([]);
            expect(json.experiments).toEqual([]);
            expect(json.executionContext).toBeDefined();
            expect(json.recentActivity).toEqual([]);
        });

        it('should include experiments in JSON', async () => {
            await introspectionMemory.startExperiment('Test Experiment', 'Test description', ['cell-1']);

            const json = await introspectionMemory.getJSON();

            expect(json.experiments.length).toBe(1);
            expect(json.experiments[0].name).toBe('Test Experiment');
            expect(json.experiments[0].status).toBe('active');
        });

        it('should include variables in JSON', async () => {
            const variables: VariableInfo[] = [
                { name: 'df', type: 'DataFrame', shape: '(100, 5)', value: 'DataFrame preview', references: 2 },
            ];

            await introspectionMemory.refresh(variables, ['cell-1'], 1);

            const json = await introspectionMemory.getJSON();

            expect(json.variables.length).toBe(1);
            expect(json.variables[0].name).toBe('df');
            expect(json.variables[0].type).toBe('DataFrame');
        });

        it('should include execution context in JSON', async () => {
            introspectionMemory.updateExecutionContext({
                currentCell: 'cell-1',
                executionCount: 5,
                kernelStatus: 'busy',
            });

            const json = await introspectionMemory.getJSON();

            expect(json.executionContext.currentCell).toBe('cell-1');
            expect(json.executionContext.executionCount).toBe(5);
            expect(json.executionContext.kernelStatus).toBe('busy');
        });
    });

    describe('refresh', () => {
        it('should update variables from kernel', async () => {
            const variables: VariableInfo[] = [
                { name: 'x', type: 'int', value: '42', references: 1 },
                { name: 'data', type: 'list', shape: '(100,)', value: '[1, 2, 3...]', references: 3 },
            ];

            await introspectionMemory.refresh(variables, ['cell-1', 'cell-2'], 2);

            const json = await introspectionMemory.getJSON();

            expect(json.variables.length).toBe(2);
            expect(json.variables[0].name).toBe('x');
            expect(json.variables[1].name).toBe('data');
        });

        it('should update execution order', async () => {
            await introspectionMemory.refresh([], ['cell-1', 'cell-2', 'cell-3'], 3);

            const json = await introspectionMemory.getJSON();

            expect(json.notebook.executionOrder).toEqual(['cell-1', 'cell-2', 'cell-3']);
            expect(json.notebook.cellCount).toBe(3);
        });

        it('should update execution count', async () => {
            await introspectionMemory.refresh([], ['cell-1', 'cell-2'], 2);

            const json = await introspectionMemory.getJSON();

            expect(json.executionContext.executionCount).toBe(2);
        });
    });

    // ========================================================================
    // Experiment Management Tests (Requirements: 8.1, 8.2, 8.3, 8.4)
    // ========================================================================

    describe('startExperiment', () => {
        it('should create a new experiment and return ID', async () => {
            const experimentId = await introspectionMemory.startExperiment(
                'Baseline Model',
                'Initial model with default parameters',
                ['cell-2', 'cell-3']
            );

            expect(experimentId).toBeDefined();
            expect(experimentId).toMatch(/^exp_\d+_[a-z0-9]+$/);
        });

        it('should store experiment with all fields', async () => {
            const experimentId = await introspectionMemory.startExperiment(
                'Test Experiment',
                'Testing new approach',
                ['cell-1']
            );

            const experiment = introspectionMemory.getExperiment(experimentId);

            expect(experiment).toBeDefined();
            expect(experiment!.id).toBe(experimentId);
            expect(experiment!.name).toBe('Test Experiment');
            expect(experiment!.description).toBe('Testing new approach');
            expect(experiment!.cells).toEqual(['cell-1']);
            expect(experiment!.status).toBe('active');
            expect(experiment!.metrics).toEqual({});
            expect(experiment!.startedAt).toBeGreaterThan(0);
            expect(experiment!.endedAt).toBeUndefined();
        });

        it('should log activity when experiment starts', async () => {
            await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const json = await introspectionMemory.getJSON();

            expect(json.recentActivity.length).toBeGreaterThan(0);
            expect(json.recentActivity[json.recentActivity.length - 1].description).toContain('Started experiment');
        });

        it('should allow multiple experiments', async () => {
            await introspectionMemory.startExperiment('Experiment 1', 'First', ['cell-1']);
            await introspectionMemory.startExperiment('Experiment 2', 'Second', ['cell-2']);
            await introspectionMemory.startExperiment('Experiment 3', 'Third', ['cell-3']);

            expect(introspectionMemory.getExperiments()).toHaveLength(3);
        });
    });

    describe('endExperiment', () => {
        it('should update experiment status to completed', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const result = await introspectionMemory.endExperiment(experimentId, 'completed');

            expect(result).toBe(true);

            const experiment = introspectionMemory.getExperiment(experimentId);
            expect(experiment!.status).toBe('completed');
            expect(experiment!.endedAt).toBeGreaterThan(0);
        });

        it('should update experiment status to failed', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const result = await introspectionMemory.endExperiment(experimentId, 'failed');

            expect(result).toBe(true);

            const experiment = introspectionMemory.getExperiment(experimentId);
            expect(experiment!.status).toBe('failed');
        });

        it('should return false for non-existent experiment', async () => {
            const result = await introspectionMemory.endExperiment('non-existent-id', 'completed');

            expect(result).toBe(false);
        });

        it('should log activity when experiment ends', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);
            await introspectionMemory.endExperiment(experimentId, 'completed');

            const json = await introspectionMemory.getJSON();

            const endActivity = json.recentActivity.find(a => a.description.includes('Ended experiment'));
            expect(endActivity).toBeDefined();
        });
    });

    describe('logMetric', () => {
        it('should log a single metric', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const result = await introspectionMemory.logMetric(experimentId, 'accuracy', 0.85);

            expect(result).toBe(true);

            const experiment = introspectionMemory.getExperiment(experimentId);
            expect(experiment!.metrics).toEqual({ accuracy: 0.85 });
        });

        it('should log multiple metrics', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            await introspectionMemory.logMetric(experimentId, 'accuracy', 0.85);
            await introspectionMemory.logMetric(experimentId, 'f1_score', 0.82);
            await introspectionMemory.logMetric(experimentId, 'precision', 0.88);

            const experiment = introspectionMemory.getExperiment(experimentId);
            expect(experiment!.metrics).toEqual({
                accuracy: 0.85,
                f1_score: 0.82,
                precision: 0.88,
            });
        });

        it('should overwrite metric with same key', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            await introspectionMemory.logMetric(experimentId, 'accuracy', 0.80);
            await introspectionMemory.logMetric(experimentId, 'accuracy', 0.90);

            const experiment = introspectionMemory.getExperiment(experimentId);
            expect(experiment!.metrics.accuracy).toBe(0.90);
        });

        it('should return false for non-existent experiment', async () => {
            const result = await introspectionMemory.logMetric('non-existent-id', 'accuracy', 0.85);

            expect(result).toBe(false);
        });

        it('should track metric history', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            await introspectionMemory.logMetric(experimentId, 'accuracy', 0.80);
            await introspectionMemory.logMetric(experimentId, 'accuracy', 0.85);
            await introspectionMemory.logMetric(experimentId, 'accuracy', 0.90);

            const history = introspectionMemory.getExperimentMetrics(experimentId);

            expect(history).toBeDefined();
            expect(history!.length).toBe(3);
            expect(history![0].value).toBe(0.80);
            expect(history![1].value).toBe(0.85);
            expect(history![2].value).toBe(0.90);
        });
    });

    describe('logMetrics', () => {
        it('should log multiple metrics at once', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const result = await introspectionMemory.logMetrics(experimentId, {
                accuracy: 0.85,
                f1_score: 0.82,
                precision: 0.88,
                recall: 0.79,
            });

            expect(result).toBe(true);

            const experiment = introspectionMemory.getExperiment(experimentId);
            expect(experiment!.metrics).toEqual({
                accuracy: 0.85,
                f1_score: 0.82,
                precision: 0.88,
                recall: 0.79,
            });
        });

        it('should return false for non-existent experiment', async () => {
            const result = await introspectionMemory.logMetrics('non-existent-id', { accuracy: 0.85 });

            expect(result).toBe(false);
        });
    });

    describe('getExperiments', () => {
        it('should return empty array when no experiments', () => {
            expect(introspectionMemory.getExperiments()).toEqual([]);
        });

        it('should return all experiments', async () => {
            await introspectionMemory.startExperiment('Exp 1', 'First', ['cell-1']);
            await introspectionMemory.startExperiment('Exp 2', 'Second', ['cell-2']);
            await introspectionMemory.startExperiment('Exp 3', 'Third', ['cell-3']);

            const experiments = introspectionMemory.getExperiments();

            expect(experiments).toHaveLength(3);
            expect(experiments[0].name).toBe('Exp 1');
            expect(experiments[1].name).toBe('Exp 2');
            expect(experiments[2].name).toBe('Exp 3');
        });

        it('should return copy of experiments array', async () => {
            await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const experiments1 = introspectionMemory.getExperiments();
            const experiments2 = introspectionMemory.getExperiments();

            expect(experiments1).not.toBe(experiments2);
            expect(experiments1).toEqual(experiments2);
        });
    });

    describe('getExperiment', () => {
        it('should return undefined for non-existent experiment', () => {
            expect(introspectionMemory.getExperiment('non-existent')).toBeUndefined();
        });

        it('should return experiment by ID', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Description', ['cell-1']);

            const experiment = introspectionMemory.getExperiment(experimentId);

            expect(experiment).toBeDefined();
            expect(experiment!.name).toBe('Test');
        });
    });

    describe('getActiveExperiments', () => {
        it('should return only active experiments', async () => {
            const id1 = await introspectionMemory.startExperiment('Exp 1', 'First', ['cell-1']);
            const id2 = await introspectionMemory.startExperiment('Exp 2', 'Second', ['cell-2']);
            const id3 = await introspectionMemory.startExperiment('Exp 3', 'Third', ['cell-3']);

            await introspectionMemory.endExperiment(id2, 'completed');

            const active = introspectionMemory.getActiveExperiments();

            expect(active).toHaveLength(2);
            expect(active.find(e => e.id === id1)).toBeDefined();
            expect(active.find(e => e.id === id2)).toBeUndefined();
            expect(active.find(e => e.id === id3)).toBeDefined();
        });
    });

    describe('getCompletedExperiments', () => {
        it('should return only completed experiments', async () => {
            const id1 = await introspectionMemory.startExperiment('Exp 1', 'First', ['cell-1']);
            const id2 = await introspectionMemory.startExperiment('Exp 2', 'Second', ['cell-2']);
            const id3 = await introspectionMemory.startExperiment('Exp 3', 'Third', ['cell-3']);

            await introspectionMemory.endExperiment(id2, 'completed');
            await introspectionMemory.endExperiment(id3, 'failed');

            const completed = introspectionMemory.getCompletedExperiments();

            expect(completed).toHaveLength(1);
            expect(completed[0].id).toBe(id2);
        });
    });

    describe('deleteExperiment', () => {
        it('should delete an experiment', async () => {
            const experimentId = await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);

            const result = introspectionMemory.deleteExperiment(experimentId);

            expect(result).toBe(true);
            expect(introspectionMemory.getExperiment(experimentId)).toBeUndefined();
            expect(introspectionMemory.getExperimentCount()).toBe(0);
        });

        it('should return false for non-existent experiment', () => {
            const result = introspectionMemory.deleteExperiment('non-existent');

            expect(result).toBe(false);
        });
    });

    describe('clearExperiments', () => {
        it('should remove all experiments', async () => {
            await introspectionMemory.startExperiment('Exp 1', 'First', ['cell-1']);
            await introspectionMemory.startExperiment('Exp 2', 'Second', ['cell-2']);

            introspectionMemory.clearExperiments();

            expect(introspectionMemory.getExperiments()).toEqual([]);
            expect(introspectionMemory.getExperimentCount()).toBe(0);
        });
    });

    describe('experiment limit enforcement', () => {
        it('should enforce maximum experiment limit', async () => {
            const lowConfig = { ...defaultConfig, maxExperiments: 3 };
            const memory = new IntrospectionMemory(lowConfig);

            // Create more experiments than the limit
            for (let i = 0; i < 5; i++) {
                await memory.startExperiment(`Exp ${i}`, `Description ${i}`, [`cell-${i}`]);
            }

            expect(memory.getExperimentCount()).toBe(3);
        });

        it('should remove oldest experiments when limit exceeded', async () => {
            const lowConfig = { ...defaultConfig, maxExperiments: 3 };
            const memory = new IntrospectionMemory(lowConfig);

            const ids: string[] = [];
            for (let i = 0; i < 5; i++) {
                ids.push(await memory.startExperiment(`Exp ${i}`, `Description ${i}`, [`cell-${i}`]));
            }

            // Should keep the 3 most recent experiments
            const experiments = memory.getExperiments();
            expect(experiments.length).toBe(3);
            
            // Oldest experiments should be removed
            const keptIds = experiments.map(e => e.id);
            expect(keptIds).not.toContain(ids[0]);
            expect(keptIds).not.toContain(ids[1]);
        });
    });

    // ========================================================================
    // Variable Tracking Tests (Requirements: 2.1, 2.2, 7.1, 7.2, 7.4)
    // ========================================================================

    describe('trackVariable', () => {
        it('should track a new variable', async () => {
            const info: VariableInfo = {
                name: 'df',
                type: 'DataFrame',
                shape: '(100, 5)',
                value: 'preview of data',
                references: 2,
            };

            await introspectionMemory.trackVariable('df', 'cell-1', info);

            const variable = introspectionMemory.getVariable('df');

            expect(variable).toBeDefined();
            expect(variable!.name).toBe('df');
            expect(variable!.type).toBe('DataFrame');
            expect(variable!.shape).toBe('(100, 5)');
            expect(variable!.valuePreview).toBe('preview of data');
            expect(variable!.definedIn).toBe('cell-1');
        });

        it('should update existing variable', async () => {
            const info1: VariableInfo = {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            };
            const info2: VariableInfo = {
                name: 'x',
                type: 'int',
                value: '20',
                references: 2,
            };

            await introspectionMemory.trackVariable('x', 'cell-1', info1);
            await introspectionMemory.trackVariable('x', 'cell-2', info2);

            const variable = introspectionMemory.getVariable('x');
            expect(variable!.valuePreview).toBe('20');
            expect(variable!.referencedBy).toContain('cell-2');
        });
    });

    describe('untrackVariable', () => {
        it('should remove a variable', async () => {
            await introspectionMemory.trackVariable('x', 'cell-1', {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            });

            const result = await introspectionMemory.untrackVariable('x');

            expect(result).toBe(true);
            expect(introspectionMemory.getVariable('x')).toBeUndefined();
        });

        it('should return false for non-existent variable', async () => {
            const result = await introspectionMemory.untrackVariable('non-existent');

            expect(result).toBe(false);
        });
    });

    describe('updateVariableDependencies', () => {
        it('should update variable dependencies', async () => {
            await introspectionMemory.trackVariable('result', 'cell-2', {
                name: 'result',
                type: 'float',
                value: '0.85',
                references: 1,
            });

            await introspectionMemory.updateVariableDependencies('result', ['data', 'model']);

            const variable = introspectionMemory.getVariable('result');
            expect(variable!.dependencies).toEqual(['data', 'model']);
        });
    });

    describe('addVariableReference', () => {
        it('should add a cell reference to variable', async () => {
            // trackVariable adds the cellId to referencedBy
            await introspectionMemory.trackVariable('data', 'cell-1', {
                name: 'data',
                type: 'list',
                value: '[1, 2, 3]',
                references: 1,
            });

            await introspectionMemory.addVariableReference('data', 'cell-2');
            await introspectionMemory.addVariableReference('data', 'cell-3');

            const variable = introspectionMemory.getVariable('data');
            expect(variable!.referencedBy).toEqual(['cell-1', 'cell-2', 'cell-3']);
        });

        it('should not add duplicate references', async () => {
            // trackVariable adds the cellId to referencedBy
            await introspectionMemory.trackVariable('x', 'cell-1', {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            });

            await introspectionMemory.addVariableReference('x', 'cell-2');
            await introspectionMemory.addVariableReference('x', 'cell-2');

            const variable = introspectionMemory.getVariable('x');
            expect(variable!.referencedBy).toEqual(['cell-1', 'cell-2']);
        });
    });

    describe('getVariables', () => {
        it('should return all tracked variables', async () => {
            await introspectionMemory.trackVariable('x', 'cell-1', {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            });
            await introspectionMemory.trackVariable('y', 'cell-2', {
                name: 'y',
                type: 'float',
                value: '3.14',
                references: 2,
            });

            const variables = introspectionMemory.getVariables();

            expect(variables).toHaveLength(2);
            expect(variables[0].name).toBe('x');
            expect(variables[1].name).toBe('y');
        });

        it('should return empty array when no variables', () => {
            expect(introspectionMemory.getVariables()).toEqual([]);
        });
    });

    describe('clearVariables', () => {
        it('should remove all tracked variables', async () => {
            await introspectionMemory.trackVariable('x', 'cell-1', {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            });

            introspectionMemory.clearVariables();

            expect(introspectionMemory.getVariables()).toEqual([]);
            expect(introspectionMemory.getVariableCount()).toBe(0);
        });
    });

    // ========================================================================
    // Activity Tracking Tests (Requirements: 2.5)
    // ========================================================================

    describe('logActivity', () => {
        it('should log an activity entry', () => {
            introspectionMemory.logActivity('execution', 'Executed cell-1', 'cell-1');

            const activity = introspectionMemory.getRecentActivity();

            expect(activity.length).toBe(1);
            expect(activity[0].type).toBe('execution');
            expect(activity[0].description).toBe('Executed cell-1');
            expect(activity[0].cellId).toBe('cell-1');
            expect(activity[0].timestamp).toBeGreaterThan(0);
        });

        it('should log activity without cell ID', () => {
            introspectionMemory.logActivity('chat', 'User sent a message');

            const activity = introspectionMemory.getRecentActivity();

            expect(activity[0].cellId).toBeUndefined();
        });

        it('should log multiple activities', () => {
            introspectionMemory.logActivity('execution', 'Exec 1', 'cell-1');
            introspectionMemory.logActivity('edit', 'Edit 1', 'cell-2');
            introspectionMemory.logActivity('chat', 'Chat 1');

            const activity = introspectionMemory.getRecentActivity();

            expect(activity).toHaveLength(3);
        });

        it('should enforce activity limit', () => {
            const lowConfig = { ...defaultConfig, maxActivityEntries: 5 };
            const memory = new IntrospectionMemory(lowConfig);

            // Add more activities than the limit
            for (let i = 0; i < 10; i++) {
                memory.logActivity('execution', `Activity ${i}`);
            }

            expect(memory.getRecentActivity().length).toBe(5);
        });
    });

    describe('getRecentActivity', () => {
        it('should return all activity when no limit specified', () => {
            introspectionMemory.logActivity('execution', 'Activity 1');
            introspectionMemory.logActivity('execution', 'Activity 2');

            const activity = introspectionMemory.getRecentActivity();

            expect(activity).toHaveLength(2);
        });

        it('should limit activity by count', () => {
            for (let i = 0; i < 10; i++) {
                introspectionMemory.logActivity('execution', `Activity ${i}`);
            }

            const activity = introspectionMemory.getRecentActivity(5);

            expect(activity).toHaveLength(5);
        });

        it('should return most recent activity', () => {
            for (let i = 0; i < 5; i++) {
                introspectionMemory.logActivity('execution', `Activity ${i}`);
            }

            const activity = introspectionMemory.getRecentActivity(3);

            // Should return the 3 most recent activities
            expect(activity[0].description).toBe('Activity 2');
            expect(activity[2].description).toBe('Activity 4');
        });
    });

    describe('clearActivityLog', () => {
        it('should clear the activity log', () => {
            introspectionMemory.logActivity('execution', 'Activity 1');
            introspectionMemory.logActivity('execution', 'Activity 2');

            introspectionMemory.clearActivityLog();

            expect(introspectionMemory.getRecentActivity()).toEqual([]);
        });
    });

    // ========================================================================
    // Utility Tests
    // ========================================================================

    describe('getNotebookId', () => {
        it('should return the notebook ID', () => {
            expect(introspectionMemory.getNotebookId()).toBe('test-notebook-123');
        });
    });

    describe('getLastRefresh', () => {
        it('should return 0 initially', () => {
            expect(introspectionMemory.getLastRefresh()).toBe(0);
        });

        it('should return last refresh timestamp', async () => {
            await introspectionMemory.refresh([], [], 0);

            expect(introspectionMemory.getLastRefresh()).toBeGreaterThan(0);
        });
    });

    describe('getVariableCount', () => {
        it('should return 0 initially', () => {
            expect(introspectionMemory.getVariableCount()).toBe(0);
        });

        it('should return correct count after tracking variables', async () => {
            await introspectionMemory.trackVariable('x', 'cell-1', {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            });
            await introspectionMemory.trackVariable('y', 'cell-2', {
                name: 'y',
                type: 'int',
                value: '20',
                references: 1,
            });

            expect(introspectionMemory.getVariableCount()).toBe(2);
        });
    });

    describe('getExperimentCount', () => {
        it('should return 0 initially', () => {
            expect(introspectionMemory.getExperimentCount()).toBe(0);
        });

        it('should return correct count after creating experiments', async () => {
            await introspectionMemory.startExperiment('Exp 1', 'First', ['cell-1']);
            await introspectionMemory.startExperiment('Exp 2', 'Second', ['cell-2']);

            expect(introspectionMemory.getExperimentCount()).toBe(2);
        });
    });

    describe('clear', () => {
        it('should clear all data', async () => {
            // Add experiment
            await introspectionMemory.startExperiment('Test', 'Desc', ['cell-1']);
            
            // Add variable
            await introspectionMemory.trackVariable('x', 'cell-1', {
                name: 'x',
                type: 'int',
                value: '10',
                references: 1,
            });

            // Add activity
            introspectionMemory.logActivity('execution', 'Test activity');

            // Clear all
            introspectionMemory.clear();

            expect(introspectionMemory.getExperiments()).toEqual([]);
            expect(introspectionMemory.getVariables()).toEqual([]);
            expect(introspectionMemory.getRecentActivity()).toEqual([]);
            expect(introspectionMemory.getVariableCount()).toBe(0);
            expect(introspectionMemory.getExperimentCount()).toBe(0);
        });
    });

    describe('updateExecutionContext', () => {
        it('should update execution context fields', async () => {
            introspectionMemory.updateExecutionContext({
                currentCell: 'cell-5',
                executionCount: 10,
                kernelStatus: 'busy',
                lastExecutionTime: 1.5,
            });

            const json = await introspectionMemory.getJSON();

            expect(json.executionContext.currentCell).toBe('cell-5');
            expect(json.executionContext.executionCount).toBe(10);
            expect(json.executionContext.kernelStatus).toBe('busy');
            expect(json.executionContext.lastExecutionTime).toBe(1.5);
        });

        it('should partially update execution context', async () => {
            introspectionMemory.updateExecutionContext({
                currentCell: 'cell-1',
            });

            const json = await introspectionMemory.getJSON();

            expect(json.executionContext.currentCell).toBe('cell-1');
            // Other fields should remain unchanged
            expect(json.executionContext.executionCount).toBe(0);
            expect(json.executionContext.kernelStatus).toBe('idle');
        });
    });
});