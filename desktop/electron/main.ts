// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { app, BrowserWindow, Menu, shell, ipcMain, dialog, protocol } from 'electron';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, open, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  openProject,
  readManifest,
  readInRoot,
  writeInRoot,
  readDirInRoot,
  listFilesInRoot,
  renameInRoot,
  mkdirInRoot,
  duplicateInRoot,
  statInRoot,
  snapshotForTrash,
  restoreTrashed,
  saveWorkspace,
  resolveInRoot,
  META_EXT,
} from './projectFs';
import { syncAutosave, listAutosave, restoreAutosave, clearAutosave, type AutosaveEntry } from './autosave';
import { listRecents, addRecent, removeRecent, listTemplates, createFromTemplate } from './launcher';
import { buildProjectScripts } from './buildScripts';
import { extractProjectSchemas } from './extractSchemas';
import { scanAssetDatabase, readCachedAssetIndex, updateAssetIndex } from './assetDb';
import { cookAssets } from './cookAssets';
import { startProjectWatch, stopProjectWatch } from './projectWatcher';
import { importAssets, createAsset, IMPORT_EXTENSIONS } from './importAssets';
import { exportGame } from './exportGame';
import {
  iosSourcesFromTemplate, resolveNativeTemplate, installNativeTemplate, listNativeTemplates,
  removeNativeTemplate, downloadNativeTemplate,
} from './nativeTemplates';
import { loopbackServer, closeAllLoopbackServers } from './loopbackServer';
import { httpContentType } from './mimeTypes';
import { buildPlayRealm } from './buildPlayRealm';
import { ensureSdkTypes } from './syncSdkTypes';
import { ensureProjectShaderTwins } from './shaderTwins';
import { installCrashCapture, logsDir } from './resilience';
import { mcpMode, startMcpEndpoint } from './mcpEndpoint';
import {
  discoverPlugins, compilePlugin, isTrusted, trustPlugin, revokeTrust, isDisabled, setPluginEnabled,
} from './pluginHost';
import { checkForUpdate } from './updateCheck';
import {
  listPlatforms, loadProjectPlatform, createProjectPlatform, setPlatformTrustGate,
  listPlayableNetworks, loadPlayableProfile,
  type PlatformRuntimeDirs, type ProjectPlatformKind,
} from './platformCatalog';
import { resolveLayout, resolveScripts, resolveOrientation, resolveScreenFit, resolveAppId, type ExportPlatform } from '../src/project/format';
import type { WorkspaceState } from '../src/project/format';

// Enable WebGPU in the renderer so the viewport's WebGPU backend (Settings →
// Renderer) has an adapter to acquire. Without it navigator.gpu has no adapter and
// the engine falls back to WebGL2. Must be set before app is ready; mirrors the
// switch the headless verify harness sets.
app.commandLine.appendSwitch('enable-unsafe-webgpu');

// Two privileged custom schemes (must be declared before app ready):
//  • estella:// serves files from the open project root (sandboxed) — lets the
//    engine fetch project assets (textures via Assets.loadTexture → fetch).
//  • app://     serves the built renderer (dist/) — kept as a fallback origin. The
//    packaged renderer normally loads over a loopback http origin instead (see
//    loopbackServer + appBaseUrl) so it has a real http origin: the engine glue path
//    `${location.origin}/wasm/esengine.js` resolves there, and dockview popouts get
//    the same-origin http opener they require. app:// is a stable fallback if the
//    loopback server can't start. (Under file:// the glue path 404s at the fs root.)
// corsEnabled: the renderer reads texture pixels via `<img crossOrigin>` (TextureLoader)
// + `fetch`, which are CORS requests. Without it Chromium rejects custom-scheme cross-
// origin at the scheme level (even though the handler returns `access-control-allow-origin:
// *`) — blocking project textures in dev (http://localhost origin) and any cross-scheme load.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'estella',
    // codeCache: V8 persists compiled bytecode for the play realm's scripts.
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

// The app:// renderer origin (host is arbitrary; `local` keeps URLs readable). Kept
// as a fallback; the packaged renderer normally loads over a loopback http origin
// (see appBaseUrl) so dockview popouts get the same-origin http opener they require.
const APP_ORIGIN = 'app://local';

// Where the renderer is served from: Vite dev server, a loopback http origin when
// packaged (set in whenReady), or app:// as a last resort. Trailing slash so
// `${appBaseUrl}index.html` composes cleanly.
let appBaseUrl = `${APP_ORIGIN}/`;

// dockview pops a dock panel into its own window by opening `popout.html` on our
// origin (http://localhost in dev, http://127.0.0.1 when packaged). Match by pathname so
// the window-open handler can tell a legit panel pop-out from an external link.
const isPopoutUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname.endsWith('/popout.html');
  } catch {
    return false;
  }
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
// public/       > static assets (wasm, sdk, verify scenes) in dev
process.env.APP_ROOT = path.join(__dirname, '..');

// Automation gets its own profile dir — never fight the live editor over cache locks.
if (process.env.ESTELLA_SHOT) {
  app.setPath('userData', path.join(app.getPath('temp'), 'estella-shot-profile'));
}

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

// —— Realm-host bundles + SDK dist ——————————————————————————————————————————
// Both trees are read by esbuild (a NATIVE subprocess: exports re-bundle the
// prebuilt hosts with the shipping minify config, inlined bundles alias
// `esengine` at the SDK dist). Node's fs is patched to read app.asar; a child
// process is not — so once packaged, these must live on the real filesystem.
// electron-builder asarUnpack mirrors them under app.asar.unpacked; retarget.
const unpacked = (p: string): string => p.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
/** Prebuilt realm-host bundles (playHost/gameHost/playableHost) — built by the
 *  realm-hosts step in vite.config.ts, never from src/ at runtime (a packaged
 *  app ships no sources). */
