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
import type { BuildOptions, Plugin } from 'esbuild';
import { loadEsbuild } from './esbuildRuntime';
import { writeFile, readFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets, loadAssetGroups } from './cookAssets';
import { buildAddressableManifest } from './addressableManifest';
import { activeRemoteRoot } from '../../sdk/src/asset/assetGroups';
import type { PackagedGameConfig } from 'esengine';
import { IMPORT_MAP_JSON, IMPORT_MAP_CSP_HASH } from './buildPlayRealm';
import { exportWeChat } from './exportWeChat';
import { exportMiniGame } from './exportMiniGame';
import type { MiniGameExportProfile } from './miniGameExportProfile';
import { exportPlayable } from './exportPlayable';
import type { OnExportProgress } from './exportProgress';
import { ESENGINE_EXTERNAL } from './esengineResolve';
import { orientationCss, orientationOverlayHtml, orientationLockScript, type ScreenOrientation } from './orientationHtml';

import { isNativePlatform, type ExportPlatform } from '../src/project/platforms';
import { collectSubsystems, subsystemGapWarnings, targetGaps, type Subsystem } from '../src/project/targetSupport';
export type { ExportPlatform };

/**
 * `app.config.json` — what the native packagers need to build an *application*
 * around the content, as opposed to what the runtime needs to play it.
 *
 * Everything here is a property the OS owns: an installed app has one identity,
 * one version, and one orientation, none of which the engine can change from
 * inside. `cli native --package` turns this into an AndroidManifest; the Xcode
 * project turns it into Info.plist keys.
 */
export interface NativeAppConfig {
  /** Reverse-DNS: the Android manifest package / the iOS bundle identifier. */
  id: string;
  /** The name under the launcher icon. */
  name: string;
  /** Version as a store displays it (`versionName` / `CFBundleShortVersionString`). */
  version: string;
  /** Android's integer build ordinal (`versionCode`). */
  versionCode: number;
  /** The orientation the app locks to. A phone cannot be rotated by the engine,
   *  so this is the only place it can be expressed. */
  orientation: ScreenOrientation;
}

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

/**
 * Warn about content this target cannot render. The editor authors every
 * subsystem the engine has, but a target may compile only some of them (the
 * native app leaves out tilemaps, particles and post-processing) — so an export
 * that says nothing writes a package quietly missing half a scene.
 *
 * Scans the scenes and prefabs that were actually cooked, so the warning names
 * the files responsible and a project that never authors a tilemap hears
 * nothing about tilemaps. What each target lacks is declared once, in
 * project/targetSupport.ts.
 */
async function unsupportedContentWarnings(root: string, includedPaths: string[], platform: ExportPlatform): Promise<string[]> {
  if (targetGaps(platform).length === 0) return [];
  const usage = new Map<Subsystem, string[]>();
  for (const rel of includedPaths) {
    const ext = path.extname(rel).toLowerCase();
    if (ext !== '.esscene' && ext !== '.esprefab') continue;
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(path.join(root, rel), 'utf8'));
    } catch {
      continue;  // unreadable/!JSON — the cook already staged (and warned about) it
    }
    for (const subsystem of collectSubsystems(doc)) {
      const files = usage.get(subsystem);
      if (files) files.push(rel);
      else usage.set(subsystem, [rel]);
    }
  }
  return subsystemGapWarnings(platform, usage);
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

/** The web host page. `orientation` pins the canvas to a screen orientation (rotate-
 *  to-fit overlay + best-effort lock) — set for the mobile-facing web target, omitted
 *  for desktop (the Electron shell sizes its own window). */
function indexHtml(title: string, orientation?: ScreenOrientation): string {
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
      ${orientation ? orientationCss(orientation) : ''}
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    ${orientation ? orientationOverlayHtml(orientation) : ''}
    ${orientation ? orientationLockScript(orientation) : ''}
    <script type="module" src="./game.js"></script>
  </body>
</html>
`;
}

/** A filesystem-safe slug for the app id / package name. */
/** Resolve every `esengine` import to the host's global SDK. A native build has
 *  no module loader and no second copy of the SDK: the engine bundle the host
 *  already evaluated installs `globalThis.ESEngine`, and the project's scripts
 *  must bind to THAT instance or their components land in a rival registry. */
function esengineGlobalPlugin(): Plugin {
  return {
    name: 'esengine-global',
    setup(build) {
      build.onResolve({ filter: /^esengine(\/.*)?$/ }, (args) => ({ path: args.path, namespace: 'esengine-global' }));
      build.onLoad({ filter: /.*/, namespace: 'esengine-global' }, () => ({
        contents: 'module.exports = globalThis.ESEngine;', loader: 'js',
      }));
    },
  };
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
}

/** The Electron main process for an exported desktop game: serve the bundled web
 *  payload (./app) over a stable, fetch-enabled `game://` scheme and show it in a
 *  window. Mirrors the editor's estella:// scheme (file:// blocks fetch of sibling
 *  assets + wasm streaming, which the runtime needs). */
