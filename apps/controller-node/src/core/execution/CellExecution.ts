import { v4 as uuidv4 } from 'uuid';
import { NotebookTextModel } from '../notebook/model/NotebookTextModel.js';
import { NotebookCellExecutionState, CellEditType, ICellEditOperation } from '../notebook/NotebookCommon.js';
import { ICellExecutionUpdate } from './types/ICellExecutionUpdate.js';
import { CellExecutionUpdateType } from './types/CellExecutionUpdateType.js';

export class CellExecution {
    private _state = NotebookCellExecutionState.Unconfirmed;
    private _completed = false;

    /** Stable execution ID — shared with the queue item so the frontend tracks consistently. */
    public readonly executionId: string;

    constructor(
        public readonly cellHandle: number,
        public readonly notebookUri: string,
        private readonly model: NotebookTextModel,
        executionId?: string,
    ) {
        this.executionId = executionId ?? uuidv4();
    }

    public get state() { return this._state; }
    public get isCompleted() { return this._completed; }

    public initialize() {
        this._completed = false;
        this.model.applyEdits([{
            editType: CellEditType.PartialInternalMetadata,
            handle: this.cellHandle,
            internalMetadata: { runStartTime: null, runEndTime: null, lastRunSuccess: null },
        }]);
    }

    public confirm() {
        this._state = NotebookCellExecutionState.Pending;
    }

    public update(updates: ICellExecutionUpdate[]) {
        this._state = NotebookCellExecutionState.Executing;
        const edits: ICellEditOperation[] = updates.map(u => this.transformUpdateToEdit(u));
        if (edits.length > 0) this.model.applyEdits(edits);
    }

    /** Idempotent — safe to call multiple times; only the first call takes effect. */
    public complete(lastRunSuccess: boolean) {
        if (this._completed) return;
        this._completed = true;
        this._state = NotebookCellExecutionState.Unconfirmed;
        this.model.applyEdits([{
            editType: CellEditType.PartialInternalMetadata,
            handle: this.cellHandle,
            internalMetadata: { lastRunSuccess, runEndTime: Date.now() },
        }]);
    }

    private transformUpdateToEdit(update: ICellExecutionUpdate): ICellEditOperation {
        if (update.editType === CellExecutionUpdateType.Output) {
            return {
                editType: CellEditType.Output,
                handle:   this.cellHandle,
                outputs:  update.outputs,
                append:   update.append,
            };
        }
        if (update.editType === CellExecutionUpdateType.OutputItems) {
            return {
                editType:  CellEditType.OutputItems,
                outputId:  update.outputId,
                items:     update.items,
                append:    update.append,
            };
        }
        if (update.editType === CellExecutionUpdateType.InternalMetadata) {
            return {
                editType:         CellEditType.PartialInternalMetadata,
                handle:           this.cellHandle,
                internalMetadata: update.internalMetadata,
            };
        }
        throw new Error(`Unknown update type`);
    }
}