const HOSTS_DIR = unpacked(path.join(__dirname, 'hosts'));
/** The esengine SDK dist: staged into realms/exports, aliased into inlined bundles. */
const SDK_DIST = unpacked(path.join(process.env.APP_ROOT, 'node_modules', 'esengine', 'dist'));
/** Where the types mirror may READ the SDK dist's `.d.ts` from, in preference
 *  order. Packaged first: electron-builder strips *.d.ts from node_modules
 *  (excludedExts), so the SDK_DIST copy ships the SDK's .js but none of its
 *  declarations — the declarations ride along as an extraResource under
 *  resources/sdk-types instead (see electron-builder.yml). Dev falls through to
 *  the real node_modules dist (which has both). The mirror is plain Node fs, so
 *  the in-asar path stays as a last-ditch fallback. Native consumers (esbuild)
 *  must keep using SDK_DIST only — types never travel that path. Shipping
 *  without the declarations is how projects lost their `esengine` types with
 *  only a staging error to show for it (issue #49). */
const SDK_TYPES_CANDIDATES = [
  ...(app.isPackaged ? [path.join(process.resourcesPath, 'sdk-types')] : []),
  SDK_DIST,
  path.join(process.env.APP_ROOT, 'node_modules', 'esengine', 'dist'),
];
/** The web engine runtime (glue + wasm + side modules) staged into play realms and
 *  exports by recursive directory copy — which cannot source from inside app.asar. */
const WEB_WASM_DIR = unpacked(
  existsSync(path.join(VITE_PUBLIC, 'wasm')) ? path.join(VITE_PUBLIC, 'wasm') : path.join(RENDERER_DIST, 'wasm'),
);

let win: BrowserWindow | null = null;

/**
 * Screenshot / visual-regression capture (gated on ESTELLA_SHOT=out.png). Drives the
 * renderer's `?automation=1` hook to open ESTELLA_SHOT_PROJECT (+ optional
 * ESTELLA_SHOT_SCENE), lets the panels + WebGL viewport settle, writes a PNG, and quits.
 */
