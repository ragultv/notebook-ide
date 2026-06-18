/**
 * ProjectContextService — collects project structure for AI context.
 *
 * The "Project-Aware AI" differentiator: every AI request includes:
 *  - Project name
 *  - Directory tree (which folders/files exist)
 *  - File stats (sizes, types)
 *
 * This lets the AI automatically know "sales.csv is in /data/" without
 * the user having to explain the project structure.
 */

import fs from 'fs-extra';
import path from 'path';
import { projectStore } from './ProjectStore.js';

export interface ProjectFileContext {
    name:        string;
    virtualPath: string;
    type:        'file' | 'directory';
    extension?:  string;
    size?:       number;
    children?:   ProjectFileContext[];
}

export interface ProjectContext {
    projectName:   string;
    projectRoot:   string;   // virtual root "/"
    tree:          ProjectFileContext[];
    summary:       string;   // human-readable summary for AI prompt injection
}

const MAX_TREE_DEPTH = 4;
const MAX_FILES_PER_DIR = 50;

/**
 * Recursively scan the project directory and build a lightweight tree.
 * Excludes .octoml and hidden directories.
 */
async function scanDir(
    dirPath:     string,
    projectRoot: string,
    depth:       number = 0,
): Promise<ProjectFileContext[]> {
    if (depth >= MAX_TREE_DEPTH) return [];

    let entries: fs.Dirent[];
    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }

    const nodes: ProjectFileContext[] = [];
    let count = 0;

    for (const entry of entries) {
        if (count >= MAX_FILES_PER_DIR) break;
        if (entry.name.startsWith('.')) continue; // skip hidden + .octoml

        const osPath     = path.join(dirPath, entry.name);
        const rel        = path.relative(projectRoot, osPath);
        const virtualPath = '/' + rel.split(path.sep).join('/');
        const ext        = entry.name.includes('.') ? path.extname(entry.name) : undefined;
        const isDir      = entry.isDirectory();

        let size: number | undefined;
        try {
            if (!isDir) {
                const stat = await fs.stat(osPath);
                size = stat.size;
            }
        } catch { /* ignore */ }

        const node: ProjectFileContext = {
            name:        entry.name,
            virtualPath,
            type:        isDir ? 'directory' : 'file',
            extension:   ext || undefined,
            size,
        };

        if (isDir) {
            node.children = await scanDir(osPath, projectRoot, depth + 1);
        }

        nodes.push(node);
        count++;
    }

    // Directories first, then files
    nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    return nodes;
}

/**
 * Render the tree as a compact ASCII representation for AI prompt injection.
 */
function renderTree(nodes: ProjectFileContext[], prefix = '', depth = 0): string {
    if (depth > 3) return '';
    let output = '';
    nodes.forEach((node, idx) => {
        const isLast    = idx === nodes.length - 1;
        const connector = isLast ? '└─ ' : '├─ ';
        const childPfx  = isLast ? '   ' : '│  ';
        const sizeStr   = node.size ? ` (${(node.size / 1024).toFixed(1)}KB)` : '';
        output += `${prefix}${connector}${node.name}${sizeStr}\n`;
        if (node.children?.length) {
            output += renderTree(node.children, prefix + childPfx, depth + 1);
        }
    });
    return output;
}

/**
 * Build the full project context for AI prompt injection.
 */
export async function buildProjectContext(): Promise<ProjectContext | null> {
    const project = projectStore.getCurrentProject();
    if (!project) return null;

    const tree = await scanDir(project.path, project.path);

    // Build a human-readable tree summary
    const treeText = renderTree(tree);

    // Collect data files specifically (what the AI is most often asked about)
    const dataFiles:  string[] = [];
    const notebooks:  string[] = [];
    const modelFiles: string[] = [];

    function collectFiles(nodes: ProjectFileContext[]) {
        for (const node of nodes) {
            if (node.type === 'file') {
                const ext = node.extension?.toLowerCase();
                if (['.csv', '.parquet', '.json', '.xlsx', '.xls', '.tsv'].includes(ext || '')) {
                    dataFiles.push(node.virtualPath);
                }
                if (ext === '.ipynb') notebooks.push(node.virtualPath);
                if (['.pkl', '.pt', '.pth', '.h5', '.onnx', '.joblib'].includes(ext || '')) {
                    modelFiles.push(node.virtualPath);
                }
            }
            if (node.children) collectFiles(node.children);
        }
    }
    collectFiles(tree);

    const lines: string[] = [
        `Project: ${project.name}`,
        `\nProject file structure:`,
        `\`\`\``,
        `/`,
        treeText.trimEnd(),
        `\`\`\``,
    ];

    if (dataFiles.length > 0) {
        lines.push(`\nData files available: ${dataFiles.slice(0, 20).join(', ')}`);
    }
    if (notebooks.length > 0) {
        lines.push(`\nNotebooks: ${notebooks.slice(0, 10).join(', ')}`);
    }
    if (modelFiles.length > 0) {
        lines.push(`\nModel files: ${modelFiles.slice(0, 10).join(', ')}`);
    }

    lines.push(
        `\nWhen writing code, paths like "data/customers.csv" resolve relative to the project root.`,
        `The variable PROJECT_ROOT is available in every kernel session.`,
        `Use relative paths (e.g. "data/customers.csv") rather than absolute OS paths.`,
    );

    return {
        projectName: project.name,
        projectRoot: '/',
        tree,
        summary:     lines.join('\n'),
    };
}
