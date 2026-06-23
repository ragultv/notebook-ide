import { NotebookCellTextModel } from './NotebookCellTextModel.js';
import { NotebookCellOutputTextModel } from './NotebookCellOutputTextModel.js';
import { NotebookCellOutputItemTextModel } from './NotebookCellOutputItemTextModel.js';
import {
    ICellDto,
    ICellEditOperation,
    CellEditType,
    NotebookDocumentMetadata,
    IOutputDto,
} from '../NotebookCommon.js';

export class NotebookTextModel {
    private _cells: NotebookCellTextModel[] = [];
    private _versionId = 0;
    
    constructor(
        public readonly uri: string,
        cells: ICellDto[],
        public metadata: NotebookDocumentMetadata
    ) {
        this._initialize(cells);
    }

    public get cells(): readonly NotebookCellTextModel[] {
        return this._cells;
    }

    public get versionId(): number {
        return this._versionId;
    }

    private _initialize(cells: ICellDto[]) {
        this._cells = cells.map(c => this._createCell(c));
    }

    private _createCell(dto: ICellDto): NotebookCellTextModel {
        const outputs = dto.outputs.map(o => this._createOutput(o));
        return new NotebookCellTextModel(
            this.uri,
            dto.handle,
            dto.cellId,
            dto.cellKind,
            dto.source,
            dto.language,
            outputs,
            dto.metadata || {},
            dto.internalMetadata || {}
        );
    }

    private _createOutput(dto: IOutputDto): NotebookCellOutputTextModel {
        const items = dto.items.map(i => new NotebookCellOutputItemTextModel(i.mime, i.valueBytes));
        return new NotebookCellOutputTextModel(dto.outputId, items, dto.metadata);
    }

    public applyEdits(edits: ICellEditOperation[]): boolean {
        for (const edit of edits) {
            switch (edit.editType) {
                case CellEditType.Replace:
                    const newCells = edit.cells.map(c => this._createCell(c));
                    this._cells.splice(edit.index, edit.count, ...newCells);
                    break;
                case CellEditType.Output: {
                    // For OutputEditByHandle or OutputEdit by index
                    let cell: NotebookCellTextModel | undefined;
                    if ('handle' in edit) {
                        cell = this._cells.find(c => c.handle === edit.handle);
                    } else if ('index' in edit) {
                        cell = this._cells[edit.index];
                    }
                    if (cell) {
                        const newOutputs = edit.outputs.map(o => this._createOutput(o));
                        if (edit.append) {
                            cell.outputs.push(...newOutputs);
                        } else {
                            cell.outputs = newOutputs;
                        }
                    }
                    break;
                }
                case CellEditType.PartialMetadata: {
                    let cell: NotebookCellTextModel | undefined;
                    if ('handle' in edit) {
                        cell = this._cells.find(c => c.handle === edit.handle);
                    } else if ('index' in edit) {
                        cell = this._cells[edit.index];
                    }
                    if (cell) {
                        cell.metadata = {
                            ...cell.metadata,
                            ...this._cleanPartial(edit.metadata)
                        };
                    }
                    break;
                }
                case CellEditType.PartialInternalMetadata: {
                    let cell: NotebookCellTextModel | undefined;
                    if ('handle' in edit) {
                        cell = this._cells.find(c => c.handle === edit.handle);
                    } else if ('index' in edit) {
                        cell = this._cells[edit.index];
                    }
                    if (cell) {
                        cell.internalMetadata = {
                            ...cell.internalMetadata,
                            ...this._cleanPartial(edit.internalMetadata)
                        };
                    }
                    break;
                }
                case CellEditType.DocumentMetadata:
                    this.metadata = { ...this.metadata, ...edit.metadata };
                    break;
                case CellEditType.Move:
                    const moved = this._cells.splice(edit.index, edit.length);
                    this._cells.splice(edit.newIdx, 0, ...moved);
                    break;
                case CellEditType.CellLanguage:
                    if (this._cells[edit.index]) {
                        this._cells[edit.index].language = edit.language;
                    }
                    break;
                // Add OutputItems parsing if needed
            }
        }

        this._versionId++;
        
        // TODO: Broadcast NotebookTextModelChangedEvent to NotebookEventBus once implemented in Step 8
        
        return true;
    }

    private _cleanPartial(partial: any): any {
        const result: any = {};
        for (const key of Object.keys(partial)) {
            if (partial[key] !== null) {
                result[key] = partial[key];
            }
        }
        return result;
    }
}
