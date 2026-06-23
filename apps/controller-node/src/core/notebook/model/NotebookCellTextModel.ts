import { NotebookCellOutputTextModel } from './NotebookCellOutputTextModel.js';
import { NotebookCellInternalMetadata, CellKind } from '../NotebookCommon.js';

export class NotebookCellTextModel {
    constructor(
        public readonly uri: string,
        public readonly handle: number,
        public readonly cellId: string,         // original ipynb cell ID
        public readonly cellKind: CellKind,
        public source: string,
        public language: string,
        public outputs: NotebookCellOutputTextModel[],
        public metadata: Record<string, any> = {},
        public internalMetadata: NotebookCellInternalMetadata = {}
    ) {}

    public getValue(): string { return this.source; }
}
