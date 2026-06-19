import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  openProject,
  readInRoot,
  writeInRoot,
  readDirInRoot,
  saveWorkspace,
  resolveInRoot,
} from './projectFs';
import { listRecents, addRecent, listTemplates, createFromTemplate } from './launcher';
import type { WorkspaceState } from '../src/project/format';

// Custom scheme that serves files from the open project root (sandboxed). Lets
// the engine fetch project assets (textures via Assets.loadTexture → fetch) and
// is the foundation for file:// packaging. Must be declared before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'estella',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ktx2: 'image/ktx2',
  json: 'application/json',
  esscene: 'application/json',
  fnt: 'text/plain',
};

// The engine's Emscripten/embind glue requires 'unsafe-eval' in the renderer
// CSP (it JIT-compiles call bridges via new Function). That's a deliberate,
// accepted trade-off for this local dev tool, so silence the dev-only warning.
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built directory structure
//
// dist-electron/
//   main.mjs    > Electron main
//   preload.mjs > Preload scripts
// dist/         > Vite renderer build
// public/       > static assets (wasm, sdk, examples) in dev
process.env.APP_ROOT = path.join(__dirname, '..');

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    title: 'Estella Editor',
    backgroundColor: '#0E121B',
    // Frameless-ish chrome: the app draws its own menu/title bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    icon: path.join(VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Keep the renderer sandboxed; all privileged work goes through preload IPC.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

// — Minimal IPC surface (expanded as the editor grows) —
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:platform', () => process.platform);
ipcMain.on('engine:status', (_e, status: string) => console.log('[engine]', status));

// — Project / filesystem (RC12 §E7). The open project root lives here in main;
//   every fs op is sandboxed to it (projectFs.resolveInRoot), so the renderer
//   can only touch files inside the project it opened. —
let projectRoot: string | null = null;
const requireRoot = (): string => {
  if (!projectRoot) throw new Error('no project open');
  return projectRoot;
};

ipcMain.handle('project:openDialog', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Estella Project',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const opened = await openProject(res.filePaths[0]);
  projectRoot = opened.root;
  return opened;
});

ipcMain.handle('project:open', async (_e, root: string) => {
  const opened = await openProject(root);
  projectRoot = opened.root;
  return opened;
});

ipcMain.handle('fs:read', (_e, relPath: string) => readInRoot(requireRoot(), relPath));
ipcMain.handle('fs:write', (_e, relPath: string, contents: string) =>
  writeInRoot(requireRoot(), relPath, contents),
);
ipcMain.handle('fs:readdir', (_e, relPath: string) => readDirInRoot(requireRoot(), relPath));
ipcMain.handle('workspace:save', (_e, ws: WorkspaceState) => saveWorkspace(requireRoot(), ws));

ipcMain.handle('recents:list', () => listRecents());
ipcMain.handle('recents:add', (_e, root: string, name: string) => addRecent(root, name));

// New-project templates + creation (launcher New tab).
ipcMain.handle('templates:list', () => listTemplates());
ipcMain.handle('project:createFromTemplate', (_e, templateDir: string, location: string, name: string) =>
  createFromTemplate(templateDir, location, name),
);
ipcMain.handle('project:chooseDirectory', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a location for the new project',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
});

// Save-As: pick a destination inside the project; returns a project-relative
// path (or null if cancelled). Refuses targets outside the project root.
ipcMain.handle('project:saveDialog', async (_e, defaultRel?: string) => {
  const root = requireRoot();
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, {
    title: 'Save Scene As',
    defaultPath: defaultRel ? path.join(root, defaultRel) : path.join(root, 'assets/scenes'),
    filters: [{ name: 'Estella Scene', extensions: ['esscene'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const rel = path.relative(root, res.filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('scene must be saved inside the project');
  }
  return rel;
});

// estella://project/<relpath> → bytes from the open project root (sandboxed).
async function handleEstella(request: Request): Promise<Response> {
  if (!projectRoot) return new Response('no project open', { status: 503 });
  try {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const abs = resolveInRoot(projectRoot, rel); // throws if it escapes the root
    const bytes = await readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': ASSET_MIME[ext] ?? 'application/octet-stream' },
    });
  } catch (err) {
    return new Response(String(err), { status: 404 });
  }
}

app.whenReady().then(() => {
  protocol.handle('estella', handleEstella);
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  win = null;
  if (process.platform !== 'darwin') app.quit();
});
