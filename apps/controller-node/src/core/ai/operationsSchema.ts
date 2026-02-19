import { z } from 'zod';

const cellTypeEnum = z.enum(['code', 'markdown']);
const cellTypeCoerce = z.union([
    cellTypeEnum,
    z.string().transform((s) => (s?.toLowerCase() === 'markdown' ? 'markdown' : 'code')),
]);

const addCellParams = z.object({
    type: cellTypeCoerce,
    content: z.string(),
});

const editCellParams = z.object({
    cellIndex: z.coerce.number().int().positive(),
    content: z.string(),
    type: cellTypeCoerce.optional(),
});

const deleteCellParams = z.object({
    cellIndex: z.coerce.number().int().positive(),
});

const createNotebookParams = z.object({
    name: z.string().min(1),
});

const addPackageParams = z.object({
    packages: z.preprocess(
        (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []),
        z.array(z.string().min(1))
    ),
});

export const AddCellOperationSchema = z.object({
    type: z.literal('add_cell'),
    params: addCellParams,
});

export const EditCellOperationSchema = z.object({
    type: z.literal('edit_cell'),
    params: editCellParams,
});

export const DeleteCellOperationSchema = z.object({
    type: z.literal('delete_cell'),
    params: deleteCellParams,
});

export const CreateNotebookOperationSchema = z.object({
    type: z.literal('create_notebook'),
    params: createNotebookParams,
});

export const AddPackageOperationSchema = z.object({
    type: z.literal('add_package'),
    params: addPackageParams,
});

export const OperationSchema = z.discriminatedUnion('type', [
    AddCellOperationSchema,
    EditCellOperationSchema,
    DeleteCellOperationSchema,
    CreateNotebookOperationSchema,
    AddPackageOperationSchema,
]);

export type Operation = z.infer<typeof OperationSchema>;

export const OperationsArraySchema = z.array(OperationSchema);

export type ValidatedOperation = Operation;

export type ValidateOperationsResult =
    | { success: true; data: ValidatedOperation[] }
    | { success: false; errors: Array<{ index: number; error: z.ZodError; raw?: unknown }> };

/**
 * Validate a list of raw operations. Returns only operations that pass the schema.
 * Optionally returns errors for invalid items.
 */
export function validateOperations(
    raw: Array<{ type: string; params?: Record<string, unknown> }>,
    options?: { collectErrors?: boolean }
): ValidateOperationsResult {
    const valid: ValidatedOperation[] = [];
    const errors: Array<{ index: number; error: z.ZodError; raw?: unknown }> = [];

    for (let i = 0; i < raw.length; i++) {
        const result = OperationSchema.safeParse(raw[i]);
        if (result.success) {
            valid.push(result.data);
        } else if (options?.collectErrors) {
            errors.push({ index: i, error: result.error, raw: raw[i] });
        }
    }

    if (valid.length === 0 && errors.length > 0 && options?.collectErrors) {
        return { success: false, errors };
    }
    return { success: true, data: valid };
}
