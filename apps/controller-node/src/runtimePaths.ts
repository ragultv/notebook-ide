import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const controllerRoot = process.env.CONTROLLER_ROOT
    ? path.resolve(process.env.CONTROLLER_ROOT)
    : path.resolve(__dirname, '..');

const siblingAppsRoot = path.resolve(controllerRoot, '..');

function resolveRuntimePath(explicitPath: string | undefined, fallbackPath: string): string {
    return explicitPath ? path.resolve(explicitPath) : fallbackPath;
}

export const runtimePaths = {
    controllerRoot,
    dataDir: resolveRuntimePath(process.env.DATA_DIR, path.join(controllerRoot, 'data')),
    kernelPythonDir: resolveRuntimePath(
        process.env.KERNEL_PYTHON_DIR,
        path.join(siblingAppsRoot, 'kernel-python'),
    ),
    mojoDir: resolveRuntimePath(
        process.env.MOJO_DIR,
        path.join(siblingAppsRoot, 'mojo'),
    ),
};

export function resolveControllerPath(...segments: string[]): string {
    return path.join(runtimePaths.controllerRoot, ...segments);
}