async function runScreenshot(w: BrowserWindow, out: string): Promise<void> {
  const exec = (code: string): Promise<unknown> =>
    w.webContents.executeJavaScript(code, true).catch(() => undefined);

  // Pipe renderer console (all frames, incl. the play OOPIF) to the shot log —
  // headless failures otherwise die silently inside the window.
  w.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[console:${level === 3 ? 'error' : 'warn'}]`, message);
    // Surface engine diagnostics (e.g. the resolved GPU backend) in the dev terminal.
    else if (message.startsWith('[engine]')) console.log(message);
  });

  // Deterministic waits — poll a real in-page condition instead of guessing at a
  // wall-clock delay (the delay is either flaky-short on a slow machine or wasted
  // on a fast one). Returns false + warns on timeout so a screenshot of a
  // degraded state still gets captured rather than hanging.
  const waitFor = async (expr: string, label: string, timeoutMs = 12000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await exec(expr)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    console.warn(`[screenshot] waitFor timed out: ${label}`);
    return false;
  };
  // Settle N painted frames — frame-deterministic across machines (replaces the
  // "let the WebGL viewport + dockview settle" blind sleep).
  const settleFrames = (n: number): Promise<unknown> =>
    exec(`new Promise((r) => { let k = ${n}; const t = () => (--k <= 0 ? r(true) : requestAnimationFrame(t)); requestAnimationFrame(t); })`);

  const sceneReady = '(window.__estellaEditor.surface.getSceneTree() || []).length > 0';

  try {
    if (!(await waitFor('!!window.__estellaEditor', 'automation hook'))) {
      throw new Error('automation hook never attached');
    }

    // Force the editor UI language (ESTELLA_SHOT_LOCALE=en|zh-CN) for
    // language-matched documentation shots. The locale is fixed at module load
    // from the persisted setting, so seed it and reload before anything opens.
    const locale = process.env.ESTELLA_SHOT_LOCALE;
    if (locale) {
      const changed = await exec(`(() => {
        const k = 'estella.settings';
        const v = JSON.parse(localStorage.getItem(k) || '{}');
        if (v['appearance.language'] === ${JSON.stringify(locale)}) return false;
        v['appearance.language'] = ${JSON.stringify(locale)};
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      })()`);
      if (changed) {
        w.webContents.reload();
        await waitFor('!!window.__estellaEditor', 'automation hook (after locale reload)');
      }
    }

    // Force the viewport GPU backend (ESTELLA_SHOT_BACKEND=webgl2|webgpu) — the
    // backend is fixed at engine instantiation from the persisted setting, so seed
    // it and reload before the project boots (mirrors the locale seed above). Lets
    // a shot verify the WebGPU backend renders the same frame as WebGL2.
    const backend = process.env.ESTELLA_SHOT_BACKEND;
    if (backend) {
      const changed = await exec(`(() => {
        const k = 'estella.settings';
        const v = JSON.parse(localStorage.getItem(k) || '{}');
        if (v['renderer.backend'] === ${JSON.stringify(backend)}) return false;
        v['renderer.backend'] = ${JSON.stringify(backend)};
        localStorage.setItem(k, JSON.stringify(v));
        return true;
      })()`);
      if (changed) {
        w.webContents.reload();
        await waitFor('!!window.__estellaEditor', 'automation hook (after backend reload)');
      }
    }

    const project = process.env.ESTELLA_SHOT_PROJECT;
    const scene = process.env.ESTELLA_SHOT_SCENE;
    if (project) {
      const ok = await exec(`window.__estellaEditor.open(${JSON.stringify(project)})`);
      if (ok) await exec('window.__estellaEditor.enterEditor()');
      await waitFor(sceneReady, 'editor mounted + scene projected'); // was sleep(1500)
      // The project-open load gate (engine boot + play-realm prewarm) overlays
      // the whole shell; capturing through it screenshots a spinner instead of
      // the editor. Its own safety timer force-closes at 20s, so wait past it.
      await waitFor('!document.querySelector(".loadscreen")', 'load gate cleared', 25000);
      if (scene) {
        await exec(`window.__estellaEditor.openScene(${JSON.stringify(scene)})`);
        await waitFor(sceneReady, 'scene loaded'); // was sleep(1500)
      }
    }
    const selectName = process.env.ESTELLA_SHOT_SELECT;
    if (selectName) {
      // The tree is nested (getSceneTree returns ROOTS), so the walk has to
      // recurse — a flat find only ever reached top-level entities, and picked
      // nothing for a name a level down, silently leaving the default selection.
      const selected = await exec(`(() => {
        const s = window.__estellaEditor.surface;
        const walk = (nodes) => {
          for (const n of nodes || []) {
            if (n.name === ${JSON.stringify(selectName)}) return n;
            const hit = walk(n.children);
            if (hit) return hit;
          }
          return null;
        };
        const hit = walk(s.getSceneTree());
        if (hit) s.select(hit.id);
        return hit ? hit.id : null;
      })()`);
      if (selected == null) console.log(`[select] no entity named ${selectName}`);
      await waitFor('window.__estellaEditor.surface.getSelection() != null', 'entity selected'); // was sleep(800)
    }
    const selectAsset = process.env.ESTELLA_SHOT_ASSET;
    if (selectAsset) {
      await exec(`window.__estellaEditor.selectAsset(${JSON.stringify(selectAsset)})`);
      // The asset inspector mounts its metadata rows once selected, and (for a
      // type with importer settings) its ComponentSection once the `.meta` loads.
      await waitFor('!!document.querySelector(".insp .cb-meta")', 'asset inspector mounted'); // was sleep(1000)
      if (process.env.ESTELLA_SHOT_ASSET_SCROLL) {
        await waitFor('!!document.querySelector(".insp .comp")', 'import settings rendered', 4000);
        await exec(`(() => { const b = document.querySelector('.insp .insp-body'); if (b) b.scrollTop = b.scrollHeight; })()`);
        await settleFrames(2); // was sleep(400)
      }
    }
    if (process.env.ESTELLA_SHOT_PLAY) {
      // Multiplayer preview: pick the player count before entering Play
      // (2-4 = listen server + client realms, each its own estella:// frame).
      if (process.env.ESTELLA_SHOT_PLAYERS) {
        await exec(`window.__estellaEditor.setPlayPlayers(${Number(process.env.ESTELLA_SHOT_PLAYERS)})`);
      }
      await exec('window.__estellaEditor.play()');
      await waitFor('window.__estellaEditor.playState().ready || !!window.__estellaEditor.playState().error', 'play realm ready', 20000);
      const err = await exec('window.__estellaEditor.playState().error');
      if (err) console.log('[play] error:', err);
      await settleFrames(30); // let the game loop run so animation/assets settle
    }
    // Pointer drag inside the play realm ("x0,y0,x1,y1" in play-canvas px).
    // The estella:// iframe is an OOPIF — unreachable by SHOT_EVAL and
    // sendInputEvent — so the gesture is dispatched from within its frame,
    // spread over rAF ticks so per-frame input sampling sees it.
    if (process.env.ESTELLA_SHOT_DRAG) {
      const [x0, y0, x1, y1] = process.env.ESTELLA_SHOT_DRAG.split(',').map(Number);
      const playFrame = w.webContents.mainFrame.frames.find((f) => f.url.startsWith('estella://'));
      if (!playFrame) {
        console.log('[drag] no estella:// play frame found');
      } else {
        const result = await playFrame.executeJavaScript(`(async () => {
          const c = document.querySelector('canvas');
          if (!c) return 'no canvas';
          const raf = () => new Promise((r) => requestAnimationFrame(r));
          const fire = (t, x, y, tgt) => (tgt ?? c).dispatchEvent(
            new MouseEvent(t, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 }));
          fire('mousemove', ${x0}, ${y0});
          await raf(); await raf();
          fire('mousedown', ${x0}, ${y0});
          await raf(); await raf();
          for (let i = 1; i <= 12; i++) {
            fire('mousemove', ${x0} + (${x1} - ${x0}) * i / 12, ${y0} + (${y1} - ${y0}) * i / 12);
            await raf(); await raf();
          }
          fire('mouseup', ${x1}, ${y1}, document);
          await raf();
          return 'ok';
        })()`);
        console.log('[drag]', `${x0},${y0} → ${x1},${y1}`, result);
      }
      await settleFrames(8); // let a kinetic fling play out before the capture
    }
    // Eval INSIDE the play realm (the estella:// OOPIF) — the same main-process
    // frame routing as SHOT_DRAG, since neither SHOT_EVAL nor sendInputEvent can
    // reach the iframe. Lets a shot drive gameplay input, e.g. dispatching
    // KeyboardEvents on the frame's document.
    if (process.env.ESTELLA_SHOT_PLAY_EVAL) {
      // ESTELLA_SHOT_PLAY_FRAME picks which play realm the eval targets when a
      // multiplayer preview runs several (0 = the host, 1+ = client realms).
      const frameIndex = Number(process.env.ESTELLA_SHOT_PLAY_FRAME ?? '0');
      const playFrames = w.webContents.mainFrame.frames.filter((f) => f.url.startsWith('estella://'));
      const playFrame = playFrames[frameIndex];
      if (!playFrame) {
        console.log(`[playEval] no estella:// play frame at index ${frameIndex} (${playFrames.length} present)`);
      } else {
        const result = await playFrame
          .executeJavaScript(process.env.ESTELLA_SHOT_PLAY_EVAL)
          .catch((e: Error) => `error: ${e.message}`);
        console.log('[playEval]', typeof result === 'string' ? result : JSON.stringify(result));
        await settleFrames(8);
      }
    }
    if (process.env.ESTELLA_SHOT_EVAL) {
      const result = await exec(process.env.ESTELLA_SHOT_EVAL);
      console.log('[eval]', typeof result === 'string' ? result : JSON.stringify(result));
      await settleFrames(8);
    }
    // Drive an EDITOR-UI drag with TRUSTED input (sendInputEvent), not page-level
    // dispatchEvent: Chromium synthesizes real pointer events from OS mouse input,
    // so React's onPointerDown/gizmo pointer handlers fire (a manually-constructed
    // PointerEvent does not). Spec JSON: { selector, dx, dy, steps?, read? } — drag
    // from the element's centre by (dx,dy) over `steps` moves; `read` is a JS
    // expression logged before + after so a shot can assert the gesture took effect.
    if (process.env.ESTELLA_SHOT_EDITOR_DRAG) {
      const spec = JSON.parse(process.env.ESTELLA_SHOT_EDITOR_DRAG) as
        { selector: string; dx?: number; dy?: number; ox?: number; oy?: number; steps?: number; read?: string };
      const before = spec.read ? await exec(spec.read) : undefined;
      // sendInputEvent hits by coordinate, so the target must be on-screen — scroll
      // it into view first (a no-op for elements not in a scroll container, e.g. a
      // viewport-positioned gizmo handle).
      const at = (await exec(`(() => {
        const el = document.querySelector(${JSON.stringify(spec.selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      })()`)) as { x: number; y: number; inside: boolean } | null;
      if (!at) {
        console.log('[editorDrag] selector not found:', spec.selector);
      } else {
        const x0 = Math.round(at.x + (spec.ox ?? 0)), y0 = Math.round(at.y + (spec.oy ?? 0));
        const x1 = x0 + Math.round(spec.dx ?? 0), y1 = y0 + Math.round(spec.dy ?? 0);
        const steps = Math.max(1, spec.steps ?? 8);
        w.webContents.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          w.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x0 + (x1 - x0) * t), y: Math.round(y0 + (y1 - y0) * t), button: 'left' });
          await settleFrames(1);
        }
        w.webContents.sendInputEvent({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
        await settleFrames(4);
        const after = spec.read ? await exec(spec.read) : undefined;
        console.log('[editorDrag]', JSON.stringify({ from: [x0, y0], to: [x1, y1], inside: at.inside, before, after }));
      }
    }
    await settleFrames(12); // was sleep(2500) — let the engine loop spin up + fully paint the WebGL viewport
    let img = await w.webContents.capturePage();
    // Crop to a single element (ESTELLA_SHOT_CROP=<css selector>, +ESTELLA_SHOT_CROP_PAD
    // px of breathing room) for panel-focused doc shots. The scale is derived from the
    // captured image vs the viewport, so it is correct at any devicePixelRatio.
    const cropSel = process.env.ESTELLA_SHOT_CROP;
    if (cropSel) {
      const view = (await exec(`(() => {
        const el = document.querySelector(${JSON.stringify(cropSel)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, iw: window.innerWidth, ih: window.innerHeight };
      })()`)) as { x: number; y: number; w: number; h: number; iw: number; ih: number } | null;
      if (view) {
        const size = img.getSize();
        const sx = size.width / view.iw, sy = size.height / view.ih;
        const pad = Number(process.env.ESTELLA_SHOT_CROP_PAD ?? '0');
        img = img.crop({
          x: Math.max(0, Math.round((view.x - pad) * sx)),
          y: Math.max(0, Math.round((view.y - pad) * sy)),
          width: Math.round((view.w + pad * 2) * sx),
          height: Math.round((view.h + pad * 2) * sy),
        });
      } else {
        console.warn('[screenshot] crop selector not found:', cropSel);
      }
    }
    await writeFile(out, img.toPNG());
    console.log('[screenshot] wrote', out);
  } catch (e) {
    console.error('[screenshot] failed:', e);
  } finally {
    app.quit();
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  // The app draws its own menu + title bar, so drop the native application menu
  // (on Windows/Linux that's the extra menu row under the title bar).
  if (!isMac) Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    // Automation (screenshot capture of tall panels) can enlarge the window via env;
    // unset in normal use, so the default size is unchanged. Mirrors ESTELLA_MCP_W/H.
    width: Number(process.env.ESTELLA_WIN_W) || 1480,
    height: Number(process.env.ESTELLA_WIN_H) || 920,
    minWidth: 1080,
    minHeight: 680,
    title: 'Estella Editor',
    backgroundColor: '#0E121B',
    // macOS keeps the native traffic lights (hiddenInset); Windows/Linux go fully
    // frameless — which also removes the native menu row — and get our own window
    // controls in the title bar.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { frame: false }),
    icon: path.join(VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Keep the renderer sandboxed; all privileged work goes through preload IPC.
      contextIsolation: true,
      nodeIntegration: false,
      // rAF must keep firing while occluded (automation waits, engine loop).
      backgroundThrottling: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // dockview "move panel to new window" opens a same-origin popout.html child. Allow
    // it as a real OS window the user can drag to another monitor: only the panel's DOM
    // is re-parented there — its React tree + editor state stay in this opener realm
    // (same-origin window.open) — so the child needs no bridge, just a native frame.
    if (isPopoutUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 720,
          height: 560,
          minWidth: 320,
          minHeight: 240,
          backgroundColor: '#0E121B',
          autoHideMenuBar: true,
          title: 'Estella',
        },
      };
    }
    // Everything else is an external link → OS browser, never in-app.
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Mirror maximize state to the renderer so the custom window controls show the
  // correct maximize/restore glyph.
  const emitMax = () => win?.webContents.send('window:maximized', win?.isMaximized() ?? false);
  win.on('maximize', emitMax);
  win.on('unmaximize', emitMax);

  // Screenshot/visual-regression mode (ESTELLA_SHOT=out.png): open ?automation=1 so
  // the renderer hook is live, then drive the launcher→editor flow and capturePage.
  // MCP mode (--mcp) rides the same renderer hook — the exec endpoint drives
  // window.__estellaEditor instead of the screenshot flow.
  const shotOut = process.env.ESTELLA_SHOT;
  const automation = shotOut || mcpMode() ? '?automation=1' : '';

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + automation);
    // SHOT_DEVTOOLS: measure the overhead DevTools itself adds to a run.
    if (!shotOut || process.env.ESTELLA_SHOT_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Load over the loopback http origin (set in whenReady) so the renderer has a real
    // http origin — the engine glue resolves from it and dockview popouts can open a
    // same-origin http child window. Falls back to app:// if the server didn't start.
    win.loadURL(`${appBaseUrl}index.html${automation}`);
  }

  if (shotOut) void runScreenshot(win, shotOut);
  if (mcpMode()) void startMcpEndpoint(() => win);

  // Unsaved-changes quit guard: prompt before closing a window with dirty
  // documents (scene or asset editors — the renderer pushes the aggregate via
  // app:dirty); `quitting` lets the chosen action close past this handler.
  win.on('close', (e) => {
    // Screenshot / automation mode discards unsaved changes silently — a shot run
    // dirties the scene (it creates/edits entities), and a blocking save prompt on
    // app.quit() would hang the headless run waiting for a click.
    if (process.env.ESTELLA_SHOT || quitting || !editorDirty || !win) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes before closing?',
      detail: 'The scene or an open asset editor has unsaved changes that will be lost otherwise.',
    });
    if (choice === 2) return; // Cancel → keep the window open
    if (choice === 1) { quitting = true; win.destroy(); return; } // Don't Save
    // Save All → ask the renderer to save every dirty document, then close when it confirms.
    ipcMain.once('app:quitConfirmed', () => { quitting = true; win?.destroy(); });
    win.webContents.send('app:saveBeforeQuit');
  });
}