function desktopMain(title: string, orientation: ScreenOrientation): string {
  const [winW, winH] = orientation === 'portrait' ? [720, 1280] : [1280, 720];
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
    width: ${winW},
    height: ${winH},
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
async function stageDesktopApp(absOut: string, title: string, orientation: ScreenOrientation, appId?: string, productName?: string): Promise<void> {
  const display = productName || title;
  await writeFile(path.join(absOut, 'main.cjs'), desktopMain(display, orientation));
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
  compressAudio?: boolean;
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
  /** WeChat appid (Project Settings → Packaging → WeChat). */
  wechatAppid?: string;
  /** Reverse-DNS application id for a native target (format.ts resolveAppId).
   *  Written into app.config.json, where the packagers read it. */
  appId?: string;
  /** The app's version, as a store shows it (ProjectManifest.version). */
  appVersion?: string;
  /** Android's build ordinal. Absent ⇒ 1. */
  androidVersionCode?: number;
  /** A project-supplied mini-game export profile (`.esengine/platforms/<id>.mjs`),
   *  for a platform the editor does not ship. Present ⇒ the mini-game pipeline
   *  runs with it, whatever `platform` says. Loaded by the main process, which is
   *  where its emit hooks can be called. */
  miniGameProfile?: MiniGameExportProfile;
  /** Project-wide screen orientation (format.ts resolveOrientation) — consumed by
   *  EVERY target: WeChat game.json, the web/playable rotate hint, the desktop
   *  window's aspect. Default landscape (the engine's 1920×1080 Canvas aspect). */
  orientation?: ScreenOrientation;
  /** Per-phase progress (build log). */
  onProgress?: OnExportProgress;
  /** Shipping config: minify the bundles, no sourcemap. Default off (dev). */
  minify?: boolean;
  sourcemap?: boolean;
  /** Bitmask of render layers (0..31) that y-sort (Project Settings → Rendering). */
  ySortLayers?: number;
  /** Project color space — 'linear' boots the shipped game on the linear-light pipeline. */
  colorSpace?: 'gamma' | 'linear';
  /** Project camera fit (Project Settings → Display) — the main camera letterboxes this
   *  design resolution regardless of any UI Canvas. Absent ⇒ no fit (raw orthoSize). */
  screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
  /** Project widget theme (Project Settings → UI); absent = dark. */
  uiTheme?: 'light';
  /** Project theme color overrides (role → #rrggbbaa hex) — the host parses them. */
  uiThemeColors?: Record<string, string>;
  /** Hot-update delivery baked into game.config.json: the CDN root `remote`-group
   *  assets resolve against + the storage key an applied update persists under.
   *  The addressable `asset-manifest.json` this export always emits enables it. */
  hotUpdate?: { remoteRoot?: string; persistUpdateKey?: string };
}): Promise<ExportGameResult> {
  const platform = opts.platform ?? 'web';
  const title = opts.title ?? 'Game';
  // One orientation for every target; default landscape (the engine's 1920×1080 Canvas
  // aspect) so a caller that omits it still ships consistently. The IPC handler resolves
  // it from the manifest (explicit setting, else the design resolution's aspect).
  const orientation: ScreenOrientation = opts.orientation ?? 'landscape';
  const progress = opts.onProgress ?? (() => {});
  const scenes = await discoverProjectScenes(opts.root, opts.entryScene, opts.scenesDir, opts.excludeScenes);

  // A platform the editor does not ship: the project supplied an export profile
  // (.esengine/platforms/<id>.mjs, loaded by the main process since it carries
  // functions). It rides the same vendor-neutral mini-game pipeline WeChat does
  // — that pipeline taking a profile is exactly what makes this possible.
  if (opts.miniGameProfile) {
    return exportMiniGame(opts.miniGameProfile, {
      root: opts.root,
      entryScene: opts.entryScene,
      scenes,
      scriptsEntry: opts.scriptsEntry,
      sdkDir: opts.sdkDistDir,
      wasmDir: opts.wasmDir,
      outDir: opts.outDir,
      title,
      appid: opts.wechatAppid,
      orientation,
      ySortLayers: opts.ySortLayers,
      colorSpace: opts.colorSpace,
      screenFit: opts.screenFit,
      uiTheme: opts.uiTheme,
      uiThemeColors: opts.uiThemeColors,
      minify: opts.minify,
      contentAddressed: opts.contentAddressed,
      compressTextures: opts.compressTextures,
      compressAudio: opts.compressAudio,
      atlasTextures: opts.atlasTextures,
      onProgress: opts.onProgress,
    });
  }

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
      orientation,
      ySortLayers: opts.ySortLayers,
      colorSpace: opts.colorSpace,
      screenFit: opts.screenFit,
      uiTheme: opts.uiTheme,
      uiThemeColors: opts.uiThemeColors,
      minify: opts.minify,
      contentAddressed: opts.contentAddressed,
      compressTextures: opts.compressTextures,
      compressAudio: opts.compressAudio,
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
      orientation,
      minify: opts.minify,
      ySortLayers: opts.ySortLayers,
      colorSpace: opts.colorSpace,
      screenFit: opts.screenFit,
      uiTheme: opts.uiTheme,
      uiThemeColors: opts.uiThemeColors,
      onProgress: opts.onProgress,
    });
  }

  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  // Desktop nests the web build under app/; the Electron shell sits beside it.
  const payloadDir = platform === 'desktop' ? path.join(absOut, 'app') : absOut;
  // The native app carries the runtime in its binary (engine core + SDK bundle),
  // so its export is CONTENT: cooked assets, manifests, scenes, config — no host
  // page, no SDK/wasm tree, and project scripts as a plain script the host evals.
  // iOS and Android write the SAME payload — what differs is the toolchain that
  // wraps it — so this asks what KIND of target it is, not which one.
  const nativeContent = isNativePlatform(platform);
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
  const cook = await cookAssets(opts.root, { entryScenes: scenes.map((s) => s.path), outDir: payloadDir, contentAddressed: opts.contentAddressed ?? true, compressTextures: opts.compressTextures, compressAudio: opts.compressAudio, atlasTextures: opts.atlasTextures, platform });
  warnings.push(...cook.warnings);
  warnings.push(...await unsupportedContentWarnings(opts.root, cook.includedPaths, platform));
  progress({ phase: 'Cooking assets', detail: `${cook.included.length} reachable` });

  // Also emit the AddressableManifest (v2.0) beside the flat one — the SAME
  // model every target now shares, so `loadGroup` / remote-group / hot-update
  // work on web + desktop too (not just mini-games). Additive: the eager boot
  // still reads the flat manifest; this powers on-demand + hot-update delivery.
  await writeFile(path.join(payloadDir, 'asset-manifest.json'), await buildAddressableManifest(payloadDir));
  // The flat manifest is a build-time intermediate: the addressable one above is
  // derived from it, and every runtime now reads only that. Dropping it keeps one
  // asset model in the package — the mini-game export has always done this.
  await rm(path.join(payloadDir, 'assets.manifest.json'), { force: true });

  // Hot-update delivery baked into game.config.json: the active build profile's
  // CDN root (an explicit opts.hotUpdate override wins), plus a persistence key so
  // a returning player boots on already-updated content. Only emitted when a CDN
  // root is configured — a project with no remote groups ships nothing extra.
  const remoteRoot = opts.hotUpdate?.remoteRoot ?? activeRemoteRoot(await loadAssetGroups(opts.root));
  const persistUpdateKey = opts.hotUpdate?.persistUpdateKey ?? (remoteRoot ? 'esengine:hotupdate' : undefined);
  const hotUpdate = remoteRoot || persistUpdateKey
    ? { ...(remoteRoot ? { remoteRoot } : {}), ...(persistUpdateKey ? { persistUpdateKey } : {}) }
    : undefined;

  try {
    // 2. Game host — esengine EXTERNAL (resolved by the index.html import map),
    //    so the shipped game shares one SDK with the project bundle and runs
    //    custom systems (same shape as the play realm).
    const { build } = await loadEsbuild();
    if (!nativeContent) {
      progress({ phase: 'Bundling game host' });
      const host = await build({ ...common, entryPoints: [opts.gameHostEntry], outfile: path.join(payloadDir, 'game.js') });
      errors.push(...host.errors.map((e) => e.text));
    }
    // 3. Project bundle (defineComponent/defineSystem). ESM + esengine external on
    //    the web (the import map resolves it); on native an IIFE the host evals,
    //    where `esengine` is the globalThis.ESEngine the host installed.
    const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
    if (scriptsAbs && existsSync(scriptsAbs)) {
      progress({ phase: 'Bundling project scripts' });
      const proj = nativeContent
        ? await build({
          ...common, format: 'iife', external: [], plugins: [esengineGlobalPlugin()],
          entryPoints: [scriptsAbs], outfile: path.join(payloadDir, 'scripts.js'),
        })
        : await build({ ...common, entryPoints: [scriptsAbs], outfile: path.join(payloadDir, 'scripts.mjs') });
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
  if (!nativeContent) {
    progress({ phase: 'Copying SDK + runtime' });
    if (existsSync(opts.sdkDistDir)) await cp(opts.sdkDistDir, path.join(payloadDir, 'sdk'), { recursive: true });
    else errors.push(`sdk dist not found: ${opts.sdkDistDir}`);
    if (existsSync(opts.wasmDir)) await cp(opts.wasmDir, path.join(payloadDir, 'wasm'), { recursive: true });
    else errors.push(`wasm runtime dir not found: ${opts.wasmDir}`);
  }

  // 5. Host page + entry-scene config. Web pins orientation (rotate-to-fit overlay);
  //    desktop omits it — the Electron shell sizes its own window to the orientation.
  progress({ phase: 'Writing host page' });
  if (!nativeContent) {
    await writeFile(path.join(payloadDir, 'index.html'), indexHtml(title, platform === 'web' ? orientation : undefined));
  }
  // Typed against the SDK's contract, so a field the runtimes read can never be
  // spelled differently here — the two sides share one declaration.
  const gameConfig: PackagedGameConfig = {
    entryScene: opts.entryScene, scenes,
    ...(opts.ySortLayers ? { ySortLayers: opts.ySortLayers } : {}),
    ...(opts.colorSpace === 'linear' ? { colorSpace: opts.colorSpace } : {}),
    ...(opts.screenFit && opts.screenFit.scaleMode >= 0 ? { screenFit: opts.screenFit } : {}),
    ...(opts.uiTheme === 'light' ? { uiTheme: opts.uiTheme } : {}),
    ...(opts.uiThemeColors && Object.keys(opts.uiThemeColors).length > 0 ? { uiThemeColors: opts.uiThemeColors } : {}),
    ...(hotUpdate ? { hotUpdate } : {}),
  };
  await writeFile(path.join(payloadDir, 'game.config.json'), JSON.stringify(gameConfig, null, 2) + '\n');

  // A native target also needs the app's IDENTITY, and it is deliberately not in
  // game.config.json: the runtime never reads it. Orientation, the bundle id and
  // the version are OS-level properties of the installed application — the engine
  // can letterbox but cannot rotate a phone — so they are declared for whoever
  // assembles the app (`cli native --package`, and the Xcode project), the same
  // way the mini-game export writes the vendor's game.json beside the content.
  if (nativeContent) {
    const appConfig: NativeAppConfig = {
      id: opts.appId ?? 'com.estella.game',
      name: title,
      version: opts.appVersion ?? '1.0',
      versionCode: opts.androidVersionCode ?? 1,
      orientation,
    };
    await writeFile(path.join(payloadDir, 'app.config.json'), JSON.stringify(appConfig, null, 2) + '\n');
  }

  // 6. Desktop: wrap the payload in a runnable Electron app.
  if (platform === 'desktop') { progress({ phase: 'Staging Electron app' }); await stageDesktopApp(absOut, title, orientation, opts.desktopAppId, opts.desktopProductName); }

  return { ok: errors.length === 0, platform, outDir: absOut, included: cook.included.length, warnings, errors };
}
