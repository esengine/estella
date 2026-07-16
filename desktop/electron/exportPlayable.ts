// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Playable-ad export (REARCH_EXPORT E3). Produces ONE self-contained
 *        `index.html` (no external requests — ad networks require single-file):
 *          - the SINGLE_FILE engine glue (esengine.single.js, global ESEngineModule
 *            with the wasm embedded as base64) inlined as a <script>;
 *          - assets as base64 data URLs + scenes inlined as <script> globals
 *            (keyed by the scene's @uuid: refs — EmbeddedAssetProvider resolves them);
 *          - the playable host + esengine + project scripts esbuilt to ONE IIFE.
 *        Boots the SAME shipping runtime via initPlayableRuntime (play == ship).
 *
 *        Correct-by-construction against initPlayableRuntime + the SINGLE_FILE glue
 *        contract (no playable simulator here — runtime is validated by the user in
 *        a browser / ad preview). Pure Node (esbuild + fs); IPC wiring in main.ts.
 */
import { loadEsbuild } from './esbuildRuntime';
import { writeFile, mkdir, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from './cookAssets';
import type { OnExportProgress } from './exportProgress';
import { esengineAlias } from './esengineResolve';
import { orientationCss, orientationOverlayHtml, orientationLockScript, type ScreenOrientation } from './orientationHtml';
import {
  sceneUsesPhysics, detectSpineVersion, detectSpineVersionJson,
  spineModuleId, SIDE_MODULE_FILE, type SpineVersion,
} from './sideModuleScan';

export interface ExportPlayableResult {
  ok: boolean;
  platform: 'playable';
  outDir: string;
  included: number;
  /** Final index.html size in bytes (for ad-network size limits). */
  bytes: number;
  warnings: string[];
  errors: string[];
}

interface CookManifest {
  entries: { uuid: string; path: string; sourcePath?: string; type: string }[];
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  svg: 'image/svg+xml', ktx2: 'image/ktx2', json: 'application/json', esscene: 'application/json',
  fnt: 'text/plain', txt: 'text/plain', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav',
  m4a: 'audio/mp4', aac: 'audio/aac', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};
const mimeOf = (p: string): string => MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';

/** Escape `</script` so inlined content can't close the host <script> early. */
const inlineSafe = (s: string): string => s.replace(/<\/script/gi, '<\\/script');

function indexHtml(title: string, globals: string, bundle: string, orientation: ScreenOrientation): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>${title}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #0e121b; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; }
      ${orientationCss(orientation)}
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    ${orientationOverlayHtml(orientation)}
    ${orientationLockScript(orientation)}
    <script>${inlineSafe(globals)}</script>
    <script>${inlineSafe(bundle)}</script>
  </body>
</html>
`;
}

/**
 * The export-time mirror of the runtime's physics/spine self-gating: scan the
 * scene for needed modules and inline their glue+wasm as base64 (single-file, no
 * fetch). A needed module absent from `wasmDir` is pushed as a HARD error — the
 * playable would otherwise ship silently broken (the bug this whole path fixes).
 */
async function collectSideModules(
  sceneData: unknown,
  manifestEntries: CookManifest['entries'],
  cookDir: string,
  wasmDir: string,
  errors: string[],
): Promise<Record<string, { glueBase64: string; wasmBase64: string }>> {
  const ids = new Set<string>();
  if (sceneData && sceneUsesPhysics(sceneData as Parameters<typeof sceneUsesPhysics>[0])) ids.add('physics');
  // Spine: the skeleton carries the version. Skeleton + atlas share the authored
  // meta type `spine`, so we discriminate by extension (as the runtime does via
  // the asset-type registry's contentType) — `.skel` is a binary skeleton, `.json`
  // a JSON one; the `.atlas` sibling is not a skeleton and is skipped.
  for (const e of manifestEntries) {
    if (e.type !== 'spine') continue;
    const ext = path.extname(e.sourcePath ?? e.path).toLowerCase();
    try {
      let v: SpineVersion | null = null;
      if (ext === '.skel') {
        v = detectSpineVersion(new Uint8Array(await readFile(path.join(cookDir, e.path))));
      } else if (ext === '.json') {
        v = detectSpineVersionJson(await readFile(path.join(cookDir, e.path), 'utf8'));
      }
      if (v) ids.add(spineModuleId(v));
    } catch { /* unreadable cook entry — cookAssets already warned; skip */ }
  }

  const registry: Record<string, { glueBase64: string; wasmBase64: string }> = {};
  for (const id of ids) {
    const file = SIDE_MODULE_FILE[id];
    if (!file) { errors.push(`internal: no artifact mapping for side module "${id}"`); continue; }
    const gluePath = path.join(wasmDir, `${file}.js`);
    const wasmPath = path.join(wasmDir, `${file}.wasm`);
    if (!existsSync(gluePath) || !existsSync(wasmPath)) {
      errors.push(`scene needs "${id}" but ${file}.js/${file}.wasm are missing from the wasm dir — build the module and re-export.`);
      continue;
    }
    registry[id] = {
      glueBase64: (await readFile(gluePath)).toString('base64'),
      wasmBase64: (await readFile(wasmPath)).toString('base64'),
    };
  }
  return registry;
}

/**
 * Export the open project as a single-file playable ad. Reuses the shipped WEB
 * engine runtime (esengine.js glue + esengine.wasm) inlined — no separate
 * SINGLE_FILE build. `playableHostEntry` is the host source; `wasmDir` the web wasm dir.
 */
export async function exportPlayable(opts: {
  root: string;
  entryScene: string;
  scriptsEntry?: string;
  playableHostEntry: string;
  /** Web SDK dist dir — `esengine` is INLINED for playable (no import map), so the
   *  bundle aliases it here (the project root has no esengine to resolve). */
  sdkDir: string;
  /** Web wasm dir (esengine.js glue + esengine.wasm) — inlined into the single HTML. */
  wasmDir: string;
  outDir: string;
  title?: string;
  /** Screen orientation (format.ts resolveOrientation) → rotate-to-fit overlay +
   *  best-effort lock in the single-file HTML. Default landscape. */
  orientation?: ScreenOrientation;
  minify?: boolean;
  /** Bitmask of render layers (0..31) that y-sort (Project Settings → Rendering). */
  ySortLayers?: number;
  /** Project color space — 'linear' boots the playable on the linear-light pipeline. */
  colorSpace?: 'gamma' | 'linear';
  /** Project camera fit (design resolution + scale mode) — letterboxes the main camera
   *  without a UI Canvas; absent = no fit. */
  screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
  onProgress?: OnExportProgress;
}): Promise<ExportPlayableResult> {
  const title = opts.title ?? 'Game';
  const orientation: ScreenOrientation = opts.orientation ?? 'landscape';
  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  const progress = opts.onProgress ?? (() => {});
  const warnings: string[] = [];
  const errors: string[] = [];
  await mkdir(absOut, { recursive: true });
  const cookDir = path.join(absOut, '.playable-cook');

  // 1. Cook reachable assets to a temp dir (everything ends up inlined → removed after).
  progress({ phase: 'Cooking assets' });
  const cook = await cookAssets(opts.root, { entryScenes: [opts.entryScene], outDir: cookDir });
  warnings.push(...cook.warnings);

  // 2. Assets → base64 data URLs, keyed by the scene's @uuid: refs; plus a
  //    compact logical-path → key map so PATH-style refs (a scene's material
  //    path, a material's rewritten logical refs) resolve to the same inlined
  //    data — the runtime aliases them in memory, so the payload carries each
  //    data URL exactly once.
  progress({ phase: 'Encoding assets' });
  const assets: Record<string, string> = {};
  const pathMap: Record<string, string> = {};
  let manifestEntries: CookManifest['entries'] = [];
  try {
    const manifest = JSON.parse(await readFile(path.join(cookDir, 'assets.manifest.json'), 'utf8')) as CookManifest;
    manifestEntries = manifest.entries;
    // Playable has no runtime catalog channel yet, so atlas frame/uv metadata
    // cannot reach the sprites — a packed texture would render its whole page.
    if (manifest.entries.some((e) => (e as { atlas?: unknown }).atlas)) {
      warnings.push('cook produced atlas-packed textures, which the playable runtime cannot consume yet — export without atlasTextures for playables.');
    }
    for (const e of manifest.entries) {
      const buf = await readFile(path.join(cookDir, e.path));
      const key = `@uuid:${e.uuid}`;
      assets[key] = `data:${mimeOf(e.path)};base64,${buf.toString('base64')}`;
      pathMap[e.sourcePath ?? e.path] = key;
    }
  } catch (err) {
    errors.push(`assets: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 3. Scene inlined (keeps @uuid: refs — EmbeddedAssetProvider resolves them).
  const sceneName = path.basename(opts.entryScene).replace(/\.[^.]+$/, '');
  let scenes: Array<{ name: string; data: unknown }> = [];
  try {
    const data = JSON.parse(await readFile(path.join(cookDir, opts.entryScene), 'utf8'));
    scenes = [{ name: sceneName, data }];
  } catch (err) {
    errors.push(`scene: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. Host + esengine + project scripts → ONE IIFE (esengine INLINED; no import map).
  progress({ phase: 'Bundling game' });
  const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
  const entrySrc =
    (scriptsAbs && existsSync(scriptsAbs) ? `import ${JSON.stringify(scriptsAbs)};\n` : '') +
    `import ${JSON.stringify(opts.playableHostEntry)};\n`;
  let bundle = '';
  try {
    const { build } = await loadEsbuild();
    const res = await build({
      stdin: { contents: entrySrc, resolveDir: opts.root, loader: 'js', sourcefile: 'playable-entry.js' },
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      // esengine is INLINED (single-file, no import map) → resolve it from the SDK
      // dist; the project root has no esengine installed.
      alias: esengineAlias(opts.sdkDir),
      minify: opts.minify ?? false,
      write: false,
      outfile: 'game-bundle.js',
      logLevel: 'silent',
    });
    errors.push(...res.errors.map((e) => e.text));
    bundle = res.outputFiles?.[0]?.text ?? '';
  } catch (err) {
    const e = err as { errors?: { text: string }[]; message?: string };
    errors.push(...(e.errors?.map((x) => x.text) ?? [String(e.message ?? err)]));
  }

  // 5. Engine runtime: reuse the shipped WEB build (esengine.js glue + esengine.wasm),
  //    inlined — the host loads the glue via a blob module + feeds the wasm (base64)
  //    through instantiateWasm. No separate single-file build needed.
  progress({ phase: 'Inlining engine' });
  let glue = '';
  let wasmB64 = '';
  const gluePath = path.join(opts.wasmDir, 'esengine.js');
  const wasmPath = path.join(opts.wasmDir, 'esengine.wasm');
  if (existsSync(gluePath) && existsSync(wasmPath)) {
    glue = await readFile(gluePath, 'utf8');
    wasmB64 = (await readFile(wasmPath)).toString('base64');
  } else {
    errors.push(`engine runtime not found in ${opts.wasmDir} (need esengine.js + esengine.wasm)`);
  }

  // 5b. Side modules (physics / spine): run the runtime's gating scan, then inline
  //     exactly the modules the scene needs (playables are single-file + size-capped).
  //     A needed module missing from wasmDir is a HARD error — better a failed
  //     export than a playable that silently ships without physics.
  progress({ phase: 'Embedding modules' });
  const sideModules = await collectSideModules(scenes[0]?.data, manifestEntries, cookDir, opts.wasmDir, errors);

  // 6. Assemble the single HTML, then drop the temp cook dir.
  progress({ phase: 'Assembling HTML' });
  const globals =
    `window.__ENGINE_GLUE__=${JSON.stringify(glue)};` +
    `window.__ENGINE_WASM__=${JSON.stringify(wasmB64)};` +
    `window.__SIDE_MODULES__=${JSON.stringify(sideModules)};` +
    `window.__GAME_ASSETS__=${JSON.stringify(assets)};` +
    `window.__GAME_PATHMAP__=${JSON.stringify(pathMap)};` +
    `window.__GAME_SCENES__=${JSON.stringify(scenes)};` +
    `window.__GAME_FIRST__=${JSON.stringify(sceneName)};` +
    `window.__GAME_YSORT__=${(opts.ySortLayers ?? 0) >>> 0};` +
    `window.__GAME_COLORSPACE__=${JSON.stringify(opts.colorSpace === 'linear' ? 'linear' : 'gamma')};` +
    (opts.screenFit && opts.screenFit.scaleMode >= 0 ? `window.__GAME_SCREENFIT__=${JSON.stringify(opts.screenFit)};` : '');
  const outFile = path.join(absOut, 'index.html');
  await writeFile(outFile, indexHtml(title, globals, bundle, orientation));
  await rm(cookDir, { recursive: true, force: true });

  const bytes = (await stat(outFile)).size;
  // Ad networks cap playable size (Facebook ~2MB, Google ~5MB). A full WASM engine
  // + assets typically exceeds this — surface it rather than silently ship a reject.
  if (bytes > 2 * 1024 * 1024) {
    warnings.push(`playable is ~${(bytes / 1024 / 1024).toFixed(1)}MB — likely over ad-network limits (Facebook ~2MB, Google ~5MB).`);
  }

  return { ok: errors.length === 0, platform: 'playable', outDir: absOut, included: cook.included.length, bytes, warnings, errors };
}
