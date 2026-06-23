
export enum CellKind {
	Markup = 1,
	Code = 2
}

export enum NotebookCellExecutionState {
	Unconfirmed = 1,
	Pending = 2,
	Executing = 3
}

export enum NotebookRunState {
	Running = 1,
	Idle = 2
}

export enum CellEditType {
	Replace = 1,
	Output = 2,
	Metadata = 3,
	CellLanguage = 4,
	DocumentMetadata = 5,
	Move = 6,
	OutputItems = 7,
	PartialMetadata = 8,
	PartialInternalMetadata = 9
}

export interface IOutputItemDto {
	readonly mime: string;
	readonly valueBytes: Uint8Array;
}

export interface IOutputDto {
	readonly outputId: string;
	readonly items: IOutputItemDto[];
	readonly metadata?: Record<string, any>;
}

export interface ICellDto {
	readonly handle: number;
	readonly cellId: string;       // original ipynb cell ID (string UUID)
	readonly cellKind: CellKind;
	readonly source: string;
	readonly language: string;
	readonly outputs: IOutputDto[];
	readonly metadata?: Record<string, any>;
	readonly internalMetadata?: NotebookCellInternalMetadata;
}

export interface NotebookCellInternalMetadata {
	internalId?: string;
	executionId?: string;
	executionOrder?: number;
	lastRunSuccess?: boolean;
	runStartTime?: number;
	runEndTime?: number;
	isInputMuted?: boolean;
	isOutputMuted?: boolean;
}

export type NullablePartialNotebookCellInternalMetadata = {
	[Key in keyof Partial<NotebookCellInternalMetadata>]: NotebookCellInternalMetadata[Key] | null
};

export type NotebookCellMetadata = Record<string, any>;
export type NullablePartialNotebookCellMetadata = {
	[Key in keyof Partial<NotebookCellMetadata>]: NotebookCellMetadata[Key] | null
};

export type NotebookDocumentMetadata = Record<string, any>;

export interface ICellReplaceEdit {
	editType: CellEditType.Replace;
	index: number;
	count: number;
	cells: ICellDto[];
}

export interface ICellOutputEdit {
	editType: CellEditType.Output;
	index: number;
	outputs: IOutputDto[];
	append?: boolean;
}

export interface ICellOutputEditByHandle {
	editType: CellEditType.Output;
	handle: number;
	outputs: IOutputDto[];
	append?: boolean;
}

export interface ICellOutputItemEdit {
	editType: CellEditType.OutputItems;
	outputId: string;
	items: IOutputItemDto[];
	append?: boolean;
}

export interface ICellMetadataEdit {
	editType: CellEditType.Metadata;
	index: number;
	metadata: NotebookCellMetadata;
}

export interface ICellPartialMetadataEdit {
	editType: CellEditType.PartialMetadata;
	index: number;
	metadata: NullablePartialNotebookCellMetadata;
}

export interface ICellPartialMetadataEditByHandle {
	editType: CellEditType.PartialMetadata;
	handle: number;
	metadata: NullablePartialNotebookCellMetadata;
}

export interface ICellPartialInternalMetadataEdit {
	editType: CellEditType.PartialInternalMetadata;
	index: number;
	internalMetadata: NullablePartialNotebookCellInternalMetadata;
}

export interface ICellPartialInternalMetadataEditByHandle {
	editType: CellEditType.PartialInternalMetadata;
	handle: number;
	internalMetadata: NullablePartialNotebookCellInternalMetadata;
}

export interface ICellLanguageEdit {
	editType: CellEditType.CellLanguage;
	index: number;
	language: string;
}

export interface IDocumentMetadataEdit {
	editType: CellEditType.DocumentMetadata;
	metadata: NotebookDocumentMetadata;
}

export interface ICellMoveEdit {
	editType: CellEditType.Move;
	index: number;
	length: number;
	newIdx: number;
}

export type IImmediateCellEditOperation = ICellOutputEditByHandle | ICellPartialMetadataEditByHandle | ICellOutputItemEdit | ICellPartialInternalMetadataEdit | ICellPartialInternalMetadataEditByHandle | ICellPartialMetadataEdit;
export type ICellEditOperation = IImmediateCellEditOperation | ICellReplaceEdit | ICellOutputEdit | ICellMetadataEdit | ICellPartialMetadataEdit | ICellPartialInternalMetadataEdit | IDocumentMetadataEdit | ICellMoveEdit | ICellOutputItemEdit | ICellLanguageEdit;
