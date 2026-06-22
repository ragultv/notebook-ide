import { NotebookTextModel } from '../notebook/model/NotebookTextModel';
import { NotebookCellExecutionState, CellEditType, ICellEditOperation } from '../notebook/NotebookCommon';
import { ICellExecutionUpdate } from './types/ICellExecutionUpdate';
import { CellExecutionUpdateType } from './types/CellExecutionUpdateType';

export class CellExecution {
    private _state = NotebookCellExecutionState.Unconfirmed;

    constructor(
        public readonly cellHandle: number,
        public readonly notebookUri: string,
        private readonly model: NotebookTextModel
    ) {}

    public get state() { return this._state; }
    
    public initialize() {
        this.model.applyEdits([{
            editType: CellEditType.PartialInternalMetadata,
            handle: this.cellHandle,
            internalMetadata: { runStartTime: null, runEndTime: null, lastRunSuccess: null }
        }]);
    }

    public confirm() { 
        this._state = NotebookCellExecutionState.Pending; 
    }
    
    public update(updates: ICellExecutionUpdate[]) {
        this._state = NotebookCellExecutionState.Executing;
        const edits: ICellEditOperation[] = updates.map(u => this.transformUpdateToEdit(u));
        this.model.applyEdits(edits);
    }

    public complete(lastRunSuccess: boolean) {
        this._state = NotebookCellExecutionState.Unconfirmed;
        this.model.applyEdits([{
            editType: CellEditType.PartialInternalMetadata,
            handle: this.cellHandle,
            internalMetadata: { lastRunSuccess, runEndTime: Date.now() }
        }]);
    }

    private transformUpdateToEdit(update: ICellExecutionUpdate): ICellEditOperation {
        switch (update.editType) {
            case CellExecutionUpdateType.Output:
                return {
                    editType: CellEditType.Output,
                    handle: this.cellHandle,
                    outputs: update.outputs,
                    append: update.append
                };
            case CellExecutionUpdateType.OutputItems:
                return {
                    editType: CellEditType.OutputItems,
                    outputId: update.outputId,
                    items: update.items,
                    append: update.append
                };
            case CellExecutionUpdateType.InternalMetadata:
                return {
                    editType: CellEditType.PartialInternalMetadata,
                    handle: this.cellHandle,
                    internalMetadata: update.internalMetadata
                };
            default:
                throw new Error(`Unknown update type`);
        }
    }
}
