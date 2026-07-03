/**
 * OctoML — Electron Main Process
 *
 * Responsibilities:
 *  1. Create the BrowserWindow
 *  2. Spawn the controller-node backend server
 *  3. Handle IPC: native dialogs, window controls, server status
 *  4. Wait for server to be ready before loading the UI
 */

import {
  app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, protocol, net,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import { pathToFileURL } from 'url';

// ── Custom protocol (VS Code pattern) ─────────────────────────────────────────
// Register BEFORE app.whenReady(). Using a named scheme instead of file://
// gives the renderer a real Origin header (octoml-app://app) instead of null,
// which makes CORS straightforward and removes all ambiguity.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'octoml-app',
    privileges: {
      secure: true,           // treated as HTTPS (no mixed-content warnings)
      standard: true,         // standard URL parsing (allows pathname, hostname, etc.)
      supportFetchAPI: true,  // fetch() works from pages served by this scheme
      corsEnabled: true,      // sends real Origin header instead of null
    },
  },
]);

// Disable default menu bar (File, Edit, View, Window, Help)
Menu.setApplicationMenu(null);

// ── Log file (production only) ────────────────────────────────────────────────
// Writes backend stdout/stderr to ~/.octoml/logs/main.log so crashes are
// diagnosable without DevTools.
function setupLogFile(): fs.WriteStream | null {
  try {
    const logDir = path.join(app.getPath('home'), '.octoml', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    return fs.createWriteStream(path.join(logDir, 'main.log'), { flags: 'a' });
  } catch {
    return null;
  }
}
const logStream = app.isPackaged ? setupLogFile() : null;
function log(...args: any[]) {
  const line = args.join(' ');
  console.log(line);
  logStream?.write(`[${new Date().toISOString()}] ${line}\n`);
}

// ── Config ────────────────────────────────────────────────────────────────────

const isDev        = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_PORT    = parseInt(process.env.VITE_PORT   || '5000', 10);
const SERVER_PORT  = parseInt(process.env.SERVER_PORT || '3001', 10);
const SERVER_URL   = `http://127.0.0.1:${SERVER_PORT}`;
// In production: serve the built frontend via the octoml-app:// custom protocol.
// This gives the renderer a stable, named origin (octoml-app://app) rather than
// a null origin from file://, which makes CORS handling simple and robust.
const RENDERER_URL = isDev
  ? `http://localhost:${VITE_PORT}`
  : 'octoml-app://app/index.html';

// ── State ─────────────────────────────────────────────────────────────────────

let mainWindow:     BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let serverProcess:  ChildProcess  | null = null;
let serverReady    = false;

// ── Controller-node server ────────────────────────────────────────────────────

/**
 * Locate the controller-node entry point.
 * In dev: run via tsx from source. In production: run compiled dist/index.js.
 */
function findServerScript(): { cmd: string; args: string[] } {
  const appRoot = isDev
    ? path.resolve(__dirname, '../../..')         // workspace root in dev
    : path.resolve(process.resourcesPath, 'app'); // bundled resources in prod

  const controllerRoot = path.join(appRoot, 'apps', 'controller-node');

  // Dev mode: use tsx to run TypeScript directly
  if (isDev) {
    const tsxBin = path.join(controllerRoot, 'node_modules', '.bin', 'tsx');
    const srcEntry = path.join(controllerRoot, 'src', 'index.ts');
    if (fs.existsSync(srcEntry)) {
      if (fs.existsSync(tsxBin)) {
        return { cmd: tsxBin, args: [srcEntry] };
      }
      return { cmd: 'npx', args: ['tsx', srcEntry] };
    }
  }

  // Production: run compiled JS using Electron's embedded Node runtime
  const distEntry = path.join(controllerRoot, 'dist', 'index.js');
  return { cmd: process.execPath, args: [distEntry] };
}

function spawnServer(): void {
  const { cmd, args } = findServerScript();
  const controllerRoot = isDev
    ? path.resolve(__dirname, '../../../apps/controller-node')
    : path.join(process.resourcesPath, 'app', 'apps', 'controller-node');

  console.log('[Electron] Spawning server:', cmd, args.join(' '));

  const prodDataDir = path.join(app.getPath('home'), '.octoml', 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(SERVER_PORT),
    NODE_ENV: isDev ? 'development' : 'production',
    ...(isDev ? {} : { ELECTRON_RUN_AS_NODE: '1', DATA_DIR: prodDataDir }),
  };

  const isBatOrCmd = process.platform === 'win32' && (cmd.endsWith('.cmd') || cmd.endsWith('.bat') || cmd === 'npx' || cmd === 'node');

  serverProcess = spawn(cmd, args, {
    cwd:    controllerRoot,
    env,
    stdio:  ['pipe', 'pipe', 'pipe'],
    shell:  isBatOrCmd,
  });

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    log('[Server]', msg);
    mainWindow?.webContents.send('server:log', msg);
    if (msg.includes('Server listening') || msg.includes('listening at')) {
      serverReady = true;
    }
  });

  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    log('[Server Error]', msg);
    mainWindow?.webContents.send('server:error', msg);
  });

  serverProcess.on('exit', (code) => {
    log('[Server] Exited with code:', code);
    serverReady = false;
  });
}

/**
 * Poll the server health endpoint until it responds 200.
 */
