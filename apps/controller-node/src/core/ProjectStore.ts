import fs from 'fs-extra';
import path from 'path';
import { config } from '../config.js';

function getStoreFile(): string {
    return path.join(config.dataDir, 'projects.json');
}

// ── OctoML project structure ─────────────────────────────────────────────────

/** Folders created inside every new OctoML project. */
export const PROJECT_FOLDERS = ['notebooks', 'data', 'models', 'outputs', 'scripts'];

/** Hidden metadata folder — AI memory, logs, run history, embeddings, cache. */
export const OCTOML_DIR     = '.octoml';
export const OCTOML_SUBDIRS = ['chat-history', 'embeddings', 'memory', 'runs', 'cache', 'logs'];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OctoMLManifest {
    version:         string;
    name:            string;
    description:     string;
    created:         string;  // ISO timestamp
    pythonPath:      string;  // e.g. "python" or "/home/user/.venv/bin/python"
    defaultNotebook: string;  // virtual path, e.g. "/notebooks/getting_started.ipynb"
}

export interface ProjectInfo {
    path: string;
    name: string;
}

export interface RecentProject {
    path:         string;
    name:         string;
    opened:       string;  // ISO timestamp
    lastNotebook?: string; // last-opened notebook virtual path
}

interface StoreData {
    currentProject: ProjectInfo | null;
    recentProjects:  RecentProject[];
}

const defaultStore: StoreData = {
    currentProject: null,
    recentProjects:  [],
};

// ── Starter notebook content ──────────────────────────────────────────────────

function starterNotebook(projectName: string): object {
    return {
        nbformat:       4,
        nbformat_minor: 5,
        metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
        cells: [
            {
                cell_type:       'markdown',
                id:              'intro-md',
                metadata:        {},
                source:          [`# ${projectName}\n\nWelcome to your OctoML project!\n\n` +
                                  `- Project files are in your **Explorer** (left panel)\n` +
                                  `- Use \`PROJECT_ROOT\` variable to reference your project root\n` +
                                  `- Data files: \`data/customers.csv\` (relative to project root)\n`],
            },
            {
                cell_type:       'code',
                id:              'starter-imports',
                metadata:        {},
                source:          ['import os\n\n' +
                                  '# Your project root is automatically set as the working directory\n' +
                                  'print(f"Project: {PROJECT_ROOT}")\n' +
                                  'print(f"CWD:     {os.getcwd()}")\n' +
                                  'print(f"Files:   {os.listdir()}")'],
                execution_count: null,
                outputs:         [],
            },
        ],
    };
}

// ── ProjectStore ──────────────────────────────────────────────────────────────

/**
 * Lightweight singleton that persists project state to data/projects.json.
 * Also manages project initialisation (folder scaffold + octo.json).
 */
export class ProjectStore {
    private static instance: ProjectStore;
    private data: StoreData = defaultStore;

    private constructor() { this.load(); }

