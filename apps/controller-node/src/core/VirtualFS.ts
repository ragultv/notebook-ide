/**
 * VirtualFS — single source of truth for project-scoped path security.
 *
 * The user-facing path model exposes the project root as "/" so that:
 *   /data/customers.csv  →  PROJECT_ROOT/data/customers.csv
 *   /notebooks/x.ipynb  →  PROJECT_ROOT/notebooks/x.ipynb
 *
 * OS absolute paths are NEVER sent to the frontend.
 * All API routes accept virtual paths and resolve them here.
 */

import fs from 'fs-extra';
import path from 'path';

export class VirtualFS {
    private readonly projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
    }

    get root(): string {
        return this.projectRoot;
    }

    /**
     * Convert a virtual path to an OS absolute path.
     * e.g. "/data/file.csv" → "C:/Users/.../project/data/file.csv"
     *
     * Throws 403 on any path traversal attempt.
     */
    resolve(virtualPath: string): string {
        // Normalise: strip leading slashes, convert forward-slashes on Windows
        const cleaned = virtualPath
            .replace(/^\/+/, '')          // strip leading /
            .replace(/\\/g, '/');          // normalise separators

        const joined = path.join(this.projectRoot, cleaned);
        this.assertUnder(joined);
        return joined;
    }

    /**
     * Convert an OS absolute path to a virtual path.
     * e.g. "C:/Users/.../project/data/file.csv" → "/data/file.csv"
     *
     * Throws if the path escapes the project root.
     */
    toVirtual(osPath: string): string {
        const resolved = path.resolve(osPath);
        this.assertUnder(resolved);
        const rel = path.relative(this.projectRoot, resolved);
        // Use forward-slashes in virtual paths regardless of OS
        return '/' + rel.split(path.sep).join('/');
    }

    /**
     * Resolve a virtual path AND verify it has no symlink escapes.
     * Use this for security-sensitive operations (delete, write).
     */
    async resolveSafe(virtualPath: string): Promise<string> {
        const osPath = this.resolve(virtualPath);
        await this.assertNoSymlinkEscape(osPath);
        return osPath;
    }

    /**
     * Returns true when the virtual path is under an .octoml directory.
     * Used to filter .octoml from user-visible file trees.
     */
    isOctoMLPath(virtualPath: string): boolean {
        return virtualPath.startsWith('/.octoml') || virtualPath.includes('/.octoml/');
    }

    /**
     * Returns true when the OS path is inside PROJECT_ROOT/.octoml.
     */
    isOctoMLOsPath(osPath: string): boolean {
        const octomlDir = path.join(this.projectRoot, '.octoml');
        const resolved   = path.resolve(osPath);
        return resolved === octomlDir || resolved.startsWith(octomlDir + path.sep);
    }

    // ── Private helpers ─────────────────────────────────────────────────────────

    private assertUnder(osPath: string): void {
        const resolved = path.resolve(osPath);
        const prefix   = this.projectRoot.endsWith(path.sep)
            ? this.projectRoot
            : this.projectRoot + path.sep;

        if (resolved !== this.projectRoot && !resolved.startsWith(prefix)) {
            const err = new Error('Access denied: path is outside the project root.');
            (err as any).statusCode = 403;
            throw err;
        }
    }

    private async assertNoSymlinkEscape(osPath: string): Promise<void> {
        try {
            const realPath = await fs.realpath(osPath);
            this.assertUnder(realPath);
        } catch (e: any) {
            if (e.code === 'ENOENT') return; // path doesn't exist yet — fine for writes
            throw e;
        }
    }
}

/**
 * Creates a VirtualFS instance from a project path.
 * Throws if no project is set.
 */
export function createVFS(projectRoot: string | null | undefined): VirtualFS {
    if (!projectRoot) {
        const err = new Error('No project is currently open. Open a project first.');
        (err as any).statusCode = 400;
        throw err;
    }
    return new VirtualFS(projectRoot);
}
