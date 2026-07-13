/**
 * Pre-warmed Kernel Pool — eliminates cold-start latency.
 * When a notebook claims a kernel, we immediately warm another.
 */

import { BridgeProcess } from './BridgeProcess.js';
import { v4 as uuidv4 } from 'uuid';

// P1-8: Pool size is configurable via KERNEL_POOL_SIZE env var.
// Default to 0 so no Python processes are eagerly spawned on app startup.
const POOL_SIZE = Math.min(10, Math.max(0, parseInt(process.env.KERNEL_POOL_SIZE || '0', 10)));
const pool: BridgeProcess[] = [];
let isInitializing = false;

export async function initPool(pythonPath: string = 'python'): Promise<void> {
    if (isInitializing) return;
    isInitializing = true;
    
    console.log('[KernelPool] Initializing with size:', POOL_SIZE);
    
    for (let i = 0; i < POOL_SIZE; i++) {
        try {
            await addToPool(pythonPath);
        } catch (e) {
            console.error('[KernelPool] Failed to add kernel to pool:', e);
        }
    }
    
    console.log('[KernelPool] Initialized with', pool.length, 'kernels');
    isInitializing = false;
}

async function addToPool(pythonPath: string): Promise<void> {
    const tempId = `pool_${uuidv4()}`;
    const bridge = new BridgeProcess(tempId, pythonPath);
    
    try {
        await bridge.start();
        pool.push(bridge);
        console.log('[KernelPool] Added kernel to pool, size:', pool.length);
    } catch (e) {
        console.error('[KernelPool] Failed to start pooled kernel:', e);
        throw e;
    }
}

export async function claimFromPool(
    notebookId:  string,
    pythonPath:  string = 'python',
    projectRoot: string | null = null,
): Promise<BridgeProcess> {
    if (pool.length > 0) {
        const bridge = pool.shift()!;

        // Update notebook ID and project root on the claimed bridge
        bridge.notebookId  = notebookId;
        bridge.projectRoot = projectRoot;

        // Send command to bridge to update its notebook ID
        bridge.send({ type: 'set_notebook_id', notebook_id: notebookId });

        // If we have a project root, send the CWD command to the already-running kernel
        // (pool kernels start without a project root, so we inject it post-claim)
        if (projectRoot) {
            bridge.send({
                type:        'set_project_root',
                notebook_id: notebookId,
                project_root: projectRoot,
            });
        }

        // Immediately warm a replacement (non-blocking)
        addToPool(pythonPath).catch(err => {
            console.error('[KernelPool] Failed to warm replacement kernel:', err);
        });

        console.log('[KernelPool] Claimed kernel for', notebookId, ', pool size:', pool.length);
        return bridge;
    }

    // Pool empty — cold start with project root
    console.log('[KernelPool] Pool empty, cold starting kernel for', notebookId);
    const bridge = new BridgeProcess(notebookId, pythonPath, projectRoot);
    await bridge.start();
    return bridge;
}


export function getPoolStatus(): { size: number; maxSize: number } {
    return {
        size: pool.length,
        maxSize: POOL_SIZE
    };
}

export async function drainPool(): Promise<void> {
    console.log('[KernelPool] Draining pool...');
    
    while (pool.length > 0) {
        const bridge = pool.shift()!;
        try {
            bridge.send({ type: 'shutdown', notebook_id: bridge.notebookId });
            setTimeout(() => bridge.kill(), 500);
        } catch (e) {
            // Ignore errors during shutdown
        }
    }
    
    console.log('[KernelPool] Pool drained');
}
