// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  openProject,
  readManifest,
  readInRoot,
  writeInRoot,
  readDirInRoot,
  renameInRoot,
  mkdirInRoot,
  duplicateInRoot,
  statInRoot,
  saveWorkspace,
  resolveInRoot,
  META_EXT,
} from './projectFs';
import { listRecents, addRecent, listTemplates, createFromTemplate } from './launcher';
import { buildProjectScripts } from './buildScripts';
import { extractProjectSchemas } from './extractSchemas';
import { scanAssetDatabase } from './assetDb';
import { cookAssets } from './cookAssets';
import { startProjectWatch, stopProjectWatch } from './projectWatcher';
import { importAssets, IMPORT_EXTENSIONS } from './importAssets';
import { exportGame } from './exportGame';
import { buildPlayRealm } from './buildPlayRealm';
import { resolveScripts } from '../src/project/format';
import type { WorkspaceState } from '../src/project/format';

// Two privileged custom schemes (must be declared before app ready):
//  • estella:// serves files from the open project root (sandboxed) — lets the
//    engine fetch project assets (textures via Assets.loadTexture → fetch).
//  • app://     serves the built renderer (dist/) so the editor + play realm load
//    over a STABLE origin instead of file://. Under file:// the engine glue path
//    `${location.origin}/wasm/esengine.js` resolves to the filesystem root (404);
//    app:// gives a real origin where `/wasm/...` + the play iframe resolve.
// corsEnabled: the renderer reads texture pixels via `<img crossOrigin>` (TextureLoader)
// + `fetch`, which are CORS requests. Without it Chromium rejects custom-scheme cross-
// origin at the scheme level (even though the handler returns `access-control-allow-origin:
// *`) — blocking project textures in dev (http://localhost origin) and any cross-scheme load.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'estella',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// The app:// renderer origin (host is arbitrary; `local` keeps URLs readable).
const APP_ORIGIN = 'app://local';

const ASSET_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ktx2: 'image/ktx2',
  json: 'application/json',
  esscene: 'application/json',
  fnt: 'text/plain',
  // The play realm is served from estella:// too (host page + SDK + bundle + wasm),
  // so estella must hand back script/document/wasm types, not just asset types.
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  wasm: 'application/wasm',
  css: 'text/css',
};

// MIME for serving the built renderer over app:// (wasm MUST be application/wasm
// for streaming compile; js/mjs must be a script type).
const APP_MIME: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  wasm: 'application/wasm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  ktx2: 'image/ktx2',
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
    // Load over app:// (not file://) so the engine glue + play realm resolve from
    // a real origin. handleApp serves dist/.
    win.loadURL(`${APP_ORIGIN}/index.html`);
  }

  // Unsaved-changes quit guard: prompt before closing a window with a dirty scene.
  // `sceneDirty` is pushed from the renderer (app:dirty); `quitting` lets the chosen
  // action close past this handler.
  win.on('close', (e) => {
    if (quitting || !sceneDirty || !win) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes before closing?',
      detail: 'Your scene has unsaved changes that will be lost otherwise.',
    });
    if (choice === 2) return; // Cancel → keep the window open
    if (choice === 1) { quitting = true; win.destroy(); return; } // Don't Save
    // Save → ask the renderer to write the scene, then close when it confirms.
    ipcMain.once('app:quitConfirmed', () => { quitting = true; win?.destroy(); });
    win.webContents.send('app:saveBeforeQuit');
  });
}

// The renderer's current unsaved-changes state, mirrored for the close guard above.
let sceneDirty = false;
// Set once the user has chosen to close (Save/Don't Save), so win.destroy() is allowed through.
let quitting = false;
ipcMain.on('app:dirty', (_e, dirty: boolean) => { sceneDirty = !!dirty; });

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

// Adopt a freshly opened project as the active root + (re)start the fs watcher
// so on-disk changes push to the renderer.
function adoptRoot(root: string): void {
  projectRoot = root;
  if (win) startProjectWatch(root, win.webContents);
}

ipcMain.handle('project:openDialog', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Estella Project',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const opened = await openProject(res.filePaths[0]);
  adoptRoot(opened.root);
  return opened;
});

ipcMain.handle('project:open', async (_e, root: string) => {
  const opened = await openProject(root);
  adoptRoot(opened.root);
  return opened;
});

// Import: OS file picker → copy the chosen files into `destDir` + write `.meta`.
ipcMain.handle('project:importAssets', async (_e, destDir: string) => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Import Assets',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Assets', extensions: IMPORT_EXTENSIONS },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return importAssets(requireRoot(), destDir, res.filePaths);
});