function waitForServer(timeout = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start    = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('Server startup timed out'));
        return;
      }
      http.get(`${SERVER_URL}/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          serverReady = true;
          resolve();
        }
      }).on('error', () => { /* server not ready yet */ });
    }, 500);
  });
}

// ── BrowserWindow ─────────────────────────────────────────────────────────────

function createWindow(): void {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width:          1400,
    height:         900,
    minWidth:       900,
    minHeight:      600,
    show:           false,                    // shown after ready-to-show
    frame:          false,                    // hide default OS window controls
    backgroundColor: '#0d0d0f',              // match app dark background
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      nodeIntegration:   false,              // security: no direct Node access
      contextIsolation:  true,              // security: context bridge only
      sandbox:           false,              // needed for contextBridge with preload
      webSecurity:       true,
    },
    icon: getAppIcon(),
  });

  mainWindow.webContents.on('console-message', (e, level, message) => {
    console.log(`[Renderer] ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load renderer with retry logic (useful in dev mode when Vite is booting)
  const loadRenderer = () => {
    mainWindow?.loadURL(RENDERER_URL).catch((err) => {
      console.warn('[Electron] Failed to load renderer URL, retrying in 500ms...', err.message);
      setTimeout(loadRenderer, 500);
    });
  };

  mainWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
    if (errorCode === -102) { // ERR_CONNECTION_REFUSED
      console.log('[Electron] Connection refused, retrying in 1s...');
      setTimeout(loadRenderer, 1000);
    }
  });

  loadRenderer();

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function openSettingsWindow(): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  nativeTheme.themeSource = 'dark';

  settingsWindow = new BrowserWindow({
    width:          900,
    height:         700,
    minWidth:       800,
    minHeight:      600,
    show:           false,
    frame:          false,
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      nodeIntegration:   false,
      contextIsolation:  true,
      sandbox:           false,
      webSecurity:       true,
    },
    icon: getAppIcon(),
  });

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
  });

  const settingsUrl = `${RENDERER_URL}?view=settings`;

  const loadRenderer = () => {
    settingsWindow?.loadURL(settingsUrl).catch((err) => {
      console.warn('[Electron] Failed to load settings URL, retrying in 500ms...', err.message);
      setTimeout(loadRenderer, 500);
    });
  };

  settingsWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
    if (errorCode === -102) {
      setTimeout(loadRenderer, 1000);
    }
  });

  loadRenderer();

  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function getAppIcon(): string | undefined {
  const iconName = process.platform === 'darwin' ? 'icon.icns' : 'icon.png';

  const iconPath = isDev
    ? path.join(__dirname, '../assets', iconName)
    : path.join(process.resourcesPath, 'assets', iconName);

  return fs.existsSync(iconPath) ? iconPath : undefined;
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

function registerIPCHandlers(): void {

  // ── Native dialogs ──────────────────────────────────────────────────────────

  ipcMain.handle('dialog:showFolder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title:      'Select or Create Project Folder',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('shell:openPath', async (_event, osPath: string) => {
    try {
      const err = await shell.openPath(osPath);
      return { success: !err, error: err || undefined };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('dialog:showOpenFile', async (_event, options: any = {}) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters:    options.filters || [],
      title:      'Open File',
    });
    return result.canceled ? null : result.filePaths;
  });

  // ── App info ────────────────────────────────────────────────────────────────

  ipcMain.handle('app:getVersion',  () => app.getVersion());
  ipcMain.handle('app:getPlatform', () => process.platform);

  // ── Server ──────────────────────────────────────────────────────────────────

  ipcMain.handle('server:getPort',  () => SERVER_PORT);
  ipcMain.handle('server:isReady',  () => serverReady);

  // ── Window controls ─────────────────────────────────────────────────────────

  ipcMain.on('window:minimize', () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.minimize();
  });
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window:close', () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.close();
  });
  ipcMain.handle('window:isMaximized', () => {
    const win = BrowserWindow.getFocusedWindow();
    return win?.isMaximized() ?? false;
  });
  ipcMain.on('window:openSettings', () => openSettingsWindow());
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // 0. Register the octoml-app:// protocol handler (production only).
  //    Serves the built React/Vite frontend from the bundled resources directory.
  if (!isDev) {
    const frontendRoot = path.join(process.resourcesPath, 'app', 'apps', 'desktop-ui');
    protocol.handle('octoml-app', (request) => {
      const { pathname } = new URL(request.url);
      // Strip leading slash; fall back to index.html for SPA client-side routes
      let filePath = path.join(frontendRoot, pathname.replace(/^\//, ''));
      try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          filePath = path.join(frontendRoot, 'index.html');
        }
      } catch {
        filePath = path.join(frontendRoot, 'index.html');
      }
      return net.fetch(pathToFileURL(filePath).toString());
    });
  }

  registerIPCHandlers();

  // 1. Spawn the backend server
  spawnServer();

  // 2. Create the window immediately (shows a loading state)
  createWindow();

  // 3. Wait for server to be ready, then tell the renderer
  try {
    await waitForServer();
    log('[Electron] Server is ready on port', SERVER_PORT);
    mainWindow?.webContents.send('server:log', `[READY] Server listening on :${SERVER_PORT}`);
  } catch (err) {
    log('[Electron] Server startup failed:', err);
    mainWindow?.webContents.send('server:error', 'Server failed to start. Please restart the app.');
  }

  // 4. Background auto-updates (VS Code style)
  if (!isDev) {
    autoUpdater.logger = console;
    autoUpdater.checkForUpdatesAndNotify().catch(console.error);
    
    autoUpdater.on('update-available', () => console.log('[Updater] Update available.'));
    autoUpdater.on('update-downloaded', () => console.log('[Updater] Update downloaded; will install on quit.'));
  }

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Gracefully shut down the backend server
  if (serverProcess) {
    console.log('[Electron] Stopping server process...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

// Security: prevent loading non-local URLs
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    const allowed = ['localhost', '127.0.0.1'];
    if (!allowed.includes(parsed.hostname)) {
      event.preventDefault();
      console.warn('[Security] Blocked navigation to:', url);
    }
  });
});