// The renderer's current unsaved-changes state (the DirtyRegistry aggregate:
// scene + asset editors), mirrored for the close guard above.
let editorDirty = false;
// Set once the user has chosen to close (Save/Don't Save), so win.destroy() is allowed through.
let quitting = false;
ipcMain.on('app:dirty', (_e, dirty: boolean) => { editorDirty = !!dirty; });

// — Minimal IPC surface (expanded as the editor grows) —
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:platform', () => process.platform);
ipcMain.handle('app:checkUpdates', () => checkForUpdate(app.getVersion()));
ipcMain.handle('diagnostics:openLogs', () => shell.openPath(logsDir()));
ipcMain.on('engine:status', (_e, status: string) => console.log('[engine]', status));

// — Custom window controls (frameless Windows/Linux; macOS uses native traffic lights) —
ipcMain.handle('window:minimize', () => win?.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle('window:close', () => win?.close());
ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false);

// — Project / filesystem (RC12 §E7). The open project root lives here in main;
//   every fs op is sandboxed to it (projectFs.resolveInRoot), so the renderer
//   can only touch files inside the project it opened. —
let projectRoot: string | null = null;
const requireRoot = (): string => {
  if (!projectRoot) throw new Error('no project open');
  return projectRoot;
};

/**
 * Engine runtime dirs — probed by the platform catalog and copied from by the
 * exporters. Resolved in one place so "is this target ready?" and "where does
 * its runtime come from?" can never answer differently.
 */
