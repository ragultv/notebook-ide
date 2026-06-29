import type { Mode, ToolEntry } from '../types/index.js';
import { listProjectEntry, readFileEntry, searchNotebookEntry, loadMemoryEntry, searchEmbeddingsEntry, readCellEntry, countNotebookCellsEntry } from './read-tools.js';
import { createPlanEntry, updatePlanEntry } from './plan-tools.js';
import {
  writeFileEntry, createCellEntry, updateCellEntry, writeCellEntry,
  requestDeleteCellEntry, deleteCellEntry, saveMemoryEntry,
  createNotebookEntry, createFileEntry,
} from './write-tools.js';
import { runCellEntry, createArtifactEntry } from './exec-tools.js';

export type { ToolEntry };

const ALL_TOOLS: ToolEntry[] = [
  // ASK-level (read)
  listProjectEntry,
  readFileEntry,
  searchNotebookEntry,
  loadMemoryEntry,
  searchEmbeddingsEntry,
  readCellEntry,
  countNotebookCellsEntry,
  // PLAN-level
  createPlanEntry,
  updatePlanEntry,
  // AGENT-level (write)
  writeFileEntry,
  createNotebookEntry,
  createFileEntry,
  createCellEntry,
  updateCellEntry,
  writeCellEntry,
  requestDeleteCellEntry,
  deleteCellEntry,
  saveMemoryEntry,
  // AGENTIC-level (execute)
  runCellEntry,
  createArtifactEntry,
];

export function getPermittedTools(mode: Mode): ToolEntry[] {
  return ALL_TOOLS.filter(t => t.definition.permittedModes.includes(mode));
}

export { setKernelBridge, getKernelBridge } from './exec-tools.js';