// Import already-resolved absolute paths (OS drag-drop onto the Content Browser).
ipcMain.handle('project:importFiles', (_e, destDir: string, sources: string[]) =>
  importAssets(requireRoot(), destDir, sources),
);

ipcMain.handle('fs:read', (_e, relPath: string) => readInRoot(requireRoot(), relPath));
ipcMain.handle('fs:write', (_e, relPath: string, contents: string) =>
  writeInRoot(requireRoot(), relPath, contents),
);
ipcMain.handle('fs:readdir', (_e, relPath: string) => readDirInRoot(requireRoot(), relPath));
ipcMain.handle('fs:rename', (_e, fromRel: string, toRel: string) =>
  renameInRoot(requireRoot(), fromRel, toRel),
);
ipcMain.handle('fs:mkdir', (_e, relPath: string) => mkdirInRoot(requireRoot(), relPath));
ipcMain.handle('fs:duplicate', (_e, relPath: string) => duplicateInRoot(requireRoot(), relPath));
ipcMain.handle('fs:stat', (_e, relPath: string) => statInRoot(requireRoot(), relPath));
// Delete to the OS trash (recoverable, not an unrecoverable rm) — the asset's
// `.meta` sidecar goes with it so no orphan stays in the registry.
ipcMain.handle('fs:trash', async (_e, relPath: string) => {
  const abs = resolveInRoot(requireRoot(), relPath);
  await shell.trashItem(abs);
  const meta = abs + META_EXT;
  if (existsSync(meta)) await shell.trashItem(meta);
});
// Reveal a file/folder in the OS file manager (Finder / Explorer).
ipcMain.handle('shell:showItem', (_e, relPath: string) => {
  shell.showItemInFolder(resolveInRoot(requireRoot(), relPath));
});
// Open an absolute path in the OS (e.g. a build output dir the user just chose).
ipcMain.handle('shell:openPath', (_e, absPath: string) => shell.openPath(absPath));
ipcMain.handle('workspace:save', (_e, ws: WorkspaceState) => saveWorkspace(requireRoot(), ws));

// Bundle the open project's startup script (manifest scripts.main, default
// src/main.ts → .esengine/cache, esengine external) for the isolated play realm
// (REARCH_EDITOR_REALM P1/P3 / RC12 §E8-1).
ipcMain.handle('project:buildScripts', async () => {
  const root = requireRoot();
  const { main } = resolveScripts(await readManifest(root));
  return buildProjectScripts(root, { entry: main });
});

// Extract the open project's component field schemas (manifest scripts.register,
// default src/components.ts → .esengine/cache/schemas.json) so the editor main
// realm can inspect unknown components without executing project code. An
// explicitly-declared register that's missing is an error; the default merely
// being absent means the project has no custom components (REARCH_EDITOR_REALM P2/P3).
ipcMain.handle('project:extractSchemas', async () => {
  const root = requireRoot();
  const manifest = await readManifest(root);
  const { register } = resolveScripts(manifest);
  return extractProjectSchemas(root, { entry: register, required: manifest.scripts?.register !== undefined });
});

// Scan the open project's `.meta` sidecars → the asset index (uuid↔path registry
// + dependency graph) written to .esengine/cache/assets.json. The editor feeds
// this into the engine Assets registry (one resolution path) and the Content
// Browser; the cook walks `deps` (REARCH_ASSETS.md A2).
ipcMain.handle('project:scanAssets', async () => scanAssetDatabase(requireRoot()));

// Cook the project's assets for shipping: from the entry scene, walk the
// dependency graph to the reachable assets, stage them into `outDir`, and emit
// the runtime manifest — culling unreferenced assets (REARCH_ASSETS.md A4).
ipcMain.handle('project:cookAssets', async (_e, outDir?: string) => {
  const root = requireRoot();
  const manifest = await readManifest(root);
  const entry = manifest.defaultScene;
  return cookAssets(root, { entryScenes: entry ? [entry] : [], outDir: outDir ?? 'build' });
});