const platformRuntimeDirs = (): PlatformRuntimeDirs => ({
  web: WEB_WASM_DIR,
  // The -t wechat build (WXWebAssembly glue) syncs to wasm-wechat; fall back to
  // the repo's build dir when running from source.
  wechat: [unpacked(path.join(VITE_PUBLIC, 'wasm-wechat')), path.join(process.env.APP_ROOT!, '..', 'build', 'wasm', 'wechat')]
    .find(existsSync) ?? unpacked(path.join(VITE_PUBLIC, 'wasm-wechat')),
});

// Adopt a freshly opened project as the active root + (re)start the fs watcher
// so on-disk changes push to the renderer, and stage the SDK types into
// .esengine/sdk so the project's tsconfig resolves `esengine` in the IDE.
// Staging failure does NOT block the open — but it is returned so the renderer
// can say it loudly (Output Log + toast), never swallowed into a console.warn.
async function adoptRoot(root: string): Promise<string | undefined> {
  projectRoot = root;
  if (win) startProjectWatch(root, win.webContents);
  try {
    await ensureSdkTypes(root, SDK_TYPES_CANDIDATES, app.getVersion());
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sdk-types]', msg);
    return msg;
  }
}

// A GLSL-only project shader can't render on WebGPU; generate its WGSL twin on
// open (idempotent — a project whose shaders already carry twins costs only a
// directory walk). Never throws: a converter miss must not block opening. Dev
// only — the vendored converters aren't staged into a packaged app yet, where
// shipped shaders are expected to carry the CI-enforced committed twins.
const REPO_ROOT = path.join(__dirname, '..', '..');
async function ensureTwinsForOpen(root: string): Promise<void> {
  if (app.isPackaged) return;
  try {
    const r = await ensureProjectShaderTwins(root, REPO_ROOT);
    if (r.generated.length) console.log(`[shader-twins] generated ${r.generated.length} WGSL twin(s) on open`);
  } catch (err) {
    console.warn('[shader-twins] ensure failed', err);
  }
}

ipcMain.handle('project:openDialog', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Estella Project',
    properties: ['openDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const opened = await openProject(res.filePaths[0]);
  await ensureTwinsForOpen(opened.root);
  return { ...opened, stagingError: await adoptRoot(opened.root) };
});

ipcMain.handle('project:open', async (_e, root: string) => {
  const opened = await openProject(root);
  await ensureTwinsForOpen(opened.root);
  return { ...opened, stagingError: await adoptRoot(opened.root) };
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
  const picked = await importAssets(requireRoot(), destDir, res.filePaths);
  notifyFsChanged(picked.imported);
  return picked;
});

// The write doors PUSH their own change notification once the disk write lands:
// the fs watcher is best-effort (debounced, events can arrive with no filename),
// but "the door returned" must mean "the registry can see it" — the renderer's
// refresh must never depend on the watcher racing our own writes.
function notifyFsChanged(paths: string[]): void {
  if (win && !win.isDestroyed()) win.webContents.send('project:fsChanged', { paths });
}

// Import already-resolved absolute paths (OS drag-drop onto the Content Browser).
ipcMain.handle('project:importFiles', async (_e, destDir: string, sources: string[]) => {
  const result = await importAssets(requireRoot(), destDir, sources);
  notifyFsChanged(result.imported);
  return result;
});

// Create a new asset file (+ .meta) from renderer-supplied content (e.g. New Scene).
ipcMain.handle('project:createAsset', async (_e, destDir: string, baseName: string, content: string, type: string) => {
  const rel = await createAsset(requireRoot(), destDir, baseName, content, type);
  notifyFsChanged([rel]);
  return rel;
});

