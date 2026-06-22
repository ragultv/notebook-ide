import { KernelManager } from '../KernelManager.js';
import type { KernelOutputEvent, KernelExecuteResult, Output } from './types/index.js';

export type { KernelOutputEvent, KernelExecuteResult };

export class KernelBridge {
  private readonly manager: KernelManager;
  private notebookId: string | null = null;

  constructor() {
    this.manager = KernelManager.getInstance();
  }

  async connect(notebookId: string): Promise<void> {
    this.notebookId = notebookId;
    // Ensure the kernel is started; startKernel is idempotent if already running
    await this.manager.startKernel(notebookId);
  }

  async disconnect(): Promise<void> {
    this.notebookId = null;
  }

  async executeCell(
    source: string,
    onOutput: (event: KernelOutputEvent) => void,
  ): Promise<KernelExecuteResult> {
    if (!this.notebookId) {
      return { success: false, outputs: [], error: { ename: 'BridgeError', evalue: 'Not connected to a kernel' } };
    }

    const collectedOutputs: Output[] = [];

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
              collectedOutputs.push({ mime_type: `text/${stream}`, data: text });
            } else if (output['type'] === 'result' || output['type'] === 'display') {
              const data = output['data'] as Record<string, string> | undefined;
              if (data) {
                const mimeType = Object.keys(data)[0] ?? 'text/plain';
                collectedOutputs.push({ mime_type: mimeType, data: data[mimeType] ?? '' });
              }
            }
          },
        },
      );

      if (result.status === 'error') {
        const msg = result.error_details ?? result.stderr ?? 'Unknown error';
        return {
          success: false,
          outputs: collectedOutputs,
          error: { ename: 'ExecutionError', evalue: msg },
        };
      }

      return { success: true, outputs: collectedOutputs };
    } catch (err) {
      return {
        success: false,
        outputs: collectedOutputs,
        error: { ename: 'BridgeError', evalue: String(err) },
      };
    }
  }
}
