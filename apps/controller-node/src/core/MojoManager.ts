import { PassThrough } from 'stream';
import { execa } from 'execa';
import { DockerClient, Filter } from '@docker/node-sdk';

export interface MojoCellResult {
  success: boolean;
  output: string;
  error?: string;
}

export class MojoManager {
  private static instance: MojoManager;
  private dockerPromise?: Promise<DockerClient>;

  private constructor() {}

  public static getInstance(): MojoManager {
    if (!MojoManager.instance) {
      MojoManager.instance = new MojoManager();
    }
    return MojoManager.instance;
  }

  private async docker(): Promise<DockerClient> {
    if (!this.dockerPromise) {
      this.dockerPromise = DockerClient.fromDockerConfig().catch((err) => {
        throw new Error(`Docker connection failed: ${err?.message ?? String(err)}`);
      });
    }
    return this.dockerPromise;
  }

  public async startNotebook(notebookId: string, workspaceDir: string): Promise<void> {
    const docker = await this.docker();

    // If the container already exists, start it if needed.
    try {
      const existing = await this.findContainerForNotebook(docker, notebookId);
      if (existing && existing.Id) {
        if (existing.State !== 'running') {
          await docker.containerStart(existing.Id);

          const inspected = await docker.containerInspect(existing.Id);
          const state = inspected?.State?.Status;
          const errorMsg = (inspected?.State?.Error || '').toLowerCase();

          // If the container still isn't running, it may have failed to start due to GPU/runtime issues.
          if (!inspected?.State?.Running && (state === 'created' || errorMsg.includes('nvidia-container-cli') || errorMsg.includes('libnvidia-ml') || errorMsg.includes('failed to create task'))) {
            console.warn('[MOJO] Existing container failed to start; recreating in CPU-only mode');
            try {
              await docker.containerDelete(existing.Id, { force: true });
            } catch {
              // ignore
            }
            // Let the creation logic below run.
          } else {
            return;
          }
        } else {
          return;
        }
      }
    } catch (err: any) {
      throw new Error(`Failed to query existing Mojo containers: ${err?.message ?? String(err)}`);
    }

    // Ensure the required image exists (pull if needed). This makes the user path smoother.
    try {
      await docker.imageInspect('mojocuda');
    } catch (err: any) {
      console.log('[MOJO] Image `mojocuda` not found locally, pulling...');
      try {
        const pull = await docker.imageCreate({ fromImage: 'mojocuda' });
        await pull.wait();
      } catch (pullErr: any) {
        console.error('[MOJO] Failed to pull image `mojocuda`:', pullErr);
        throw new Error(`Failed to pull Docker image 'mojocuda': ${pullErr?.message ?? String(pullErr)}`);
      }
    }

    try {
      const wantsGpu = process.env.MOJO_ENABLE_GPU === '1';

      const createOpts: any = {
        Image: 'mojocuda',
        Tty: true,
        HostConfig: {
          Binds: [`${workspaceDir}:/workspace`],
        },
        WorkingDir: '/workspace',
        Cmd: ['bash', '-lc', 'while true; do sleep 1; done'],
        Labels: {
          'notebook-ide': 'mojo',
          'notebook-id': notebookId,
        },
      };

      if (wantsGpu) {
        createOpts.HostConfig.DeviceRequests = [
          {
            Driver: 'nvidia',
            Count: -1,
            Capabilities: [['gpu']],
          },
        ];
      }

      let containerId: string;

      try {
        const result = await docker.containerCreate(createOpts, { name: `notebook-ide-mojo-${notebookId}` });
        containerId = result.Id;
      } catch (createErr: any) {
        const msg = (createErr?.message || '').toLowerCase();
        // Common failure when NVIDIA drivers/libs are not installed.
        if (msg.includes('nvidia-container-cli') || msg.includes('libnvidia-ml')) {
          console.warn('[MOJO] GPU not available; falling back to CPU-only container start');
          // Retry without GPU request
          // Remove GPU device request to allow CPU-only container creation
          // (TypeScript requires optional chaining for delete on a possibly undefined property)
          if (createOpts.HostConfig) {
            delete createOpts.HostConfig.DeviceRequests;
          }
          const result = await docker.containerCreate(createOpts, { name: `notebook-ide-mojo-${notebookId}` });
          containerId = result.Id;
        } else {
          throw createErr;
        }
      }

      try {
        await docker.containerStart(containerId);
      } catch (startErr: any) {
        const msg = (startErr?.message || '').toLowerCase();
        if (msg.includes('nvidia-container-cli') || msg.includes('libnvidia-ml') || msg.includes('failed to create task')) {
          console.warn('[MOJO] GPU start failed; retrying without GPU support');
          // Remove the failed container and recreate without GPU device requests
          try {
            await docker.containerDelete(containerId, { force: true });
          } catch {
            // ignore
          }

          if (createOpts.HostConfig) {
            delete createOpts.HostConfig.DeviceRequests;
          }

          const retry = await docker.containerCreate(createOpts, { name: `notebook-ide-mojo-${notebookId}` });
          await docker.containerStart(retry.Id);
        } else {
          throw startErr;
        }
      }

      // Verify the container actually started and isn't stuck in "created" state.
      const started = await docker.containerInspect(containerId);
      const errorMsg = (started?.State?.Error || '').toLowerCase();
      if (!started?.State?.Running && (errorMsg.includes('nvidia-container-cli') || errorMsg.includes('libnvidia-ml') || errorMsg.includes('failed to create task'))) {
        console.warn('[MOJO] Container failed to start due to GPU runtime issue; recreating without GPU support');
        try {
          await docker.containerDelete(containerId, { force: true });
        } catch {
          // ignore
        }
        if (createOpts.HostConfig) {
          delete createOpts.HostConfig.DeviceRequests;
        }
        const retry = await docker.containerCreate(createOpts, { name: `notebook-ide-mojo-${notebookId}` });
        await docker.containerStart(retry.Id);
      }
    } catch (err: any) {
      throw new Error(`Failed to create/start Mojo container: ${err?.message ?? String(err)}`);
    }
  }

