import { EventEmitter } from 'events';
import { NotebookCellExecutionState, NotebookRunState } from '../notebook/NotebookCommon';
import { NotebookCellOutputTextModel } from '../notebook/model/NotebookCellOutputTextModel';

export type NotebookEventMap = {
    'onDidChangeCellState': { notebookUri: string; cellHandle: number; state: NotebookCellExecutionState };
    'onDidChangeOutputs': { notebookUri: string; cellHandle: number; outputs: NotebookCellOutputTextModel[] };
    'onDidChangeMetadata': { notebookUri: string; cellHandle: number; metadata: Record<string, any> };
    'onDidChangeExecution': { notebookUri: string; state: NotebookRunState };
    'onDidChangeKernel': { notebookUri: string; kernelId: string | undefined };
};

export class NotebookEventBus extends EventEmitter {
    public emitEvent<K extends keyof NotebookEventMap>(event: K, payload: NotebookEventMap[K]): void {
        this.emit(event, payload);
    }
}

export const globalNotebookEventBus = new NotebookEventBus();