// The project's launcher cover: capture the composited page region the renderer
// passes (its viewport canvas, center-cropped to 16:9) and write it to the project
// root as thumbnail.png, downscaled to a 640-wide PNG. Called on scene save, so a
// project's card always shows its last-saved look.
ipcMain.handle('project:thumbnail', async (_e, rect: { x: number; y: number; width: number; height: number }) => {
  if (!win) return;
  const img = await win.webContents.capturePage({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
  const scaled = img.getSize().width > 640 ? img.resize({ width: 640 }) : img;
  await writeFile(path.join(requireRoot(), 'thumbnail.png'), scaled.toPNG());
});

ipcMain.handle('fs:read', (_e, relPath: string) => readInRoot(requireRoot(), relPath));
ipcMain.handle('fs:write', (_e, relPath: string, contents: string) =>
  writeInRoot(requireRoot(), relPath, contents),
);
ipcMain.handle('fs:readdir', (_e, relPath: string) => readDirInRoot(requireRoot(), relPath));
ipcMain.handle('fs:listFiles', (_e, relDir: string) => listFilesInRoot(requireRoot(), relDir));
ipcMain.handle('fs:rename', (_e, fromRel: string, toRel: string) =>
  renameInRoot(requireRoot(), fromRel, toRel),
);
ipcMain.handle('fs:mkdir', (_e, relPath: string) => mkdirInRoot(requireRoot(), relPath));
ipcMain.handle('fs:duplicate', (_e, relPath: string) => duplicateInRoot(requireRoot(), relPath));
ipcMain.handle('fs:stat', (_e, relPath: string) => statInRoot(requireRoot(), relPath));
// Delete to the OS trash (recoverable, not an unrecoverable rm) — the asset's
// `.meta` sidecar goes with it so no orphan stays in the registry. A pre-trash
// snapshot backs the renderer's Undo toast; the returned token restores it.
ipcMain.handle('fs:trash', async (_e, relPath: string) => {
  const root = requireRoot();
  const token = await snapshotForTrash(root, relPath);
  const abs = resolveInRoot(root, relPath);
  await shell.trashItem(abs);
  const meta = abs + META_EXT;
  if (existsSync(meta)) await shell.trashItem(meta);
  return token;
});
ipcMain.handle('fs:restoreTrashed', (_e, relPath: string, token: string) =>
  restoreTrashed(requireRoot(), relPath, token),
);
// Crash-recovery snapshots under `.esengine/autosave/` (see electron/autosave.ts).
ipcMain.handle('autosave:sync', (_e, entries: AutosaveEntry[]) => syncAutosave(requireRoot(), entries));
ipcMain.handle('autosave:list', () => listAutosave(requireRoot()));
ipcMain.handle('autosave:restore', (_e, rels: string[]) => restoreAutosave(requireRoot(), rels));
ipcMain.handle('autosave:clear', () => clearAutosave(requireRoot()));
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
// Fast boot path: the cached index without a tree walk (renderer revalidates via
// scanAssets off the critical path). See ProjectStore.buildAssetRegistry.
ipcMain.handle('project:cachedAssetIndex', async () => readCachedAssetIndex(requireRoot()));
// Live sync: incrementally fold the watcher's precise changed paths into the
// cached index instead of a full O(files) rescan on every disk touch. Falls back
// to a full scan (fullRescan: true) when there's no cache yet or the change can't
// be handled per-path (directory move / bulk). See ProjectStore.applyDiskChanges.
ipcMain.handle('project:scanAssetsIncremental', async (_e, paths: string[]) => {
  const root = requireRoot();
  const prev = await readCachedAssetIndex(root);
  if (!prev) return { ...(await scanAssetDatabase(root)), fullRescan: true, reason: 'no cached index' };
  return updateAssetIndex(root, prev, paths);
});

// Cook the project's assets for shipping: from the entry scene, walk the
// dependency graph to the reachable assets, stage them into `outDir`, and emit
// the runtime manifest — culling unreferenced assets (REARCH_ASSETS.md A4).
ipcMain.handle('project:cookAssets', async (_e, outDir?: string) => {
  const root = requireRoot();
  const manifest = await readManifest(root);
  const entry = manifest.defaultScene;
  return cookAssets(root, { entryScenes: entry ? [entry] : [], outDir: outDir ?? 'build' });
});

// Every platform this project can package for, each with its engine runtime
// probed on disk — so the Package dialog can say what is ready BEFORE a build
// runs, and can list the platforms the project defines for itself.
ipcMain.handle('project:listPlatforms', async () =>
  listPlatforms(projectRoot, platformRuntimeDirs(), app.getVersion()),
);

// The ad networks a playable can target — built-ins plus the project's own, so the
// Packaging page offers a network the editor never heard of on equal terms.
ipcMain.handle('project:listPlayableNetworks', async () => listPlayableNetworks(projectRoot));

// Scaffold a project platform — both halves, already joined. The editor writes
// them because the SHAPE of a vendor (two files linked by runtimeProfile) is the
// part that is hard to know before you have seen one.
ipcMain.handle('project:createPlatform', async (_e, id: string, label: string, kind?: ProjectPlatformKind) => {
  const root = requireRoot();
  const manifest = await readManifest(root);
  // The runtime half is game code, so it belongs beside the project's scripts.
  const scriptsDir = path.dirname(resolveScripts(manifest).main ?? 'src/main.ts');
  return createProjectPlatform(root, id, label, scriptsDir, kind);
});

// Export a runnable web build (play == ship): cook + game host + wasm + index.html.
ipcMain.handle(
  'project:exportGame',
  async (e, opts?: { outDir?: string; minify?: boolean; sourcemap?: boolean; platform?: ExportPlatform; compressTextures?: boolean; compressAudio?: boolean; atlasTextures?: boolean }) => {
    const root = requireRoot();
    const manifest = await readManifest(root);
    const entryScene = manifest.defaultScene;
    if (!entryScene) throw new Error('project has no defaultScene to export');
    const sdkDistDir = SDK_DIST;
    const dirs = platformRuntimeDirs();
    const webWasm = dirs.web;
    const wechatWasm = dirs.wechat;
    // A platform the editor does not ship: the project defines it in
    // .esengine/platforms/<id>.mjs. Loaded HERE because the profile carries emit
    // hooks (functions), which cannot cross IPC — the renderer only ever saw its
    // metadata. Absent for every built-in id.
    const projectPlatform = opts?.platform
      ? await loadProjectPlatform(root, opts.platform, dirs)
      : null;
    const plat = manifest.packaging?.platforms;
    // The playable's ad network: a built-in profile or one the project defined. An id
    // that resolves to nothing does not fail the export — it ships generic and says so,
    // because a package with no click-through still previews and still installs.
    const playableAdProfile = opts?.platform === 'playable'
      ? await loadPlayableProfile(root, plat?.playable?.network)
      : null;
    if (opts?.platform === 'playable' && !playableAdProfile) {
      e.sender.send('project:exportProgress', {
        phase: `ad network "${plat?.playable?.network}" not found — packaging generic`,
      });
    }
    const ySortLayers =
      (manifest.features?.rendering?.ySortLayers ?? []).reduce((m, i) => m | (1 << i), 0) >>> 0;
    const colorSpace = manifest.features?.rendering?.colorSpace === 'linear' ? 'linear' as const : undefined;
    // Project camera fit → runtime screenFit (only when the project opts in; scaleMode < 0 = off).
    const fit = resolveScreenFit(manifest);
    const screenFit = fit.scaleMode >= 0 ? fit : undefined;
    const uiTheme = manifest.features?.ui?.theme === 'light' ? 'light' as const : undefined;
    const uiThemeColors = manifest.features?.ui?.colors;
    return exportGame({
      root,
      entryScene,
      scenesDir: resolveLayout(manifest).scenes,
      excludeScenes: manifest.packaging?.excludeScenes,
      ySortLayers,
      colorSpace,
      screenFit,
      uiTheme,
      uiThemeColors,
      gameHostEntry: path.join(HOSTS_DIR, 'gameHost.js'),
      playableHostEntry: path.join(HOSTS_DIR, 'playableHost.js'),
      scriptsEntry: resolveScripts(manifest).main,
      sdkDistDir,
      // A project platform names its own runtime dir (default: the web one).
      wasmDir: projectPlatform ? projectPlatform.wasmDir : opts?.platform === 'wechat' ? wechatWasm : webWasm,
      outDir: opts?.outDir || 'dist-game',
      title: manifest.name,
      platform: opts?.platform,
      miniGameProfile: projectPlatform?.profile,
      playableAdProfile: playableAdProfile ?? undefined,
      desktopAppId: plat?.desktop?.appId,
      desktopProductName: plat?.desktop?.productName,
      wechatAppid: plat?.wechat?.appid,
      // The app's identity, by the one rule every target resolves it with.
      appId: opts?.platform === 'ios' ? resolveAppId(manifest, 'ios') : resolveAppId(manifest, 'android'),
      appVersion: manifest.version,
      androidVersionCode: plat?.android?.versionCode,
      androidAppBundle: plat?.android?.appBundle,
      appIcon: manifest.packaging?.icon,
      // One project-wide orientation for every target: the explicit packaging
      // setting, else derived from the design resolution's aspect.
      orientation: resolveOrientation(manifest),
      minify: opts?.minify,
      sourcemap: opts?.sourcemap,
      compressTextures: opts?.compressTextures,
      compressAudio: opts?.compressAudio,
      atlasTextures: opts?.atlasTextures,
      // iOS wraps its content in an Xcode project; these are the prebuilt pieces
      // it needs, out of the installed runtime template. Null when none is
      // installed for this editor version — the export then says so instead of
      // writing a project that cannot link.
      iosSources: opts?.platform === 'ios' ? iosSourcesFromTemplate(app.getVersion()) : null,
      // Android assembles the APK outright — the template carries everything the
      // package needs, and signing is ours to do.
      androidTemplate: opts?.platform === 'android'
        ? (() => {
          const template = resolveNativeTemplate('android', app.getVersion());
          return template ? { dir: template.dir, abi: template.manifest.abi } : null;
        })()
        : null,
      onProgress: (p) => e.sender.send('project:exportProgress', p),
    });
  },
);

// Preview an http-servable export (web / playable) over a loopback http server, then
// open it in the default browser. That is the build's real deployment surface — an
// http origin (static host / ad-network iframe) — so the file:// opaque-origin rules
// (blocked subresource loads, no wasm streaming) never apply. Returns the URL.
ipcMain.handle('export:preview', async (_e, absDir: string) => {
  const url = await loopbackServer(absDir);
  await shell.openExternal(url);
  return url;
});

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
  return buildPlayRealm({
    root,
    playHostArtifact: path.join(HOSTS_DIR, 'playHost.js'),
    sdkDistDir: SDK_DIST,
    wasmDir: WEB_WASM_DIR,
  });
});