    public static getInstance(): ProjectStore {
        if (!ProjectStore.instance) {
            ProjectStore.instance = new ProjectStore();
        }
        return ProjectStore.instance;
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    private load(): void {
        try {
            const storeFile = getStoreFile();
            if (fs.existsSync(storeFile)) {
                const raw = fs.readFileSync(storeFile, 'utf-8');
                this.data = { ...defaultStore, ...JSON.parse(raw) };
            }
        } catch {
            this.data = { ...defaultStore };
        }
    }

    private async persist(): Promise<void> {
        const storeFile = getStoreFile();
        await fs.ensureDir(path.dirname(storeFile));
        await fs.writeJson(storeFile, this.data, { spaces: 2 });
    }

    // ── Current project ───────────────────────────────────────────────────────

    public getCurrentProject(): ProjectInfo | null {
        return this.data.currentProject;
    }

    public async setCurrentProject(proj: ProjectInfo): Promise<void> {
        this.data.currentProject = proj;
        await this.persist();
    }

    public async closeProject(): Promise<void> {
        this.data.currentProject = null;
        await this.persist();
    }

    // ── Recent projects ───────────────────────────────────────────────────────

    public getRecentProjects(): RecentProject[] {
        return this.data.recentProjects;
    }

    public async addRecentProject(proj: ProjectInfo, lastNotebook?: string): Promise<void> {
        this.data.recentProjects = this.data.recentProjects.filter(r => r.path !== proj.path);
        this.data.recentProjects.unshift({
            ...proj,
            opened: new Date().toISOString(),
            ...(lastNotebook ? { lastNotebook } : {}),
        });
        if (this.data.recentProjects.length > 10) {
            this.data.recentProjects = this.data.recentProjects.slice(0, 10);
        }
        await this.persist();
    }

    public async updateRecentNotebook(projectPath: string, lastNotebook: string): Promise<void> {
        const idx = this.data.recentProjects.findIndex(r => r.path === projectPath);
        if (idx !== -1) {
            this.data.recentProjects[idx].lastNotebook = lastNotebook;
            await this.persist();
        }
    }

    // ── Project initialisation ────────────────────────────────────────────────

    /**
     * Create a brand-new project: folder scaffold + octo.json + starter notebook.
     * Returns the octoml manifest.
     */
    public async initProject(projectPath: string, name: string, pythonPath = 'python'): Promise<OctoMLManifest> {
        const resolved = path.resolve(projectPath);

        // 1. Create user-visible project folders
        for (const folder of PROJECT_FOLDERS) {
            await fs.ensureDir(path.join(resolved, folder));
        }

        // 2. Create hidden .octoml metadata directory
        for (const sub of OCTOML_SUBDIRS) {
            await fs.ensureDir(path.join(resolved, OCTOML_DIR, sub));
        }

        // 3. Write octo.json manifest
        const manifest: OctoMLManifest = {
            version:         '1',
            name,
            description:     '',
            created:         new Date().toISOString(),
            pythonPath,
            defaultNotebook: '/notebooks/getting_started.ipynb',
        };
        await fs.writeJson(path.join(resolved, 'octo.json'), manifest, { spaces: 2 });

        // 4. Seed starter notebook
        const notebookPath = path.join(resolved, 'notebooks', 'getting_started.ipynb');
        if (!(await fs.pathExists(notebookPath))) {
            await fs.writeJson(notebookPath, starterNotebook(name), { spaces: 2 });
        }

        return manifest;
    }

    /**
     * Validate an existing project folder.
     * Returns the manifest if found, null if not (legacy project — warn but don't block).
     */
    public async validateProject(projectPath: string): Promise<OctoMLManifest | null> {
        const manifestPath = path.join(projectPath, 'octo.json');
        if (!(await fs.pathExists(manifestPath))) {
            // fallback to older octopod.json for backward compatibility
            const oldManifestPath = path.join(projectPath, 'octopod.json');
            if (!(await fs.pathExists(oldManifestPath))) return null;
            try {
                return await fs.readJson(oldManifestPath) as OctoMLManifest;
            } catch {
                return null;
            }
        }
        try {
            return await fs.readJson(manifestPath) as OctoMLManifest;
        } catch {
            return null;
        }
    }

    /**
     * Read octo.json manifest.
     */
    public async getManifest(projectPath: string): Promise<OctoMLManifest | null> {
        return this.validateProject(projectPath);
    }

    /**
     * Write octo.json manifest.
     */
    public async saveManifest(projectPath: string, manifest: Partial<OctoMLManifest>): Promise<OctoMLManifest> {
        const manifestPath = path.join(projectPath, 'octo.json');
        const existing     = await this.getManifest(projectPath) ?? {} as OctoMLManifest;
        const updated      = { ...existing, ...manifest } as OctoMLManifest;
        await fs.writeJson(manifestPath, updated, { spaces: 2 });
        return updated;
    }

    /**
     * Ensure the .octoml metadata directory exists (idempotent).
     * Call this when opening a legacy project that has no .octoml dir.
     */
    public async ensureOctoMLDir(projectPath: string): Promise<void> {
        for (const sub of OCTOML_SUBDIRS) {
            await fs.ensureDir(path.join(projectPath, OCTOML_DIR, sub));
        }
    }
}

export const projectStore = ProjectStore.getInstance();
