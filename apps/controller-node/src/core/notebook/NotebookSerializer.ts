import { v4 as uuidv4 } from 'uuid';
import { NotebookTextModel } from './model/NotebookTextModel.js';
import { ICellDto, CellKind, NotebookDocumentMetadata } from './NotebookCommon.js';

export interface INotebookSerializer {
    deserializeNotebook(content: string): Promise<{ cells: ICellDto[]; metadata: NotebookDocumentMetadata }>;
    serializeNotebook(model: NotebookTextModel): Promise<string>;
}

export class NotebookSerializer implements INotebookSerializer {
    public async deserializeNotebook(content: string): Promise<{ cells: ICellDto[]; metadata: NotebookDocumentMetadata }> {
        const ipynb = JSON.parse(content) as {
            cells: Array<{
                cell_type: string;
                id?: string;
                source: string | string[];
                metadata?: Record<string, any>;
                outputs?: any[];
                execution_count?: number | null;
            }>;
            metadata?: Record<string, any>;
        };

        const cells: ICellDto[] = [];
        let handle = 0;

        for (const raw of ipynb.cells ?? []) {
            const cellKind = raw.cell_type === 'code' ? CellKind.Code : CellKind.Markup;
            const source   = Array.isArray(raw.source) ? raw.source.join('') : (raw.source ?? '');

            cells.push({
                handle:   handle++,
                cellId:   raw.id ?? uuidv4(),
                cellKind,
                source,
                language: raw.cell_type === 'code' ? 'python' : 'markdown',
                outputs:  [],
                metadata: raw.metadata ?? {},
                internalMetadata: {
                    executionOrder: raw.execution_count ?? undefined,
                    lastRunSuccess: undefined,
                },
            });
        }

        return { cells, metadata: ipynb.metadata ?? {} };
    }

    public async serializeNotebook(model: NotebookTextModel): Promise<string> {
        const cells = model.cells.map((cell) => ({
            id:         cell.cellId,
            cell_type:  cell.cellKind === CellKind.Code ? 'code' : 'markdown',
            source:     cell.source.split('\n').map((line, i, arr) =>
                i < arr.length - 1 ? line + '\n' : line
            ),
            metadata:        cell.metadata ?? {},
            outputs:         [],
            execution_count: cell.internalMetadata?.executionOrder ?? null,
        }));

        const ipynb = {
            nbformat:       4,
            nbformat_minor: 5,
            metadata:       model.metadata ?? {},
            cells,
        };

        return JSON.stringify(ipynb, null, 2);
    }
}
