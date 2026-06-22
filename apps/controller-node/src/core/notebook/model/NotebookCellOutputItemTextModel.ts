import { IOutputItemDto } from '../NotebookCommon';

export class NotebookCellOutputItemTextModel {
    constructor(
        public readonly mime: string,
        public readonly valueBytes: Uint8Array
    ) {}
}
