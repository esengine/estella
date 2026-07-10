// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Game export (REARCH_EDITOR_REALM Phase S / REARCH_EXPORT). Produces a
 *        self-contained build of the open project, parameterized by platform:
 *
 *          web     → a static-servable web build (cooked assets + manifest, the
 *                    esbuild'd game host, the SDK + wasm runtime, index.html).
 *          desktop → the SAME web build under `app/`, wrapped in a runnable
 *                    Electron app (main.cjs serving it over a custom `game://`
 *                    scheme — file:// blocks the runtime's asset/wasm fetches),
 *                    plus a package.json wired for `electron-builder`.
 *
 *        The web payload is identical across targets and boots the SAME runtime
 *        the editor's play realm uses (gameHost → initPlayRealmRuntime), so the
 *        shipped game is what was played (play == ship). The host is origin-
 *        agnostic (relative fetch + import.meta.url), so the desktop scheme needs
 *        no host changes.
 *
 *        Pure Node (esbuild + fs) — IPC wiring is in main.ts.
 */
import type { BuildOptions } from 'esbuild';
import { loadEsbuild } from './esbuildRuntime';
import { writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from './cookAssets';
import { IMPORT_MAP_JSON, IMPORT_MAP_CSP_HASH } from './buildPlayRealm';
import { exportWeChat } from './exportWeChat';
import { exportPlayable } from './exportPlayable';
import type { OnExportProgress } from './exportProgress';
import { ESENGINE_EXTERNAL } from './esengineResolve';

export type ExportPlatform = 'web' | 'desktop' | 'wechat' | 'playable';

/** A switchable scene the export ships: SceneManager name + project-relative path. */
export interface ExportScene {
  name: string;
  path: string;
}

/**
 * Every scene the shipped game can switch to: all `.esscene` under the
 * project's scenes dir plus the entry scene wherever it lives, minus the
 * project's export exclusions (`packaging.excludeScenes` — dev/test scenes).
 * Names are the scenes-dir-relative path without extension ('main',
 * 'levels/boss') — the stable ids game code passes to
 * `SceneManager.switchTo`; a scene outside the scenes dir is named by its
 * project-relative path. The entry always sorts first and always ships, an
 * exclusion notwithstanding. Cook reachability runs from ALL of these roots,
 * so every scene's assets ship (playable stays entry-only: a size-capped
 * single file).
 */
export async function discoverProjectScenes(root: string, entryScene: string, scenesDir?: string, excludeScenes?: string[]): Promise<ExportScene[]> {
  const excluded = new Set((excludeScenes ?? []).map((p) => p.replace(/\\/g, '/')));
  const dir = (scenesDir ?? path.dirname(entryScene)).replace(/\\/g, '/');
  const sceneName = (projectPath: string): string => {
    const p = projectPath.replace(/\\/g, '/');
    const rel = p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p;
    return rel.replace(/\.esscene$/i, '');
  };
  const scenes: ExportScene[] = [{ name: sceneName(entryScene), path: entryScene.replace(/\\/g, '/') }];
  const absDir = path.join(root, dir);
  if (existsSync(absDir)) {
    const walk = async (sub: string): Promise<void> => {
      for (const entry of await readdir(path.join(absDir, sub), { withFileTypes: true })) {
        const rel = sub ? `${sub}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(rel);
        else if (/\.esscene$/i.test(entry.name)) {
          const projectPath = `${dir}/${rel}`;
          if (projectPath !== scenes[0].path && !excluded.has(projectPath)) {
            scenes.push({ name: sceneName(projectPath), path: projectPath });
          }
        }
      }
    };
    await walk('');
  }
  return scenes;
}

export interface ExportGameResult {
  ok: boolean;
  platform: ExportPlatform;
  outDir: string;
  /** Count of assets included (reachable from the entry scene). */
  included: number;
  warnings: string[];
  errors: string[];
}

function indexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-eval' blob: '${IMPORT_MAP_CSP_HASH}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>${title}</title>
    <script type="importmap">${IMPORT_MAP_JSON}</script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #0e121b; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <script type="module" src="./game.js"></script>
  </body>
</html>
`;
}

/** A filesystem-safe slug for the app id / package name. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

/** The Electron main process for an exported desktop game: serve the bundled web
 *  payload (./app) over a stable, fetch-enabled `game://` scheme and show it in a
 *  window. Mirrors the editor's estella:// scheme (file:// blocks fetch of sibling
 *  assets + wasm streaming, which the runtime needs). */
function desktopMain(title: string): string {
  return `'use strict';
// Generated by Estella exportGame — the desktop shell for this game.
const { app, protocol, BrowserWindow, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'game';
const ROOT = path.join(__dirname, 'app');
const MIME = {
  html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  json: 'application/json', wasm: 'application/wasm', map: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  svg: 'image/svg+xml', ktx2: 'image/ktx2',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  fnt: 'text/plain', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2',
};

// Emscripten/embind glue JIT-compiles call bridges (new Function) → needs unsafe-eval.
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#0e121b',
    title: ${JSON.stringify(title)},
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadURL(SCHEME + '://app/index.html');
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, async (req) => {
    let rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\\/+/, '') || 'index.html';
    const filePath = path.join(ROOT, rel);
    // Contain within ROOT (no path traversal out of the bundled payload).
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const res = await net.fetch(pathToFileURL(filePath).toString());
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const headers = new Headers(res.headers);
      headers.set('content-type', MIME[ext] || 'application/octet-stream');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
`;
}

function desktopPackageJson(title: string, appId?: string, productName?: string): string {
  const slug = slugify(productName || title);
  return JSON.stringify({
    name: slug,
    version: '1.0.0',
    private: true,
    main: 'main.cjs',
    scripts: { start: 'electron .', dist: 'electron-builder' },
    devDependencies: { electron: '^42.0.0', 'electron-builder': '^25.0.0' },
    build: {
      appId: appId || `com.estella.${slug}`,
      productName: productName || title,
      files: ['main.cjs', 'app/**/*'],
      directories: { output: 'installer' },
      mac: { target: 'dmg' },
      win: { target: 'nsis' },
      linux: { target: 'AppImage' },
    },
  }, null, 2) + '\n';
}

function desktopReadme(title: string): string {
  return `# ${title}

A desktop build exported from Estella. The game (\`app/\`) is the same play==ship
runtime served over a \`game://\` scheme by the Electron shell (\`main.cjs\`).

## Run it

    npm install
    npm start

## Package a native installer (.dmg / .exe / AppImage)

    npm install
    npm run dist

The installer is written to \`installer/\`. Build each OS's installer on that OS
(electron-builder doesn't cross-compile reliably).
`;
}

/** Stage the Electron shell around the web payload already built under `<absOut>/app`. */
async function stageDesktopApp(absOut: string, title: string, appId?: string, productName?: string): Promise<void> {
  const display = productName || title;
  await writeFile(path.join(absOut, 'main.cjs'), desktopMain(display));
  await writeFile(path.join(absOut, 'package.json'), desktopPackageJson(title, appId, productName));
  await writeFile(path.join(absOut, 'README.md'), desktopReadme(display));
}

/**
 * Export the open project. `entryScene` is the project-relative scene to boot;
 * `gameHostEntry` the game-host esbuild entry — the prebuilt realm-host bundle
 * (dist-electron/hosts/gameHost.js; a packaged app ships no src/ and esbuild
 * cannot read app.asar) or any source esbuild can reach (tests). `wasmDir` is
 * the engine runtime to copy. `platform` selects the target (default web).
 */
export async function exportGame(opts: {
  root: string;
  entryScene: string;
  /** Project-relative scenes dir (manifest layout); default the entry's dir.
   *  Every `.esscene` under it ships as a switchable scene. */
  scenesDir?: string;
  /** Scenes excluded from the build (`packaging.excludeScenes`); the entry
   *  scene always ships. */
  excludeScenes?: string[];
  gameHostEntry: string;
  /** Project-relative startup entry (e.g. src/main.ts) → bundled to scripts.mjs. */
  scriptsEntry?: string;
  sdkDistDir: string;
  wasmDir: string;
  outDir: string;
  /** Content-addressed asset filenames (<hash><ext>) — dedup + immutable/CDN caching.
   *  Default ON (the modern-bundler standard); set false to keep logical paths. */
  contentAddressed?: boolean;
  /** Encode raster textures to GPU-compressed KTX2 at cook time. Default off
   *  (lossy + encode-time cost — opt in per project). */
  compressTextures?: boolean;
  /** Pack `<name>.atlas/` folder PNGs into atlas pages at cook time. Default off. */
  atlasTextures?: boolean;
  title?: string;
  platform?: ExportPlatform;
  /** Playable host source (src/playableHost.ts). */
  playableHostEntry?: string;
  /** Desktop installer id (Project Settings → Packaging → Desktop); default com.estella.<slug>. */
  desktopAppId?: string;
  /** Desktop product/display name (Project Settings); default the project title. */
  desktopProductName?: string;
  /** WeChat appid / orientation (Project Settings → Packaging → WeChat). */
  wechatAppid?: string;
  wechatOrientation?: 'portrait' | 'landscape';
  /** Per-phase progress (build log). */
  onProgress?: OnExportProgress;
  /** Shipping config: minify the bundles, no sourcemap. Default off (dev). */
  minify?: boolean;
  sourcemap?: boolean;
  /** Bitmask of render layers (0..31) that y-sort (Project Settings → Rendering). */
  ySortLayers?: number;
}): Promise<ExportGameResult> {
  const platform = opts.platform ?? 'web';
  const title = opts.title ?? 'Game';
  const progress = opts.onProgress ?? (() => {});
  const scenes = await discoverProjectScenes(opts.root, opts.entryScene, opts.scenesDir, opts.excludeScenes);

  // WeChat has no import maps + a different module/asset model → its own pipeline.
  if (platform === 'wechat') {
    return exportWeChat({
      root: opts.root,
      entryScene: opts.entryScene,
      scenes,
      scriptsEntry: opts.scriptsEntry,
      sdkDir: opts.sdkDistDir,
      wasmDir: opts.wasmDir,
      outDir: opts.outDir,
      title,
      appid: opts.wechatAppid,
      orientation: opts.wechatOrientation,
      ySortLayers: opts.ySortLayers,
      minify: opts.minify,
      contentAddressed: opts.contentAddressed,
      compressTextures: opts.compressTextures,
      atlasTextures: opts.atlasTextures,
      onProgress: opts.onProgress,
    });
  }

  // Playable ads are a single inlined HTML (SINGLE_FILE glue + base64 assets).
  if (platform === 'playable') {
    return exportPlayable({
      root: opts.root,
      entryScene: opts.entryScene,
      scriptsEntry: opts.scriptsEntry,
      // Default beside the game host, same flavor (prebuilt .js or a source .ts).
      playableHostEntry: opts.playableHostEntry ?? path.join(path.dirname(opts.gameHostEntry), `playableHost${path.extname(opts.gameHostEntry)}`),
      sdkDir: opts.sdkDistDir,
      wasmDir: opts.wasmDir,
      outDir: opts.outDir,
      title,
      minify: opts.minify,
      ySortLayers: opts.ySortLayers,
      onProgress: opts.onProgress,
    });
  }

  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  // Desktop nests the web build under app/; the Electron shell sits beside it.
  const payloadDir = platform === 'desktop' ? path.join(absOut, 'app') : absOut;
  const warnings: string[] = [];
  const errors: string[] = [];
  await mkdir(payloadDir, { recursive: true });
  const common: BuildOptions = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    external: ESENGINE_EXTERNAL,
    minify: opts.minify ?? false,
    sourcemap: opts.sourcemap ?? false,
    write: true,
    logLevel: 'silent',
  };

  // 1. Cook reachable assets + manifest, from EVERY shippable scene as a root
  //    (the scene files themselves are staged too).
  progress({ phase: 'Cooking assets' });
  const cook = await cookAssets(opts.root, { entryScenes: scenes.map((s) => s.path), outDir: payloadDir, contentAddressed: opts.contentAddressed ?? true, compressTextures: opts.compressTextures, atlasTextures: opts.atlasTextures });
  warnings.push(...cook.warnings);
  progress({ phase: 'Cooking assets', detail: `${cook.included.length} reachable` });

  try {
    // 2. Game host — esengine EXTERNAL (resolved by the index.html import map),
    //    so the shipped game shares one SDK with the project bundle and runs
    //    custom systems (same shape as the play realm).
    progress({ phase: 'Bundling game host' });
    const { build } = await loadEsbuild();
    const host = await build({ ...common, entryPoints: [opts.gameHostEntry], outfile: path.join(payloadDir, 'game.js') });
    errors.push(...host.errors.map((e) => e.text));
    // 3. Project bundle (defineComponent/defineSystem) → scripts.mjs, esengine external.
    const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
    if (scriptsAbs && existsSync(scriptsAbs)) {
      progress({ phase: 'Bundling project scripts' });
      const proj = await build({ ...common, entryPoints: [scriptsAbs], outfile: path.join(payloadDir, 'scripts.mjs') });
      errors.push(...proj.errors.map((e) => e.text));
    }
  } catch (err) {
    const e = err as { errors?: { text: string }[]; message?: string };
    errors.push(...(e.errors?.map((x) => x.text) ?? [String(e.message ?? err)]));
    return { ok: false, platform, outDir: absOut, included: cook.included.length, warnings, errors };
  }

  // 4. SDK (import-map target) + wasm runtime. The import map and the game
  //    host reference both unconditionally — a missing tree is not a degraded
  //    export but a package that cannot boot, so it fails the export.
  progress({ phase: 'Copying SDK + runtime' });
  if (existsSync(opts.sdkDistDir)) await cp(opts.sdkDistDir, path.join(payloadDir, 'sdk'), { recursive: true });
  else errors.push(`sdk dist not found: ${opts.sdkDistDir}`);
  if (existsSync(opts.wasmDir)) await cp(opts.wasmDir, path.join(payloadDir, 'wasm'), { recursive: true });
  else errors.push(`wasm runtime dir not found: ${opts.wasmDir}`);

  // 5. Host page + entry-scene config.
  progress({ phase: 'Writing host page' });
  await writeFile(path.join(payloadDir, 'index.html'), indexHtml(title));
  await writeFile(
    path.join(payloadDir, 'game.config.json'),
    JSON.stringify(
      { entryScene: opts.entryScene, scenes, ...(opts.ySortLayers ? { ySortLayers: opts.ySortLayers } : {}) },
      null, 2,
    ) + '\n',
  );

  // 6. Desktop: wrap the payload in a runnable Electron app.
  if (platform === 'desktop') { progress({ phase: 'Staging Electron app' }); await stageDesktopApp(absOut, title, opts.desktopAppId, opts.desktopProductName); }

  return { ok: errors.length === 0, platform, outDir: absOut, included: cook.included.length, warnings, errors };
}
