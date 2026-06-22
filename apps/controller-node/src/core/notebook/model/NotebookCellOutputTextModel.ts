import { NotebookCellOutputItemTextModel } from './NotebookCellOutputItemTextModel';

export class NotebookCellOutputTextModel {
    constructor(
        public readonly outputId: string,
        public readonly items: NotebookCellOutputItemTextModel[],
        public readonly metadata?: Record<string, any>
    ) {}
}
