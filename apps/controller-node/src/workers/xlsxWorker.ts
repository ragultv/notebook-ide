/**
 * xlsxWorker.ts — P1-5: Worker thread for XLSX parsing.
 *
 * Runs in a separate thread so XLSX.readFile (synchronous, potentially 10-100ms for large files)
 * does NOT block the Fastify event loop.
 *
 * Protocol (parentPort message):
 *   Input:  { filePath: string, sheet?: string, maxRows: number }
 *   Output: { ok: true, headers, rows, totalRows, sheets, currentSheet }
 *         | { ok: false, error: string }
 */

import { workerData, parentPort } from 'worker_threads';

(async () => {
    if (!parentPort) process.exit(1);

    const { filePath, sheet, maxRows } = workerData as {
        filePath: string;
        sheet?: string;
        maxRows: number;
    };

    try {
        // Dynamic import inside the worker — keeps the dependency optional
        const XLSX = await import('xlsx').catch(() => null);
        if (!XLSX) {
            parentPort.postMessage({ ok: false, error: 'xlsx package not installed' });
            return;
        }

        const workbook   = XLSX.readFile(filePath);
        const sheetNames = workbook.SheetNames;
        const useSheet   = sheet && sheetNames.includes(sheet) ? sheet : sheetNames[0];
        const worksheet  = workbook.Sheets[useSheet];
        const jsonRows   = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (jsonRows.length === 0) {
            parentPort.postMessage({
                ok: true, headers: [], rows: [], totalRows: 0, sheets: sheetNames, currentSheet: useSheet,
            });
            return;
        }

        const headers = (jsonRows[0] as any[]).map(String);
        const rows    = jsonRows.slice(1, maxRows + 1);

        parentPort.postMessage({
            ok: true, headers, rows, totalRows: jsonRows.length - 1, sheets: sheetNames, currentSheet: useSheet,
        });
    } catch (e: any) {
        parentPort!.postMessage({ ok: false, error: e.message });
    }
})();
