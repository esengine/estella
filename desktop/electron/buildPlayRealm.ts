// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Play-realm host assembly (REARCH_EDITOR_REALM import-map phase). Stages a
 *        self-contained realm under the project's `.esengine/play/` so the editor
 *        can run it from `estella://project/.esengine/play/play.html` (everything
 *        same-origin estella://):
 *          - host.js   the PREBUILT play-host bundle (esengine EXTERNAL), copied
 *          - sdk/       a copy of the SDK dist (the import-map target)
 *          - wasm/      a copy of the engine runtime (glue + binary + side modules)
 *          - play.html  the host page: import map (esengine → ./sdk) + host.js
 *        The host is editor code: it's bundled at editor build time (the
 *        realm-hosts step in vite.config.ts) and staged here by copy — never
 *        bundled at runtime, since a packaged app ships no src/ and esbuild (a
 *        native subprocess) cannot read app.asar. The project bundle
 *        (`.esengine/cache/scripts.mjs`, esengine external — built separately by
 *        buildProjectScripts, which DOES esbuild at runtime: project sources
 *        live on the real filesystem) resolves esengine through the SAME import
 *        map, so its defineComponent/defineSystem register into the instance the
 *        host's createWebApp uses (custom components+systems run).
 *
 *        Pure Node (fs); IPC wiring in main.ts.
 */
import { cp, mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadProjectModules, sideModuleDeclarations, stageProjectModules } from './projectModules';

const PLAY_DIR = '.esengine/play';

// Subpath exports can't be a single `esengine/` → `./sdk/` mapping (import maps
// don't append /index.js for directories), so list the real files (mirrors
// sdk/package.json `exports`).
// The realm + the shipped game share this import map (esengine → ./sdk) and the
// CSP hash for the inline <script type=importmap>. Subpath exports are listed
// explicitly (import maps don't append /index.js for a directory).
export const IMPORT_MAP = {
  imports: {
    esengine: './sdk/index.js',
    'esengine/spine': './sdk/spine/index.js',
    'esengine/dragonbones': './sdk/dragonbones/index.js',
    'esengine/physics': './sdk/physics/index.js',
    'esengine/wasm': './sdk/wasm.js',
    'esengine/factory': './sdk/webAppFactory.js',
  },
};
export const IMPORT_MAP_JSON = JSON.stringify(IMPORT_MAP);
export const IMPORT_MAP_CSP_HASH = `sha256-${createHash('sha256').update(IMPORT_MAP_JSON).digest('base64')}`;

// The inline import map is an inline <script>, so CSP must allow it — by HASH
// (not 'unsafe-inline', which would permit any inline script). 'unsafe-eval' is
// for the emscripten glue; `blob:` in script-src lets an optional native module's
// glue run as a blob-URL ES module (the loader imports it from a blob); everything
// else is same-origin estella://.
const PLAY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self' estella:; script-src 'self' 'unsafe-eval' blob: '${IMPORT_MAP_CSP_HASH}' estella:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: estella:; font-src 'self' data: estella:; connect-src 'self' data: blob: estella:; worker-src 'self' blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>Estella Play</title>
    <script type="importmap">${IMPORT_MAP_JSON}</script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #0e121b; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <script type="module" src="./host.js"></script>
  </body>
</html>
`;

export interface PlayRealmResult {
  ok: boolean;
  /** Project-relative path to the host page → `estella://project/<hostPath>`. */
  hostPath: string;
  errors: string[];
  /** Non-fatal: a project module with no web build, say. Play still runs. */
  warnings: string[];
  /**
   * The project's own native modules, staged into the realm's `wasm/` and ready
   * to be declared to it — the same shape `game.config.json` carries in an
   * export, because it is the same fact told to a different realm.
   *
   * Play has to load these or the loop is broken: a developer would have to
   * package the game to find out whether their module works, which is exactly
   * the feedback delay the editor exists to remove.
   */
  sideModules: Array<{ id: string; file: string; globalName?: string }>;
}

/** Signature over a dir's top-level entries (name+size+mtime) — catches an
 *  ADDED/removed file (e.g. physics.wasm), not just a changed marker file. */
