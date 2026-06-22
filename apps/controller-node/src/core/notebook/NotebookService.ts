import { NotebookTextModel } from './model/NotebookTextModel';

export class NotebookService {
    private models = new Map<string, NotebookTextModel>();

    public getNotebookTextModel(uri: string): NotebookTextModel | undefined {
        return this.models.get(uri);
    }

    public addNotebookTextModel(model: NotebookTextModel): void {
        this.models.set(model.uri, model);
    }

    public removeNotebookTextModel(uri: string): void {
        this.models.delete(uri);
    }
}
