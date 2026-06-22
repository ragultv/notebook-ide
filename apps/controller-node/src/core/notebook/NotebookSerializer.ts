import { NotebookTextModel } from './model/NotebookTextModel';
import { ICellDto, NotebookDocumentMetadata } from './NotebookCommon';

export interface INotebookSerializer {
    deserializeNotebook(content: string): Promise<{ cells: ICellDto[], metadata: NotebookDocumentMetadata }>;
    serializeNotebook(model: NotebookTextModel): Promise<string>;
}

export class NotebookSerializer implements INotebookSerializer {
    public async deserializeNotebook(content: string): Promise<{ cells: ICellDto[], metadata: NotebookDocumentMetadata }> {
        // Implement parsing logic (e.g. from ipynb)
        return { cells: [], metadata: {} };
    }

    public async serializeNotebook(model: NotebookTextModel): Promise<string> {
        // Implement serialization logic (e.g. to ipynb)
        return '';
    }
}
