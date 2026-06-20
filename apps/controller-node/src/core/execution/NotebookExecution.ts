export enum NotebookExecutionState {
    Unconfirmed = 1,
    Pending = 2,
    Executing = 3
}

export class NotebookExecution {
    private _state = NotebookExecutionState.Unconfirmed;
    
    constructor(public readonly notebookUri: string) {}

    public get state() { return this._state; }
    public confirm() { this._state = NotebookExecutionState.Pending; }
    public begin() { this._state = NotebookExecutionState.Executing; }
    public complete() { this._state = NotebookExecutionState.Unconfirmed; }
}
