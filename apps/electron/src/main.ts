import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs/promises';
import net from 'net';
import path from 'path';

type ControllerModule = {
  startServer: () => Promise<unknown>;
  stopServer: () => Promise<void>;
};

const isDevelopment = !app.isPackaged;
const appResourcesDir = isDevelopment
  ? path.resolve(__dirname, '../../')
  : path.join(process.resourcesPath, 'app-resources');

let mainWindow: BrowserWindow | null = null;
let controllerModule: ControllerModule | null = null;
let controllerUrl = 'http://127.0.0.1:3001';

function getRendererEntry(): string {
  return isDevelopment
    ? 'http://127.0.0.1:3000'
    : path.join(appResourcesDir, 'desktop-ui', 'index.html');
}

function findOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a port')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function importControllerModule(): Promise<ControllerModule> {
  return ((0, eval)('import("controller-node")') as Promise<ControllerModule>);
}

async function startControllerServer(): Promise<void> {
  const port = isDevelopment ? 3001 : await findOpenPort();
  controllerUrl = `http://127.0.0.1:${port}`;

  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.NODE_ENV = isDevelopment ? 'development' : 'production';
  process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');
  process.env.KERNEL_PYTHON_DIR = path.join(appResourcesDir, 'kernel-python');
  process.env.MOJO_DIR = path.join(appResourcesDir, 'mojo');

  controllerModule = await importControllerModule();
  await controllerModule.startServer();
}

async function stopControllerServer(): Promise<void> {
  if (!controllerModule) {
    return;
  }

  await controllerModule.stopServer();
  controllerModule = null;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#09090b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--oprel-controller-url=${controllerUrl}`],
    },
  });

  if (isDevelopment) {
    await mainWindow.loadURL(getRendererEntry());
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(getRendererEntry());
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('dialog:open-notebook', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Jupyter Notebook', extensions: ['ipynb'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const notebookPath = result.filePaths[0];
    const content = await fs.readFile(notebookPath, 'utf-8');
    return {
      path: notebookPath,
      name: path.basename(notebookPath),
      content,
    };
  });

  ipcMain.handle('file:save-notebook', async (_event, payload: { path: string; content: string }) => {
    await fs.writeFile(payload.path, payload.content, 'utf-8');
    return { path: payload.path };
  });

  ipcMain.handle('file:save-notebook-as', async (_event, payload: { suggestedName: string; content: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: payload.suggestedName,
      filters: [
        { name: 'Jupyter Notebook', extensions: ['ipynb'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await fs.writeFile(result.filePath, payload.content, 'utf-8');
    return { path: result.filePath };
  });
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await startControllerServer();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}).catch((error) => {
  console.error('Failed to start Electron application', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  void stopControllerServer();
});