async function dirSignature(dir: string): Promise<string> {
  const names = (await readdir(dir)).sort();
  const parts: string[] = [];
  for (const n of names) {
    const s = await stat(path.join(dir, n));
    parts.push(`${n}:${s.size}:${Math.round(s.mtimeMs)}`);
  }
  return parts.join('|');
}

/** Copy `src`→`dst` only when its dir signature changed since the last copy.
 *  Gating on a single marker missed files added later (physics.wasm) when the
 *  marker's mtime hadn't moved; a full signature re-copies on any add/remove. */
async function syncDir(src: string, dst: string, stampFile: string): Promise<void> {
  if (!existsSync(src)) return;
  const sig = await dirSignature(src);
  if (existsSync(dst) && existsSync(stampFile) && (await readFile(stampFile, 'utf8')) === sig) return;
  // Retries absorb the transient ENOTEMPTY when another editor instance (or a
  // crashed earlier copy) still has fingers in this disposable staging dir.
  await rm(dst, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  await cp(src, dst, { recursive: true });
  await writeFile(stampFile, sig);
}

export async function buildPlayRealm(opts: {
  root: string;
  /** The prebuilt play-host bundle (dist-electron/hosts/playHost.js). */
  playHostArtifact: string;
  sdkDistDir: string;
  wasmDir: string;
}): Promise<PlayRealmResult> {
  const out = path.join(opts.root, PLAY_DIR);
  const errors: string[] = [];
  await mkdir(out, { recursive: true });

  // 1. Host module — the prebuilt bundle, staged by copy (readFile/writeFile so
  //    an asar-packed artifact reads through Electron's patched fs). Stamped on
  //    the artifact's stat so a repeat Play skips the copy.
  if (!existsSync(opts.playHostArtifact)) {
    return {
      ok: false,
      hostPath: '',
      errors: [`play host bundle not found: ${opts.playHostArtifact} (built by vite build — see realm-hosts in vite.config.ts)`],
      warnings: [],
      sideModules: [],
    };
  }
  const hostStamp = path.join(out, '.host-stamp');
  const hostOut = path.join(out, 'host.js');
  const entryStat = await stat(opts.playHostArtifact);
  const hostSig = `${opts.playHostArtifact}:${entryStat.size}:${Math.round(entryStat.mtimeMs)}`;
  const hostFresh =
    existsSync(hostOut) && existsSync(hostStamp) && (await readFile(hostStamp, 'utf8')) === hostSig;
  if (!hostFresh) {
    await writeFile(hostOut, await readFile(opts.playHostArtifact));
    await writeFile(hostStamp, hostSig);
  }

  // 2. SDK + wasm copies (gated on a full dir signature, so an added file re-syncs).
  await syncDir(opts.sdkDistDir, path.join(out, 'sdk'), path.join(out, '.sdk-stamp'));
  await syncDir(opts.wasmDir, path.join(out, 'wasm'), path.join(out, '.wasm-stamp'));
  // …and the project's own modules on top. AFTER the sync, which deletes its
  // destination before copying — and unconditionally, because it is a handful of
  // files and re-staging them is how an edited module reaches the next Play.
  // The realm is a web one (fetch transport), so it takes the `web` build.
  const projectModules = await loadProjectModules(opts.root, 'web');
  // Not an error: a module with no web build leaves Play without it, and the
  // rest of the game still runs. It is said out loud instead — the alternative
  // is a plugin that quietly does nothing.
  const warnings = await stageProjectModules(projectModules, path.join(out, 'wasm'), 'web');

  // 3. Host page (rewrite only on change — keeps mtimes stable).
  const htmlPath = path.join(out, 'play.html');
  if (!existsSync(htmlPath) || (await readFile(htmlPath, 'utf8')) !== PLAY_HTML) {
    await writeFile(htmlPath, PLAY_HTML);
  }

  return {
    ok: errors.length === 0,
    hostPath: `${PLAY_DIR}/play.html`,
    errors,
    warnings,
    sideModules: sideModuleDeclarations(projectModules, 'web'),
  };
}
