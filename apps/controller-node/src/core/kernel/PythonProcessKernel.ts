import { BaseKernel } from './BaseKernel.js';
import { notebookService } from '../notebook/NotebookService.js';
import { notebookManager } from '../notebook/NotebookManager.js';
import { outputManager } from '../output/OutputManager.js';
import { OutputBuffer } from '../outputs/OutputBuffer.js';
import { eventBus } from '../events/EventBus.js';
import type { NotebookExecutionStateService } from '../state/NotebookExecutionStateService.js';
import type { ExecutionResult } from '../KernelManager.js';

/**
 * Callback signatures forwarded from KernelManager.executeCode() — passed via
 * constructor so PythonProcessKernel never imports KernelManager directly
 * (avoids a circular dependency: KernelManager → KernelBootstrap → PythonProcessKernel → KernelManager).
 */
export type ExecuteCodeFn = (
    notebookId: string,
    code: string,
    callbacks: {
        onOutput:   (output: any) => void;
        onComplete: (result: ExecutionResult) => void;
        onError:    (error: string) => void;
    },
    executionId: string,
) => Promise<ExecutionResult>;

export type InterruptFn = (notebookId: string) => Promise<void>;

/**
 * PythonProcessKernel — bridges the VS Code-like kernel interface to the real
 * KernelManager → BridgeProcess → Python execution layer.
 *
 * One instance per notebook. Created and registered by KernelBootstrap when
 * KernelManager emits 'kernel:started'.
 */
export class PythonProcessKernel extends BaseKernel {
    constructor(
        id: string,
        label: string,
        private readonly notebookUri: string,
        private readonly executeCodeFn: ExecuteCodeFn,
        private readonly interruptFn: InterruptFn,
        private readonly stateService: NotebookExecutionStateService,
    ) {
        super(id, label);
    }

    /**
     * Execute cells serially in handle order.
     * CellExecution objects must already be created in NotebookExecutionStateService
     * before this is called (done by ExecutionEngine.executeSingleCell).
     */
    public async executeCells(uri: string, cellHandles: number[]): Promise<void> {
        const model = notebookService.getNotebookTextModel(uri);
        if (!model) return;

        let queuePosition = 0;
        for (const handle of cellHandles) {
            const cell = model.cells.find(c => c.handle === handle);
            if (!cell) continue;

            const execution = this.stateService.getCellExecution(uri, handle);
            if (!execution) continue;

            const code       = cell.getValue();
            const cellId     = cell.cellId;
            const executionId = execution.executionId;  // reuse ID from queue item

            execution.confirm();   // Unconfirmed → Pending
            outputManager.onExecutionStart(uri, cellId, executionId);

            eventBus.emit('cell:started', {
                notebookId:    uri,
                cellId,
                executionId,
                queuePosition: queuePosition++,
                queueSize:     cellHandles.length,
            });

            await new Promise<void>((resolve) => {
                // Debounce rapid Python outputs (10 ms) before forwarding to OutputManager.
                const outputBuffer = new OutputBuffer<any>(10, (batch) => {
                    for (const rawOutput of batch) {
                        outputManager.onOutput(executionId, rawOutput);
                    }
                });

                this.executeCodeFn(
                    uri,
                    code,
                    {
                        onOutput: (rawOutput) => {
                            execution.update([]);
                            outputBuffer.push(rawOutput);
                        },
                        onComplete: (result) => {
                            outputBuffer.flush();
                            const execCount = result.execution_count ?? null;
                            notebookManager.updateCellExecutionCount(uri, cellId, execCount);
                            notebookManager.updateCellOutputs(uri, cellId, (result.outputs ?? []) as any);
                            outputManager.onExecutionComplete(executionId, execCount, result);
                            execution.complete(result.status === 'success');
                            resolve();
                        },
                        onError: (error) => {
                            outputBuffer.flush();
                            const isInterrupt = error.includes('KeyboardInterrupt');
                            if (isInterrupt) {
                                outputManager.onExecutionInterrupted(executionId);
                            } else {
                                const match = error.match(/^([^:]+):\s(.+?)(?:\n|$)/);
                                outputManager.onExecutionError(executionId, error, match?.[1], match?.[2]);
                            }
                            execution.complete(!isInterrupt);
                            resolve();
                        },
                    },
                    executionId,
                );
            });
        }
    }

    public async interrupt(): Promise<void> {
        await this.interruptFn(this.notebookUri);
    }

    public async restart(): Promise<void> {
        // KernelManager.restartKernel() handles this at a higher level
    }

    public async shutdown(): Promise<void> {
        // KernelManager.stopKernel() handles this at a higher level
    }

    public async provideVariables(): Promise<any[]> {
        return [];
    }
}
