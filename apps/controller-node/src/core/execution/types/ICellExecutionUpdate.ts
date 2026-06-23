import { CellExecutionUpdateType } from './CellExecutionUpdateType.js';
import { IOutputDto, IOutputItemDto, NullablePartialNotebookCellInternalMetadata } from '../../notebook/NotebookCommon.js';

export interface ICellExecutionOutputUpdate {
    editType: CellExecutionUpdateType.Output;
    outputs: IOutputDto[];
    append?: boolean;
}

export interface ICellExecutionOutputItemsUpdate {
    editType: CellExecutionUpdateType.OutputItems;
    outputId: string;
    items: IOutputItemDto[];
    append?: boolean;
}

export interface ICellExecutionInternalMetadataUpdate {
    editType: CellExecutionUpdateType.InternalMetadata;
    internalMetadata: NullablePartialNotebookCellInternalMetadata;
}

export type ICellExecutionUpdate =
    | ICellExecutionOutputUpdate
    | ICellExecutionOutputItemsUpdate
    | ICellExecutionInternalMetadataUpdate;