  public async stopNotebook(notebookId: string): Promise<void> {
    const docker = await this.docker();
    const container = await this.findContainerForNotebook(docker, notebookId);
    if (!container?.Id) return;

    try {
      await docker.containerStop(container.Id, { timeout: 0 });
    } catch {
      // ignore
    }
    try {
      await docker.containerDelete(container.Id, { force: true });
    } catch {
      // ignore
    }
  }

  public async runCell(notebookId: string, code: string): Promise<MojoCellResult> {
    const docker = await this.docker();
    const container = await this.findContainerForNotebook(docker, notebookId);
    if (!container?.Id) {
      throw new Error('Mojo container not started');
    }

    const inspected = await docker.containerInspect(container.Id);
    if (!inspected?.State?.Running) {
      const stateInfo = inspected?.State?.Status || inspected?.State?.Error || 'unknown';
      throw new Error(`Mojo container is not running (state: ${stateInfo}). Please start the container before running code.`);
    }

    const containerName = `notebook-ide-mojo-${notebookId}`;

    // Write code into container using base64 to avoid shell quoting issues
    const encoded = Buffer.from(code, 'utf-8').toString('base64');
    const writeCmd = `echo ${encoded} | base64 -d > /workspace/__mojo_temp__.mojo`;

    try {
      const writeResult = await execa('docker', ['exec', '-i', containerName, 'sh', '-lc', writeCmd], { all: true });
      if (writeResult.exitCode !== 0) {
        return {
          success: false,
          output: writeResult.all || '',
          error: writeResult.all || 'Failed to write Mojo code into container',
        };
      }
    } catch (writeErr: any) {
      return {
        success: false,
        output: writeErr.all || writeErr.stderr || writeErr.stdout || String(writeErr),
        error: writeErr.all || writeErr.stderr || writeErr.stdout || String(writeErr),
      };
    }

    try {
      const runResult = await execa('docker', ['exec', '-i', containerName, 'sh', '-lc', 'mojo /workspace/__mojo_temp__.mojo'], { all: true });
      return {
        success: runResult.exitCode === 0,
        output: runResult.all || '',
        error: runResult.exitCode === 0 ? undefined : runResult.all || 'Mojo execution failed',
      };
    } catch (runErr: any) {
      return {
        success: false,
        output: runErr.all || runErr.stderr || runErr.stdout || String(runErr),
        error: runErr.all || runErr.stderr || runErr.stdout || String(runErr),
      };
    }
  }

  private async runExecAndCollectOutput(docker: DockerClient, execId: string) {
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    let output = '';
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf-8');
    };

    stdout.on('data', append);
    stderr.on('data', append);

    await docker.execStart(execId, stdout, stderr, { Detach: false, Tty: false });

    const inspect = await docker.execInspect(execId);
    return { output, exitCode: inspect.ExitCode ?? -1 };
  }

  private async findContainerForNotebook(docker: DockerClient, notebookId: string) {
    const filters = new Filter().set('label', [`notebook-id=${notebookId}`]);
    const containers = await docker.containerList({ all: true, filters });
    return containers?.[0];
  }
}
