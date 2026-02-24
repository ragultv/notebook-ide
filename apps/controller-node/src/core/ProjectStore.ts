import fs from 'fs-extra';
import path from 'path';

const STORE_FILE = path.resolve('./data/projects.json');

export interface ProjectInfo {
    path: string;
    name: string;
}

export interface RecentProject {
    path: string;
    name: string;
    opened: string; // ISO timestamp
}

interface StoreData {
    currentProject: ProjectInfo | null;
    recentProjects: RecentProject[];
}

const defaultStore: StoreData = {
    currentProject: null,
    recentProjects: [],
};

/**
 * Lightweight singleton that persists project state to data/projects.json.
 * All I/O is synchronous at load time; writes are async.
 */
export class ProjectStore {
    private static instance: ProjectStore;
    private data: StoreData = defaultStore;

    private constructor() {
        this.load();
    }

    public static getInstance(): ProjectStore {
        if (!ProjectStore.instance) {
            ProjectStore.instance = new ProjectStore();
        }
        return ProjectStore.instance;
    }

    private load(): void {
        try {
            if (fs.existsSync(STORE_FILE)) {
                const raw = fs.readFileSync(STORE_FILE, 'utf-8');
                this.data = { ...defaultStore, ...JSON.parse(raw) };
            }
        } catch {
            this.data = { ...defaultStore };
        }
    }

    private async persist(): Promise<void> {
        await fs.ensureDir(path.dirname(STORE_FILE));
        await fs.writeJson(STORE_FILE, this.data, { spaces: 2 });
    }

    public getCurrentProject(): ProjectInfo | null {
        return this.data.currentProject;
    }

    public async setCurrentProject(proj: ProjectInfo): Promise<void> {
        this.data.currentProject = proj;
        await this.persist();
    }

    public clearCurrentProject(): void {
        this.data.currentProject = null;
    }

    public getRecentProjects(): RecentProject[] {
        return this.data.recentProjects;
    }

    public async addRecentProject(proj: ProjectInfo): Promise<void> {
        // Remove duplicate entry for same path
        this.data.recentProjects = this.data.recentProjects.filter(r => r.path !== proj.path);
        // Prepend newest
        this.data.recentProjects.unshift({
            ...proj,
            opened: new Date().toISOString(),
        });
        // Cap at 10 recent items
        if (this.data.recentProjects.length > 10) {
            this.data.recentProjects = this.data.recentProjects.slice(0, 10);
        }
        await this.persist();
    }
}

export const projectStore = ProjectStore.getInstance();
