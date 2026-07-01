/**
 * TerminalManager.ts — P1-1: node-pty backed interactive terminal sessions.
 *
 * Each notebook can have one interactive terminal session.
 * Sessions are tied to a sessionId (typically the notebookId).
 * Output is emitted via EventEmitter so WebSocket route can stream it to the browser.
 */

import { EventEmitter } from 'events';

// Local IPty interface — avoids a static import of node-pty which fails under
// NodeNext module resolution when the package lacks an `exports` field.
interface IPty {
    onData(cb: (data: string) => void): void;
    onExit(cb: (info: { exitCode: number; signal?: number }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
}

export interface TerminalSession {
    sessionId: string;
    pty:       IPty;
    cols:      number;
    rows:      number;
    cwd:       string;
}

export class TerminalManager extends EventEmitter {
    private static instance: TerminalManager;
    private sessions: Map<string, TerminalSession> = new Map();

    private constructor() { super(); }

    public static getInstance(): TerminalManager {
        if (!TerminalManager.instance) {
            TerminalManager.instance = new TerminalManager();
        }
        return TerminalManager.instance;
    }

    /**
     * Create a new PTY session for a notebook.
     * If a session already exists for this sessionId it is returned as-is.
     *
     * @param sessionId  - Identifier (usually notebookId)
     * @param cwd        - Working directory for the shell. Defaults to cwd of the Node process.
     * @param cols       - Initial terminal width in columns
     * @param rows       - Initial terminal height in rows
     */
    public async createSession(
        sessionId: string,
        cwd:       string = process.cwd(),
        cols:      number = 80,
        rows:      number = 24
    ): Promise<TerminalSession> {
        if (this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId)!;
        }

        // Dynamic import — node-pty is a native addon and may not be available in all envs.
        // We catch at runtime rather than crashing the whole server.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let nodePty: any;
        try {
            nodePty = await import('node-pty');
        } catch (e) {
            throw new Error(
                'node-pty is not installed or failed to load. ' +
                'Run `npm install node-pty` in controller-node.'
            );
        }

        // On Windows use cmd.exe, on Unix use the user's shell
        const shell = process.platform === 'win32'
            ? 'cmd.exe'
            : (process.env.SHELL || '/bin/bash');

        const ptyProcess: IPty = nodePty.spawn(shell, [], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd,
            env: process.env as Record<string, string>,
        });

        const session: TerminalSession = { sessionId, pty: ptyProcess, cols, rows, cwd };
        this.sessions.set(sessionId, session);

        // Forward all pty output to listeners (WebSocket route subscribes here)
        ptyProcess.onData((data: string) => {
            this.emit('terminal:output', sessionId, data);
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
            this.sessions.delete(sessionId);
            this.emit('terminal:exit', sessionId, exitCode, signal);
        });

        return session;
    }

    /** Write data (keyboard input) to the PTY stdin. */
    public writeToSession(sessionId: string, data: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`No terminal session: ${sessionId}`);
        session.pty.write(data);
    }

    /** Resize the PTY window. */
    public resizeSession(sessionId: string, cols: number, rows: number): void {
        const session = this.sessions.get(sessionId);
        if (!session) return; // graceful — resize after exit is a no-op
        session.pty.resize(cols, rows);
        session.cols = cols;
        session.rows = rows;
    }

    /** Kill and clean up a PTY session. */
    public killSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        try { session.pty.kill(); } catch { /* already dead */ }
        this.sessions.delete(sessionId);
    }

    /** Kill all sessions. Called during graceful shutdown. */
    public killAll(): void {
        for (const sessionId of this.sessions.keys()) {
            this.killSession(sessionId);
        }
    }

    public hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    public getSession(sessionId: string): TerminalSession | undefined {
        return this.sessions.get(sessionId);
    }

    public listSessions(): string[] {
        return [...this.sessions.keys()];
    }
}
