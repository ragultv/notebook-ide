import { EventEmitter } from 'events';
import { NotebookCellExecutionState, NotebookRunState } from '../notebook/NotebookCommon.js';
import { NotebookCellOutputTextModel } from '../notebook/model/NotebookCellOutputTextModel.js';
import { eventBus } from './EventBus.js';

export type NotebookEventMap = {
    'onDidChangeCellState':  { notebookUri: string; cellHandle: number; state: NotebookCellExecutionState };
    'onDidChangeOutputs':    { notebookUri: string; cellHandle: number; outputs: NotebookCellOutputTextModel[] };
    'onDidChangeMetadata':   { notebookUri: string; cellHandle: number; metadata: Record<string, any> };
    'onDidChangeExecution':  { notebookUri: string; state: NotebookRunState };
    'onDidChangeKernel':     { notebookUri: string; kernelId: string | undefined };
};

export class NotebookEventBus extends EventEmitter {
    public emitEvent<K extends keyof NotebookEventMap>(event: K, payload: NotebookEventMap[K]): void {
        this.emit(event, payload);

        // Mirror select events onto the global eventBus so subscribers receive them.
        // Cast to any because these extension events are not in OctopodEvents.
        if (event === 'onDidChangeCellState') {
            const p = payload as NotebookEventMap['onDidChangeCellState'];
            (eventBus as any).emit('cell:state_changed', {
                notebookId: p.notebookUri,
                cellHandle: p.cellHandle,
                state:      p.state,
            });
        } else if (event === 'onDidChangeExecution') {
            const p = payload as NotebookEventMap['onDidChangeExecution'];
            (eventBus as any).emit('notebook:execution_changed', {
                notebookId: p.notebookUri,
                state:      p.state,
            });
        } else if (event === 'onDidChangeKernel') {
            const p = payload as NotebookEventMap['onDidChangeKernel'];
            (eventBus as any).emit('notebook:kernel_changed', {
                notebookId: p.notebookUri,
                kernelId:   p.kernelId,
            });
        }
    }
}

export const globalNotebookEventBus = new NotebookEventBus();