ipcMain.handle('recents:list', () => listRecents());
ipcMain.handle('recents:add', (_e, root: string, name: string) => addRecent(root, name));
ipcMain.handle('recents:remove', (_e, root: string) => removeRecent(root));

// — Editor plugins. Discovery, compilation, and the trust record live in main
//   (disk + userData); activation lives in the renderer, which is the realm the
//   contributions land in. A renderer plugin runs in the editor's own realm, so
//   `load` hands back code + its hash and whether the user approved THAT build —
//   main never decides to run it. —
const userData = (): string => app.getPath('userData');

// Project platform profiles are imported into THIS process with full Node, so they
// pass the same approval the plugin host applies. Injected rather than threaded
// through the catalog's signatures (the setAssetRefProblemResolver pattern), which
// also keeps the catalog unit-testable with no gate installed.
setPlatformTrustGate((id, file) => isTrusted(userData(), id, '0.0.0', file));

ipcMain.handle('plugins:list', async () => {
  const found = await discoverPlugins(projectRoot, userData());
  return found.map((p) => ({ ...p, disabled: isDisabled(userData(), p.id) }));
});

ipcMain.handle('plugins:load', async (_e, id: string) => {
  const found = await discoverPlugins(projectRoot, userData());
  const plugin = found.find((p) => p.id === id && !p.shadowedBy);
  if (!plugin) return { ok: false, errors: [`plugin "${id}" not found`], warnings: [] };
  const entry = plugin.manifest?.main?.editor;
  if (!entry) return { ok: false, errors: [`plugin "${id}" has no renderer entry`], warnings: [] };
  const built = await compilePlugin(plugin.dir, entry);
  return { ...built, trusted: isTrusted(userData(), id, plugin.manifest!.version, plugin.dir) };
});

// The renderer says only "the user approved this id" — main resolves which version
// and folder that means, so the approval can't be recorded against a stale pair.
// Trust WITHOUT compiling — what a project platform profile needs, since it has no
// renderer entry to build and approving it only permits a main-process import.
ipcMain.handle('plugins:trustState', async (_e, id: string) => {
  const found = await discoverPlugins(projectRoot, userData());
  const entry = found.find((p) => p.id === id && p.manifest);
  return !!entry && isTrusted(userData(), id, entry.manifest!.version, entry.dir);
});

