import { KernelManager } from '../KernelManager.js';
import type { KernelOutputEvent, KernelExecuteResult, Output } from './types/index.js';

export type { KernelOutputEvent, KernelExecuteResult };

export class KernelBridge {
  private readonly manager: KernelManager;
  private notebookId: string | null = null;
  // The notebook the browser has open (so we can push WS events to it)
  private broadcastNotebookId: string | null = null;
  private broadcastFn: ((notebookId: string, msg: Record<string, unknown>) => void) | null = null;

  constructor() {
    this.manager = KernelManager.getInstance();
  }

  async connect(notebookId: string): Promise<void> {
    this.notebookId = notebookId;
    // Ensure the kernel is started; startKernel is idempotent if already running
    await this.manager.startKernel(notebookId);
  }

  /**
   * Set the broadcast target so agent-executed cells appear in the notebook UI
   * exactly like manually-run cells (running spinner, live output, success/error).
   */
  setBroadcast(
    notebookId: string,
    broadcastFn: (notebookId: string, msg: Record<string, unknown>) => void,
  ): void {
    this.broadcastNotebookId = notebookId;
    this.broadcastFn = broadcastFn;
  }

  /**
   * Update the broadcast target notebook ID dynamically without resetting the function.
   * Useful when the agent creates a new notebook during a session.
   */
  async updateBroadcastId(notebookId: string): Promise<void> {
    this.broadcastNotebookId = notebookId;
    await this.connect(notebookId);
  }

  async disconnect(): Promise<void> {
    this.notebookId = null;
  }

  private send(msg: Record<string, unknown>): void {
    if (this.broadcastFn && this.broadcastNotebookId) {
      this.broadcastFn(this.broadcastNotebookId, msg);
    }
  }

  async executeCell(
    source: string,
    onOutput: (event: KernelOutputEvent) => void,
    cellId?: string,
  ): Promise<KernelExecuteResult> {
    if (!this.notebookId) {
      return { success: false, outputs: [], error: { ename: 'BridgeError', evalue: 'Not connected to a kernel' } };
    }

    const collectedOutputs: Output[] = [];
    const executionId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nbId = this.broadcastNotebookId ?? this.notebookId;

    // Tell the frontend the cell has started — triggers the running spinner + queued state
    if (cellId) {
      this.send({ type: 'execution_started', notebook_id: nbId, cell_id: cellId, execution_id: executionId });
      this.send({ type: 'cell_started',       notebook_id: nbId, cell_id: cellId, execution_id: executionId, queue_position: 0, queue_size: 1 });
    }

    try {
      const result = await this.manager.executeCode(
        this.notebookId,
        source,
        {
          onOutput: (output: Record<string, unknown>) => {
            if (output['type'] === 'stream') {
              const stream = (output['stream'] ?? 'stdout') as 'stdout' | 'stderr';
              const text   = String(output['data'] ?? '');
              onOutput({ stream, text });
              // Stream the output to the cell's output area in real time
              if (cellId) {
                this.send({
                  type:         'output',
                  notebook_id:  nbId,
                  execution_id: executionId,
                  output:       { type: 'stream', stream, data: text },
                });
              }
              collectedOutputs.push({ mime_type: `text/${stream}`, data: text });
            } else if (output['type'] === 'result' || output['type'] === 'display') {
              const data = output['data'] as Record<string, string> | undefined;
              if (data) {
                const mimeType = Object.keys(data)[0] ?? 'text/plain';
                if (cellId) {
                  this.send({
                    type:         'output',
                    notebook_id:  nbId,
                    execution_id: executionId,
                    output:       { type: output['type'] === 'result' ? 'result' : 'display', data },
                  });
                }
                collectedOutputs.push({ mime_type: mimeType, data: data[mimeType] ?? '' });
              }
            }
          },
        },
        executionId
      );

      if (result.status === 'error') {
        const msg = result.error_details ?? result.stderr ?? 'Unknown error';
        if (cellId) {
          this.send({ type: 'execution_error', notebook_id: nbId, execution_id: executionId, cell_id: cellId, error: msg });
        }
        return {
          success: false,
          outputs: collectedOutputs,
          error: { ename: 'ExecutionError', evalue: msg },
        };
      }

      if (cellId) {
        this.send({
          type:         'execution_complete',
          notebook_id:  nbId,
          execution_id: executionId,
          cell_id:      cellId,
          result:       { outputs: collectedOutputs, executionCount: null },
        });
      }

      return { success: true, outputs: collectedOutputs };
    } catch (err) {
      if (cellId) {
        this.send({ type: 'execution_error', notebook_id: nbId, execution_id: executionId, cell_id: cellId, error: String(err) });
      }
      return {
        success: false,
        outputs: collectedOutputs,
        error: { ename: 'BridgeError', evalue: String(err) },
      };
    }
  }
}
