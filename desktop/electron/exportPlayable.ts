// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Playable-ad export (REARCH_EXPORT E3). Produces ONE self-contained
 *        `index.html` (single-file, no fetches — what ad networks require):
 *          - the shipped WEB engine glue (esengine.js) inlined as a global, run by
 *            the host as a blob module, with esengine.wasm inlined as base64 and fed
 *            through instantiateWasm — so no separate single-file engine build;
 *          - assets as base64 data URLs + scenes inlined as <script> globals
 *            (keyed by the scene's @uuid: refs — EmbeddedAssetProvider resolves them);
 *          - the playable host + esengine + project scripts esbuilt to ONE IIFE;
 *          - whatever the chosen ad network's profile injects (playableAdProfile.ts).
 *        Boots the SAME shipping runtime via initPlayableRuntime (play == ship).
 *
 *        Correct-by-construction against initPlayableRuntime (no playable simulator
 *        here — runtime is validated in a browser / ad preview). Pure Node (esbuild
 *        + fs); IPC wiring in main.ts.
 */
import { loadEsbuild } from './esbuildRuntime';
import {
  DEFAULT_RUNTIME_CONFIG, packagedRuntimeFields, type RuntimeProjectConfig,
} from '../../pipeline/src/project/runtimeConfig';
import { writeFile, mkdir, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from '../../pipeline/src/assets/cookAssets';
import type { OnExportProgress } from './exportProgress';
import { esengineAlias } from './esengineResolve';
import { explainBundleErrors, type BundleMessage } from './bundleDiagnostics';
import type { ScreenOrientation } from './orientationHtml';
import { genericPlayableProfile, playableAdInjection, type PlayableAdProfile } from './playableAdProfile';
import { makeZip } from '../../build-tools/utils/zip.js';
import {
  sceneUsesPhysics, sceneUsesDragonBones, detectSpineVersion, detectSpineVersionJson,
  spineModuleId, SIDE_MODULE_FILE, type SpineVersion,
} from './sideModuleScan';

export interface ExportPlayableResult {
  ok: boolean;
  platform: 'playable';
  outDir: string;
  included: number;
  /** Size of the file that gets UPLOADED, which the network's limit applies to: the
   *  archive for a zip-delivery network, else index.html itself. */
  bytes: number;
  /** index.html on its own — the same as {@link bytes} unless a zip was written. */
  htmlBytes: number;
  /** The archive written for a zip-delivery network (absolute path). */
  zipFile?: string;
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

/**
 * The playable page. Deliberately WITHOUT the web export's rotate-to-fit overlay:
 * inside an ad SDK the container's size is the SDK's business, so `@media
 * (orientation:portrait)` reports the container's aspect and not the device's —
 * turning the phone need not change it. An overlay keyed on that hides the canvas
 * and never comes back, which is a playable that cannot be played. Every network
 * asks for a responsive creative instead (Unity spells out both orientations), and
 * the host already resizes the canvas to whatever container it is given.
 *
 * `orientation` therefore only reaches the network profile, which may still DECLARE
 * it (Google wants an `ad.orientation` meta tag) — a declaration to the platform, not
 * a demand on the player.
 *
 * `network` is what the chosen profile contributes: markup for `<head>` and the
 * bridge that gives `playableCta()` somewhere to go. The bridge runs BEFORE the game
 * bundle, so a CTA fired during boot still resolves.
 */
function indexHtml(
  title: string,
  globals: string,
  bundle: string,
  network: { head: string; bridge: string },
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>${title}</title>${network.head ? `\n    ${network.head}` : ''}
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #0e121b; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>${network.bridge ? `\n    <script>${inlineSafe(network.bridge)}</script>` : ''}
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
  physicsEnabled: boolean,
): Promise<Record<string, { glueBase64: string; wasmBase64: string }>> {
  const ids = new Set<string>();
  // A declared physics project counts as a use even with no bodies in the scene:
  // it spawns them from script, and the flag is worthless without the binary.
  if (physicsEnabled
    || (sceneData && sceneUsesPhysics(sceneData as Parameters<typeof sceneUsesPhysics>[0]))) ids.add('physics');
  if (sceneData && sceneUsesDragonBones(sceneData as Parameters<typeof sceneUsesDragonBones>[0])) ids.add('dragonbones');
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
  /** Project orientation (format.ts resolveOrientation). The page itself does NOT
   *  pin it — a playable must fit whatever container the SDK gives it — this only
   *  reaches the ad-network profile, which may declare it to the platform. */
  orientation?: ScreenOrientation;
  minify?: boolean;
  /** The project's runtime settings, derived once by `runtimeConfigOf`; the page
   *  carries the packaged slice of them as one global the host reads. */
  runtime?: RuntimeProjectConfig;
  /** The ad network this package targets (Project Settings → Packaging → Playable):
   *  its size cap, its `<head>` markup and its click-through API. Absent ⇒ generic. */
  adProfile?: PlayableAdProfile;
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
  // Playable inlines everything base64 (no KTX2 transcoder), so it doesn't set
  // compressTextures — the platform is threaded for when per-platform Import
  // Settings (e.g. a tighter Max Size for the ad-size cap) gain a raw-downscale path.
  const cook = await cookAssets(opts.root, { entryScenes: [opts.entryScene], outDir: cookDir, platform: 'playable' });
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
    errors.push(...explainBundleErrors(res.errors));
    bundle = res.outputFiles?.[0]?.text ?? '';
  } catch (err) {
    const e = err as { errors?: BundleMessage[]; message?: string };
    errors.push(...(e.errors ? explainBundleErrors(e.errors) : [String(e.message ?? err)]));
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
  const sideModules = await collectSideModules(
    scenes[0]?.data, manifestEntries, cookDir, opts.wasmDir, errors,
    opts.runtime?.physicsEnabled ?? false,
  );

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
    // ONE global for the project's settings, in the same shape game.config.json
    // carries them. Five separate globals meant the host and the export had to
    // agree on five names, and a sixth setting simply never got a global.
    `window.__GAME_RUNTIME__=${JSON.stringify(packagedRuntimeFields(opts.runtime ?? DEFAULT_RUNTIME_CONFIG))};`;
  const adProfile = opts.adProfile ?? genericPlayableProfile;
  const network = playableAdInjection(adProfile, { title, orientation });
  const outFile = path.join(absOut, 'index.html');
  await writeFile(outFile, indexHtml(title, globals, bundle, network));
  await rm(cookDir, { recursive: true, force: true });

  const htmlBytes = (await stat(outFile)).size;

  // A network that uploads an archive gets one, with index.html at the root. The HTML
  // stays beside it: it is what "Preview over http" serves, and what a developer opens
  // to look at the thing.
  let zipFile: string | undefined;
  let bytes = htmlBytes;
  if (adProfile.delivery === 'zip') {
    progress({ phase: 'Archiving' });
    zipFile = path.join(absOut, 'playable.zip');
    await writeFile(zipFile, makeZip([{ name: 'index.html', data: await readFile(outFile) }]));
    // The archive is the file being sent, so it is the one the limit applies to.
    bytes = (await stat(zipFile)).size;
  }

  // A full WASM engine + assets routinely exceeds what a network accepts, and this
  // export used to say so in an English sentence it composed itself. It no longer
  // does: `exportGame` weighs EVERY target against the limits in force and reports
  // the verdict structurally (the network's cap arrives there as a `SizeBudget`),
  // so the build dialog writes that sentence once, in the editor's language, for
  // the playable and the 4MB WeChat main package alike.
  if (adProfile.deliveryNote) warnings.push(adProfile.deliveryNote);

  return {
    ok: errors.length === 0, platform: 'playable', outDir: absOut,
    included: cook.included.length, bytes, htmlBytes, zipFile, warnings, errors,
  };
}