ipcMain.handle('plugins:trust', async (_e, id: string) => {
  const found = await discoverPlugins(projectRoot, userData());
  const plugin = found.find((p) => p.id === id && p.manifest);
  if (plugin) trustPlugin(userData(), id, plugin.manifest!.version, plugin.dir);
});
ipcMain.handle('plugins:revokeTrust', (_e, id: string) => revokeTrust(userData(), id));
ipcMain.handle('plugins:setEnabled', (_e, id: string, enabled: boolean) =>
  setPluginEnabled(userData(), id, enabled),
);
ipcMain.handle('plugins:reveal', async (_e, id: string) => {
  const found = await discoverPlugins(projectRoot, userData());
  const dir = found.find((p) => p.id === id)?.dir;
  if (dir) shell.openPath(dir);
});

// — Native runtime templates. The prebuilt engine a mobile target is assembled
//   around: the editor never compiles one, it installs the release's artifact. —
ipcMain.handle('nativeTemplates:list', () => listNativeTemplates(app.getVersion()));
ipcMain.handle('nativeTemplates:install', async () => {
  if (!win) return { ok: false, error: 'no window' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Install a runtime template',
    filters: [{ name: 'Estella runtime template', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (res.canceled || res.filePaths.length === 0) return { ok: false, canceled: true };
  return installNativeTemplate(res.filePaths[0], app.getVersion());
});
ipcMain.handle('nativeTemplates:remove', (_e, platform: 'android' | 'ios', abi: string, version: string) =>
  removeNativeTemplate(platform, abi, version),
);
// Download + install this editor version's template. Progress is pushed rather
// than polled: the renderer drew the button, so it owns the progress bar.
ipcMain.handle('nativeTemplates:download', (e, platform: 'android' | 'ios') =>
  downloadNativeTemplate(platform, app.getVersion(), {
    onProgress: (p) => e.sender.send('nativeTemplates:downloadProgress', { platform, ...p }),
  }),
);

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

// Serve a project file, honoring an HTTP Range request (206) when present so
// <video> streams/seeks; ranged reads pull only the requested slice off disk.
async function serveProjectFile(abs: string, request: Request): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': httpContentType(abs),
    // The play realm (app:// origin) loads project assets cross-scheme via
    // <img crossorigin> + fetch; allow it. estella:// is only reachable inside
    // the Electron app, so there is no untrusted-web exposure.
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  };
  const rangeHeader = request.headers.get('range');
  const range = rangeHeader ? parseByteRange(rangeHeader, (await stat(abs)).size) : null;
  if (range === 'invalid') {
    return new Response('range not satisfiable', {
      status: 416, headers: { ...headers, 'content-range': `bytes */${(await stat(abs)).size}` },
    });
  }
  if (range) {
    const fh = await open(abs, 'r');
    try {
      const buf = Buffer.alloc(range.length);
      await fh.read(buf, 0, range.length, range.start);
      return new Response(new Uint8Array(buf), {
        status: 206,
        headers: { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${range.size}`, 'content-length': String(range.length) },
      });
    } finally {
      await fh.close();
    }
  }
  const bytes = await readFile(abs);
  return new Response(new Uint8Array(bytes), { headers });
}

/** Parse a single-range `bytes=start-end` header against a known file size.
 *  Returns the resolved slice, `'invalid'` for an unsatisfiable range, or null
 *  when the header isn't a form we serve (caller sends the whole file). */
function parseByteRange(header: string, size: number):
  { start: number; end: number; length: number; size: number } | 'invalid' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? NaN : parseInt(m[1], 10);
  let end = m[2] === '' ? NaN : parseInt(m[2], 10);
  if (Number.isNaN(start)) {
    // suffix range `bytes=-N`: the last N bytes.
    const n = Number.isNaN(end) ? 0 : end;
    start = Math.max(0, size - n);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (size === 0 || start > end || start >= size) return 'invalid';
  end = Math.min(end, size - 1);
  return { start, end, length: end - start + 1, size };
}

// estella://project/<relpath> → bytes from the open project root (sandboxed).
async function handleEstella(request: Request): Promise<Response> {
  if (!projectRoot) return new Response('no project open', { status: 503 });
  try {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '');
    const abs = resolveInRoot(projectRoot, rel); // throws if it escapes the root
    return await serveProjectFile(abs, request);
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
      return await serveProjectFile(abs, request);
    }
    const abs = path.join(RENDERER_DIST, rel);
    if (abs !== RENDERER_DIST && !abs.startsWith(RENDERER_DIST + path.sep)) {
      return new Response('forbidden', { status: 403 });
    }
    const bytes = await readFile(abs);
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': httpContentType(abs), 'access-control-allow-origin': '*' },
    });
  } catch (err) {
    return new Response(String(err), { status: 404 });
  }
}

installCrashCapture();

app.whenReady().then(async () => {
  protocol.handle('estella', handleEstella);
  protocol.handle('app', handleApp);
  // Packaged: serve the built renderer (dist/) over a loopback http origin so it has a
  // real http origin, the way dev already runs on Vite's http. dockview's pop-a-panel-
  // out uses a same-origin `window.open`, which it rejects for the app:// custom scheme;
  // http satisfies it. estella:// (project assets + the play realm) is a separate scheme
  // and is unaffected. Fall back to app:// if the server can't start.
  if (!VITE_DEV_SERVER_URL) {
    try {
      appBaseUrl = await loopbackServer(RENDERER_DIST);
    } catch (err) {
      console.error('[loopback] renderer server failed; falling back to app://', err);
      appBaseUrl = `${APP_ORIGIN}/`;
    }
  }
  createWindow();

  // Startup update check: silent unless a newer release exists (offline = no-op).
  // Skipped in automation/dev so screenshots and local runs stay deterministic.
  if (!VITE_DEV_SERVER_URL && !process.env.ESTELLA_SHOT) {
    setTimeout(() => {
      void checkForUpdate(app.getVersion()).then((release) => {
        if (release && win && !win.isDestroyed()) {
          win.webContents.send('app:updateAvailable', release);
        }
      });
    }, 5000);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  win = null;
  stopProjectWatch();
  if (process.platform !== 'darwin') app.quit();
});

// Tear down the loopback servers (renderer shell + export previews) on quit.
app.on('before-quit', () => closeAllLoopbackServers());
