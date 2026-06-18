/**
 * SessionManager.ts — Tracks the active kernel session per notebook.
 *
 * Provides a single source of truth for:
 *   notebookId → kernelId
 *   notebookId → session metadata (start time, last activity, status)
 *
 * Integrates with OutputStore for persistence and EventBus for lifecycle events.
 */

import { eventBus } from '../events/EventBus.js';
import { outputStore } from '../output/OutputStore.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'busy' | 'crashed' | 'stopped';

export interface SessionInfo {
    notebookId: string;
    kernelId: string;
    status: SessionStatus;
    startedAt: number;
    lastActiveAt: number;
}

// ── SessionManager ─────────────────────────────────────────────────────────────

export class SessionManager {
    private static instance: SessionManager;

    /** In-memory session registry. Key: notebookId */
    private sessions: Map<string, SessionInfo> = new Map();

    private constructor() {}

    public static getInstance(): SessionManager {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    public initialize(): void {
        // Bridge from existing KernelManager events into SessionManager state
        eventBus.on('kernel:started', ({ notebookId, kernelId }) => {
            this.registerSession(notebookId, kernelId);
        });

        eventBus.on('kernel:restarted', ({ notebookId, kernelId }) => {
            this.registerSession(notebookId, kernelId);
        });

        eventBus.on('kernel:crashed', ({ notebookId }) => {
            this.updateStatus(notebookId, 'crashed');
        });

        eventBus.on('kernel:reconnected', ({ notebookId }) => {
            this.updateStatus(notebookId, 'idle');
        });

        eventBus.on('kernel:status', ({ notebookId, status }) => {
            if (status === 'busy') {
                this.updateStatus(notebookId, 'busy');
            } else if (status === 'idle') {
                this.updateStatus(notebookId, 'idle');
            } else if (status === 'dead') {
                this.updateStatus(notebookId, 'stopped');
            }
        });

        eventBus.on('notebook:closed', ({ notebookId }) => {
            this.removeSession(notebookId);
        });

        console.log('[SessionManager] Initialized.');
    }

    // ── Session management ─────────────────────────────────────────────────────

    public registerSession(notebookId: string, kernelId: string): void {
        const info: SessionInfo = {
            notebookId,
            kernelId,
            status: 'idle',
            startedAt: Date.now(),
            lastActiveAt: Date.now(),
        };
        this.sessions.set(notebookId, info);
        outputStore.upsertKernelSession(notebookId, kernelId, 'idle');
    }

    public updateStatus(notebookId: string, status: SessionStatus): void {
        const session = this.sessions.get(notebookId);
        if (session) {
            session.status = status;
            session.lastActiveAt = Date.now();
            outputStore.updateKernelStatus(notebookId, status);
        }
    }

    public removeSession(notebookId: string): void {
        this.sessions.delete(notebookId);
        outputStore.removeKernelSession(notebookId);
    }

    // ── Query API ──────────────────────────────────────────────────────────────

    public getSession(notebookId: string): SessionInfo | null {
        return this.sessions.get(notebookId) ?? null;
    }

    public getKernelId(notebookId: string): string | null {
        return this.sessions.get(notebookId)?.kernelId ?? null;
    }

    public getAllSessions(): SessionInfo[] {
        return Array.from(this.sessions.values());
    }

    public isActive(notebookId: string): boolean {
        const s = this.sessions.get(notebookId);
        return s !== undefined && s.status !== 'stopped' && s.status !== 'crashed';
    }
}

export const sessionManager = SessionManager.getInstance();