// Export a runnable web build (play == ship): cook + game host + wasm + index.html.
ipcMain.handle(
  'project:exportGame',
  async (e, opts?: { outDir?: string; minify?: boolean; sourcemap?: boolean; platform?: 'web' | 'desktop' | 'wechat' | 'playable' }) => {
    const root = requireRoot();
    const manifest = await readManifest(root);
    const entryScene = manifest.defaultScene;
    if (!entryScene) throw new Error('project has no defaultScene to export');
    const sdkDistDir = path.join(process.env.APP_ROOT!, 'node_modules', 'esengine', 'dist');
    const publicWasm = path.join(VITE_PUBLIC, 'wasm');
    const webWasm = existsSync(publicWasm) ? publicWasm : path.join(RENDERER_DIST, 'wasm');
    // WeChat needs the -t wechat runtime (WXWebAssembly glue); build it with
    // `node build-tools/cli.js build -t wechat`. Absent → exportWeChat warns.
    const wechatWasm = [path.join(VITE_PUBLIC, 'wasm-wechat'), path.join(process.env.APP_ROOT!, '..', 'build', 'wasm', 'wechat')]
      .find(existsSync) ?? path.join(VITE_PUBLIC, 'wasm-wechat');
    const plat = manifest.packaging?.platforms;
    return exportGame({
      root,
      entryScene,
      gameHostEntry: path.join(process.env.APP_ROOT!, 'src', 'gameHost.ts'),
      playableHostEntry: path.join(process.env.APP_ROOT!, 'src', 'playableHost.ts'),
      scriptsEntry: resolveScripts(manifest).main,
      sdkDistDir,
      wasmDir: opts?.platform === 'wechat' ? wechatWasm : webWasm,
      outDir: opts?.outDir || 'dist-game',
      title: manifest.name,
      platform: opts?.platform,
      desktopAppId: plat?.desktop?.appId,
      desktopProductName: plat?.desktop?.productName,
      wechatAppid: plat?.wechat?.appid,
      wechatOrientation: plat?.wechat?.orientation,
      minify: opts?.minify,
      sourcemap: opts?.sourcemap,
      onProgress: (p) => e.sender.send('project:exportProgress', p),
    });
  },
);

// Stage the isolated play realm under the project's .esengine/play/ (host + SDK +
// wasm + import map) and build the project's script bundle, so the editor can run
// it from estella://project/.esengine/play/play.html with custom components/systems.
ipcMain.handle('project:preparePlayRealm', async () => {
  const root = requireRoot();
  const manifest = await readManifest(root);
  const { main } = resolveScripts(manifest);
  // Best-effort: a project with no scripts entry just runs builtin-only.
  try {
    await buildProjectScripts(root, { entry: main });
  } catch {
    /* no bundle — builtin components/systems only */
  }
  const publicWasm = path.join(VITE_PUBLIC, 'wasm');
  return buildPlayRealm({
    root,
    playHostEntry: path.join(process.env.APP_ROOT!, 'src', 'playHost.ts'),
    sdkDistDir: path.join(process.env.APP_ROOT!, 'node_modules', 'esengine', 'dist'),
    wasmDir: existsSync(publicWasm) ? publicWasm : path.join(RENDERER_DIST, 'wasm'),
  });
});

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
      headers: {
        'content-type': ASSET_MIME[ext] ?? 'application/octet-stream',
        // The play realm (app:// origin) loads project assets cross-scheme via
        // <img crossorigin> + fetch; allow it. estella:// is only reachable inside
        // the Electron app, so there is no untrusted-web exposure.
        'access-control-allow-origin': '*',
      },
    });
  } catch (err) {
    return new Response(String(err), { status: 404 });
  }
}

// app://local/<path> → the built renderer (dist/). Serves index.html, the wasm
// glue + binary, the play realm host page, and bundled assets over a stable
// origin. Path-escape guarded to dist/.
const PROJECT_PREFIX = '__project__/';

async function handleApp(request: Request): Promise<Response> {
  try {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    // app://local/__project__/<path> → project asset (so the play realm, which is
    // SAME-ORIGIN with the editor under app://, can read project files — custom
    // schemes can't cross-fetch each other, so estella:// is unreachable from the
    // app:// realm). Sandboxed to the open project root.
    if (rel.startsWith(PROJECT_PREFIX)) {
      if (!projectRoot) return new Response('no project open', { status: 503 });
      const abs = resolveInRoot(projectRoot, rel.slice(PROJECT_PREFIX.length));
      const bytes = await readFile(abs);
      const ext = path.extname(abs).slice(1).toLowerCase();
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': ASSET_MIME[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*' },
      });
    }
    const abs = path.join(RENDERER_DIST, rel);
    if (abs !== RENDERER_DIST && !abs.startsWith(RENDERER_DIST + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    const bytes = await readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': APP_MIME[ext] ?? 'application/octet-stream', 'access-control-allow-origin': '*' },
    });
  } catch (err) {
    return new Response(String(err), { status: 404 });
  }
}

app.whenReady().then(() => {
  protocol.handle('estella', handleEstella);
  protocol.handle('app', handleApp);
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  win = null;
  stopProjectWatch();
  if (process.platform !== 'darwin') app.quit();
});
