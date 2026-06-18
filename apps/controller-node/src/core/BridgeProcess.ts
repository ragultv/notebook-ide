/**
 * Manages one Python Bridge child process per notebook.
 * Only responsibility: spawn bridge, pipe JSON to/from it.
 * Zero protocol logic here.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export interface BridgeMessage {
    type:        string;
    notebook_id: string;
    [key: string]: any;
}

export class BridgeProcess extends EventEmitter {
    private process: ChildProcess | null = null;
    private buffer:  string = '';
    public  notebookId:  string;
    public  ready:       boolean = false;
    private connectionFile: string;
    private pythonPath:  string;
    /** Absolute OS path to the active project root. Passed to kernel_bridge.py via --project-root. */
    public  projectRoot: string | null;

    constructor(notebookId: string, pythonPath: string = 'python', projectRoot: string | null = null) {
        super();
        this.notebookId  = notebookId;
        this.pythonPath  = pythonPath;
        this.projectRoot = projectRoot;

        // Connection file path for crash recovery
        const homeDir    = process.env.HOME || process.env.USERPROFILE || '';
        const runtimeDir = path.join(homeDir, '.local', 'share', 'jupyter', 'runtime');
        if (!fs.existsSync(runtimeDir)) {
            fs.mkdirSync(runtimeDir, { recursive: true });
        }
        this.connectionFile = path.join(runtimeDir, `kernel-${notebookId}.json`);
    }

    /** The OS PID of the spawned bridge process, if running. */
    get pid(): number | undefined {
        return this.process?.pid;
    }

    async start(reconnect = false): Promise<void> {
        return new Promise((resolve, reject) => {
            const possiblePaths = [
                path.resolve(__dirname, '../../../kernel-python/bridge/kernel_bridge.py'),
                path.resolve(process.cwd(), '../kernel-python/bridge/kernel_bridge.py'),
            ];

            const bridgeScript = possiblePaths.find(p => fs.existsSync(p));
            if (!bridgeScript) {
                reject(new Error(`Bridge script not found. Tried: ${possiblePaths.join(', ')}`));
                return;
            }

            const args: string[] = [bridgeScript, '--notebook-id', this.notebookId];

            // ── Project CWD injection ──────────────────────────────────────────
            // kernel_bridge.py will:
            //   1. Set kernel working directory to projectRoot
            //   2. Inject PROJECT_ROOT variable into every new kernel session
            if (this.projectRoot) {
                args.push('--project-root', this.projectRoot);
            }

            if (reconnect && fs.existsSync(this.connectionFile)) {
                args.push('--reconnect', this.connectionFile);
            }

            this.process = spawn(this.pythonPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED:              '1',
                    PYTHONIOENCODING:              'utf-8',
                    PYTHONUTF8:                    '1',
                    PYTHONDONTWRITEBYTECODE:       '1',
                    PIP_NO_INPUT:                  '0',
                    PIP_DISABLE_PIP_VERSION_CHECK: '1',
                    PYTHONSTARTUP:                 '',
                },
                windowsHide: true,
            });

            // P1-7: Write PID file so orphan sweep can find this process on restart.
            if (this.process.pid) {
                this.writePidFile(this.process.pid);
            }

            // ── stdout: all JSON protocol messages ─────────────────────────────
            this.process.stdout!.on('data', (chunk: Buffer) => {
                this.buffer += chunk.toString('utf-8');
                const lines  = this.buffer.split('\n');
                this.buffer  = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const msg = JSON.parse(trimmed) as BridgeMessage;
                        if (msg.type === 'ready') {
                            this.ready = true;
                            resolve();
                        }
                        this.emit('message', msg);
                    } catch {
                        console.error(`[Bridge ${this.notebookId}] non-JSON: ${trimmed}`);
                    }
                }
            });

            // ── stderr: Python interpreter fatal errors ────────────────────────
            this.process.stderr!.on('data', (chunk: Buffer) => {
                const text = chunk.toString('utf-8');
                console.error(`[Bridge ${this.notebookId}] FATAL: ${text}`);
                this.emit('message', { type: 'fatal_error', notebook_id: this.notebookId, text });
            });

            this.process.on('exit', (code) => {
                this.ready = false;
                this.emit('exit', code);
            });

            this.process.on('error', (err) => { reject(err); });

            // Reject if bridge doesn't signal ready within 15s
            setTimeout(() => {
                if (!this.ready) reject(new Error(`Bridge ${this.notebookId} start timeout`));
            }, 15000);
        });
    }

    send(message: object): void {
        if (!this.process?.stdin) {
            throw new Error(`Bridge ${this.notebookId} not running`);
        }
        this.process.stdin.write(JSON.stringify(message) + '\n');
    }

    kill(): void {
        this.deletePidFile();
        this.process?.kill('SIGTERM');
        this.process = null;
        this.ready   = false;
    }

    get isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    // ── PID file helpers (orphan guard) ────────────────────────────────────────

    private static getPidsDir(): string {
        const dataDir = process.env.DATA_DIR || './data';
        return path.resolve(dataDir, 'pids');
    }

    private writePidFile(pid: number): void {
        try {
            const dir = BridgeProcess.getPidsDir();
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                path.join(dir, `${this.notebookId}.pid`),
                JSON.stringify({ pid, notebookId: this.notebookId, ts: Date.now() })
            );
        } catch (e) {
            console.warn('[BridgeProcess] Failed to write PID file:', e);
        }
    }

    private deletePidFile(): void {
        try {
            const pidFile = path.join(BridgeProcess.getPidsDir(), `${this.notebookId}.pid`);
            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
        } catch { /* ignore */ }
    }

    /**
     * P1-7: Sweep stale PID files from a previous crashed session.
     * Called once at startup before any kernel is started.
     */
    public static sweepOrphans(): void {
        const dir = BridgeProcess.getPidsDir();
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir).filter(f => f.endsWith('.pid'));
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const { pid, notebookId } = JSON.parse(raw) as { pid: number; notebookId: string };
                let isAlive = false;
                try { process.kill(pid, 0); isAlive = true; } catch { /* ESRCH */ }
                if (isAlive) {
                    console.warn(`[Orphan] Killing stale kernel pid=${pid} notebook=${notebookId}`);
                    try { process.kill(pid, 'SIGKILL'); } catch { }
                }
            } catch { /* Corrupt PID file */ } finally {
                try { fs.unlinkSync(filePath); } catch { }
            }
        }
    }
}
