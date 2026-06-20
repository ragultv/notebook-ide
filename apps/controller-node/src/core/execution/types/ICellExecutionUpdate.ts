import { CellExecutionUpdateType } from './CellExecutionUpdateType';
import { IOutputDto, IOutputItemDto, NullablePartialNotebookCellInternalMetadata } from '../../notebook/NotebookCommon';

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

export type ICellExecutionUpdate = ICellExecutionOutputUpdate | ICellExecutionOutputItemsUpdate | ICellExecutionInternalMetadataUpdate;
