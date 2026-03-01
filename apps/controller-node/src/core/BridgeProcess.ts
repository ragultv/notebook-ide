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

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BridgeMessage {
    type: string;
    notebook_id: string;
    [key: string]: any;
}

export class BridgeProcess extends EventEmitter {
    private process: ChildProcess | null = null;
    private buffer: string = '';
    public notebookId: string;
    public ready: boolean = false;
    private connectionFile: string;
    private pythonPath: string;

    constructor(notebookId: string, pythonPath: string = 'python') {
        super();
        this.notebookId = notebookId;
        this.pythonPath = pythonPath;

        // Connection file path for crash recovery
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const runtimeDir = path.join(homeDir, '.local', 'share', 'jupyter', 'runtime');

        // Ensure runtime directory exists
        if (!fs.existsSync(runtimeDir)) {
            fs.mkdirSync(runtimeDir, { recursive: true });
        }

        this.connectionFile = path.join(runtimeDir, `kernel-${notebookId}.json`);
    }

    async start(reconnect = false): Promise<void> {
        return new Promise((resolve, reject) => {
            // Find bridge script path
            const possiblePaths = [
                // From dist/core/BridgeProcess.js: dist/core -> dist -> controller-node -> .. -> kernel-python
                path.resolve(__dirname, '../../../kernel-python/bridge/kernel_bridge.py'),
                // From src/core/BridgeProcess.ts (development with tsx)
                path.resolve(__dirname, '../../../kernel-python/bridge/kernel_bridge.py'),
                // Fallback from controller-node root
                path.resolve(process.cwd(), '../kernel-python/bridge/kernel_bridge.py'),
            ];

            const bridgeScript = possiblePaths.find(p => fs.existsSync(p));

            if (!bridgeScript) {
                reject(new Error(`Bridge script not found. Tried: ${possiblePaths.join(', ')}`));
                return;
            }

            const args = [
                bridgeScript,
                '--notebook-id', this.notebookId
            ];

            if (reconnect && fs.existsSync(this.connectionFile)) {
                args.push('--reconnect', this.connectionFile);
            }

            this.process = spawn(this.pythonPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: '1',
                    PYTHONIOENCODING: 'utf-8',
                    PYTHONUTF8: '1',
                    PYTHONDONTWRITEBYTECODE: '1',
                    // Allow pip to operate non-interactively without requiring -y flag explicitly.
                    // Shell commands like !pip uninstall run as subprocesses inheriting the kernel's
                    // env; PIP_NO_INPUT=1 would block their stdin and throw an exception.
                    PIP_NO_INPUT: '0',
                    PIP_DISABLE_PIP_VERSION_CHECK: '1',
                    // Remove PYTHONSTARTUP to avoid interference from user startup scripts
                    PYTHONSTARTUP: '',
                },
                windowsHide: true
            });

            // ── stdout: all JSON protocol messages ──────────────────────
            this.process.stdout!.on('data', (chunk: Buffer) => {
                this.buffer += chunk.toString('utf-8');
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() ?? '';

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
                        // Non-JSON from bridge — log but don't crash
                        console.error(`[Bridge ${this.notebookId}] non-JSON: ${trimmed}`);
                    }
                }
            });

            // ── stderr: Python interpreter fatal errors only ─────────────
            this.process.stderr!.on('data', (chunk: Buffer) => {
                const text = chunk.toString('utf-8');
                console.error(`[Bridge ${this.notebookId}] FATAL: ${text}`);
                this.emit('message', {
                    type: 'fatal_error',
                    notebook_id: this.notebookId,
                    text
                });
            });

            this.process.on('exit', (code) => {
                this.ready = false;
                this.emit('exit', code);
            });

            this.process.on('error', (err) => {
                reject(err);
            });

            // Reject if bridge doesn't signal ready within 15s
            setTimeout(() => {
                if (!this.ready) reject(new Error(`Bridge ${this.notebookId} start timeout`));
            }, 15000);
        });
    }

    // Send any JSON command to bridge stdin
    send(message: object): void {
        if (!this.process?.stdin) {
            throw new Error(`Bridge ${this.notebookId} not running`);
        }
        this.process.stdin.write(JSON.stringify(message) + '\n');
    }

    kill(): void {
        this.process?.kill('SIGTERM');
        this.process = null;
        this.ready = false;
    }

    get isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }
}
