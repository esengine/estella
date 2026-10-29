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
 *          - the playable host + esengine + project scripts esbuilt to ONE IIFE,
 *            deflated like the engine's own payloads and started by a small loader
 *            script — it is the page's largest span, and a 5MB cap is spent on it;
 *          - whatever the chosen ad network's profile injects (playableAdProfile.ts).
 *        Boots the SAME shipping runtime via initPlayableRuntime (play == ship).
 *
 *        Correct-by-construction against initPlayableRuntime (no playable simulator
 *        here — runtime is validated in a browser / ad preview). Pure Node (esbuild
 *        + fs); IPC wiring in main.ts.
 */
import { loadEsbuild } from '../bundle/esbuildRuntime';
import { runtimeHostEntry } from '../bundle/runtimeHosts';
import {
  DEFAULT_RUNTIME_CONFIG, packagedRuntimeFields, withAudioLoadTypes, type RuntimeProjectConfig,
} from '../project/runtimeConfig';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { cookAssets } from '../assets/cookAssets';
import { scanAssetDatabase } from '../assets/assetDb';
import { optimizePlayableAssets, playableAssetsJsonBytes, type PlayableOptimizationAsset, type PlayablePayload } from './playableOptimization';
import type { OnExportProgress } from './exportProgress';
import { esengineAlias } from '../bundle/esengineResolve';
import { officialPackagesPlugin } from '../bundle/officialPackages';
import { cocosCompatPlugin } from '../bundle/cocosCompat';
import { explainBundleErrors, type BundleMessage } from '../bundle/bundleDiagnostics';
import type { ScreenOrientation } from './orientationHtml';
import { genericPlayableProfile, playableAdInjection, isPlayableZipFileName, type PlayableAdProfile } from './playableAdProfile';
import { checkPlayable, type PlayableCheckReport } from './playableCheck';
import { makeZip } from '../../../build-tools/utils/zip.js';
import { scanSideModuleIds, sideModuleFiles } from '../bundle/sideModuleScan';
import { forcedSideModules, moduleChoices } from '../bundle/engineInstalls';
import type { ProjectFeatures, ProjectPackaging } from '../project/format';

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
  /**
   * What the single file is MADE OF, each span under the path those bytes would
   * carry if this target shipped them loose. Sums to {@link htmlBytes}.
   *
   * Without it the size report can only say the build is one `index.html` of
   * n bytes — true, and useless on the one target where size is a hard cap.
   */
  inlineParts: { path: string; bytes: number }[];
  playableCheck?: PlayableCheckReport;
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
 * A binary payload on its way into an HTML file: deflated, then base64.
 *
 * Deflating first beats any denser encoding — the engine module is 2.056MB
 * encoded raw, 0.597MB this way. `n` is the length before deflating, so the
 * decoder allocates once and catches a short stream.
 */
interface PackedBytes {
  /** base64 of the raw-deflated bytes. */
  z: string;
  /** Length before deflating. */
  n: number;
}

function pack(bytes: Uint8Array | Buffer): PackedBytes {
  return { z: deflateRawSync(bytes, { level: 9 }).toString('base64'), n: bytes.length };
}

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
  loader: string,
  network: { head: string; body: string; bridge: string },
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
    <canvas id="canvas"></canvas>${network.body ? `\n    ${network.body}` : ''}${network.bridge ? `\n    <script>${inlineSafe(network.bridge)}</script>` : ''}
    <script>${inlineSafe(globals)}</script>
    <script>${inlineSafe(loader)}</script>
  </body>
</html>
`;
}

/**
 * Inline the glue+wasm of exactly the modules the shipped content can ask for
 * (single-file, no fetch). A needed module absent from `wasmDir` is pushed as a
 * HARD error — the playable would otherwise ship silently broken.
 */
async function collectSideModules(
  root: string,
  includedPaths: readonly string[],
  manifestEntries: CookManifest['entries'],
  cookDir: string,
  wasmDir: string,
  errors: string[],
  forced: readonly string[],
): Promise<Record<string, { glue: PackedBytes; wasm: PackedBytes }>> {
  const ids = await scanSideModuleIds({
    root, includedPaths, cookEntries: manifestEntries, stagedDir: cookDir, forced,
  });
  const { files, unknown } = sideModuleFiles(ids);
  for (const id of unknown) errors.push(`internal: no artifact mapping for side module "${id}"`);

  const registry: Record<string, { glue: PackedBytes; wasm: PackedBytes }> = {};
  for (const { id, file } of files) {
    const gluePath = path.join(wasmDir, `${file}.js`);
    const wasmPath = path.join(wasmDir, `${file}.wasm`);
    if (!existsSync(gluePath) || !existsSync(wasmPath)) {
      errors.push(`scene needs "${id}" but ${file}.js/${file}.wasm are missing from the wasm dir — build the module and re-export.`);
      continue;
    }
    registry[id] = {
      glue: pack(await readFile(gluePath)),
      wasm: pack(await readFile(wasmPath)),
    };
  }
  return registry;
}

/**
 * Export the open project as a single-file playable ad. Reuses the shipped WEB
 * engine runtime (esengine.js glue + esengine.wasm) inlined — no separate
 * SINGLE_FILE build. `hostsDir` holds the runtime hosts; `wasmDir` the web wasm dir.
 */
/** The packaged fields minus what a playable's host cannot serve. */
function playableRuntimeFields(rc: Parameters<typeof packagedRuntimeFields>[0]) {
    const { renderBackend: _glOnly, ...rest } = packagedRuntimeFields(rc);
    return rest;
}

export async function exportPlayable(opts: {
  root: string;
  entryScene: string;
  scriptsEntry?: string;
  hostsDir: string;
  /** The official `estella-plugin-*` packages the editor ships (`plugins/`);
   *  a project's scripts resolve them from here. */
  packagesDir: string;
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
  /**
   * Defaults to ON here, unlike every other target: a playable is uploaded
   * under a hard byte cap and has no dev build, and unminified spent 0.31MB of
   * a 5MB budget on whitespace. A no-op on what it draws (measured: identical
   * to the pixel). An explicit `false` is still honoured.
   */
  minify?: boolean;
  /** Honor authored PNG Max Size; playables still ship images rather than KTX2. */
  resizeTextures?: boolean;
  /** WAV to MP3 at the authored bitrate, honoring each clip's compression opt-out. */
  compressAudio?: boolean;
  /** Project delivery budget, constrained by the network limit and 3 MiB regression target. */
  sizeBudgetBytes?: number;
  /** What the project says about its engine modules; see ProjectFeatures.modules. */
  features?: ProjectFeatures;
  /** Per-target overrides laid over those. */
  modulesByPlatform?: ProjectPackaging['modulesByPlatform'];
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
  // What each span costs, under the path those bytes would carry shipped loose,
  // so a playable composes in the same vocabulary as web and WeChat. Filled
  // where the bytes are JOINED — reading the finished HTML back would drift.
  const spans: { path: string; bytes: number }[] = [];

  // 1. Cook reachable assets to a temp dir (everything ends up inlined → removed after).
  progress({ phase: 'Cooking assets' });
  // No KTX2 transcoder: PNGs honor Max Size through the raw-image path. Audio
  // uses the same per-clip settings as other targets. Neither changes sources.
  const cook = await cookAssets(opts.root, {
    entryScenes: [opts.entryScene], outDir: cookDir, platform: 'playable',
    resizeTextures: opts.resizeTextures, compressAudio: opts.compressAudio,
  });
  warnings.push(...cook.warnings);
  errors.push(...cook.failed.map(failure => `assets: ${failure}`));

  // 2. Assets → base64 data URLs, keyed by the scene's @uuid: refs; plus a
  //    compact logical-path → key map so PATH-style refs (a scene's material
  //    path, a material's rewritten logical refs) resolve to the same inlined
  //    data — the runtime aliases them in memory, so the payload carries each
  //    data URL exactly once.
  progress({ phase: 'Encoding assets' });
  const pathMap: Record<string, string> = {};
  const optimizationAssets: PlayableOptimizationAsset[] = [];
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
      const dataUrl = `data:${mimeOf(e.path)};base64,${buf.toString('base64')}`;
      pathMap[e.sourcePath ?? e.path] = key;
      // The data URL, not the file: base64 is what the asset costs the package.
      spans.push({ path: e.path, bytes: dataUrl.length });
      optimizationAssets.push({ key, path: e.sourcePath ?? e.path, data: buf, mime: mimeOf(e.path) });
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
    `import ${JSON.stringify(runtimeHostEntry(opts.hostsDir, 'playableHost'))};\n`;
  let bundle = '';
  let loader = '';
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
      plugins: [officialPackagesPlugin(opts.packagesDir), cocosCompatPlugin()],
      minify: opts.minify ?? true,
      write: false,
      outfile: 'game-bundle.js',
      logLevel: 'silent',
    });
    errors.push(...explainBundleErrors(res.errors));
    bundle = res.outputFiles?.[0]?.text ?? '';
    // Built apart from the game, because it is the one script the page can still
    // read: a loader inside the payload it inflates could never start it.
    const loaded = await build({
      entryPoints: [runtimeHostEntry(opts.hostsDir, 'playableLoader')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: opts.minify ?? true,
      write: false,
      outfile: 'game-loader.js',
      logLevel: 'silent',
    });
    errors.push(...explainBundleErrors(loaded.errors));
    loader = loaded.outputFiles?.[0]?.text ?? '';
  } catch (err) {
    const e = err as { errors?: BundleMessage[]; message?: string };
    errors.push(...(e.errors ? explainBundleErrors(e.errors) : [String(e.message ?? err)]));
  }

  // 5. Engine runtime: reuse the shipped WEB build (esengine.js glue + esengine.wasm),
  //    inlined — the host loads the glue via a blob module + feeds the wasm (base64)
  //    through instantiateWasm. No separate single-file build needed.
  progress({ phase: 'Inlining engine' });
  let glue: PackedBytes = { z: '', n: 0 };
  let wasm: PackedBytes = { z: '', n: 0 };
  const gluePath = path.join(opts.wasmDir, 'esengine.js');
  const wasmPath = path.join(opts.wasmDir, 'esengine.wasm');
  if (existsSync(gluePath) && existsSync(wasmPath)) {
    glue = pack(await readFile(gluePath));
    wasm = pack(await readFile(wasmPath));
  } else {
    errors.push(`engine runtime not found in ${opts.wasmDir} (need esengine.js + esengine.wasm)`);
  }

  // 5b. Side modules (physics / spine): run the runtime's gating scan, then inline
  //     exactly the modules the content needs (playables are single-file + size-capped).
  //     A needed module missing from wasmDir is a HARD error — better a failed
  //     export than a playable that silently ships without physics.
  progress({ phase: 'Embedding modules' });
  const sideModules = await collectSideModules(
    opts.root, cook.includedPaths, manifestEntries, cookDir, opts.wasmDir, errors,
    forcedSideModules(moduleChoices(opts.features, opts.modulesByPlatform?.playable)),
  );

  // 6. Assemble once for each measured candidate, with fixed engine/script spans.
  progress({ phase: 'Assembling HTML' });
  const span = (p: string, text: string): string => {
    spans.push({ path: p, bytes: Buffer.byteLength(text, 'utf8') });
    return text;
  };
  const beforeAssets =
    span('wasm/esengine.js', `window.__ENGINE_GLUE__=${JSON.stringify(glue)};`) +
    span('wasm/esengine.wasm', `window.__ENGINE_WASM__=${JSON.stringify(wasm)};`) +
    span('wasm/side-modules', `window.__SIDE_MODULES__=${JSON.stringify(sideModules)};`);
  const afterAssets =
    `window.__GAME_PATHMAP__=${JSON.stringify(pathMap)};` +
    span(`scenes/${sceneName}.json`, `window.__GAME_SCENES__=${JSON.stringify(scenes)};`) +
    `window.__GAME_FIRST__=${JSON.stringify(sceneName)};` +
    `window.__GAME_RUNTIME__=${JSON.stringify(playableRuntimeFields(withAudioLoadTypes(opts.runtime ?? DEFAULT_RUNTIME_CONFIG, cook.audioLoadTypes)))};` +
    span('game-bundle.js', `window.__GAME_BUNDLE__=${JSON.stringify(pack(Buffer.from(bundle, 'utf8')))};`);
  const adProfile = opts.adProfile ?? genericPlayableProfile;
  const network = playableAdInjection(adProfile, { title, orientation });
  const outFile = path.join(absOut, 'index.html');
  span('game-loader.js', loader);
  let zipFile: string | undefined;
  const archiveFiles: { name: string; content: string }[] = [];
  if (adProfile.delivery === 'zip') {
    const zipName = adProfile.zipFileName ?? 'playable.zip';
    if (!isPlayableZipFileName(zipName)) errors.push('Playable ZIP filename must be a portable name ending in .zip, without directories.');
    else {
      zipFile = path.join(absOut, zipName);
      const names = new Set(['index.html']);
      for (const file of adProfile.emitZipFiles?.({ title, orientation }) ?? []) {
        const name = typeof file?.name === 'string' ? file.name.toLowerCase() : '';
        if (!name || !/^[a-z0-9_]+\.[a-z0-9]+$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./.test(name) || names.has(name) || typeof file.content !== 'string') {
          errors.push('Playable ZIP extra files need unique portable root filenames and text content.');
          continue;
        }
        names.add(name);
        archiveFiles.push({ name: file.name, content: file.content });
      }
    }
  }
  const assemble = (payloads: ReadonlyMap<string, PlayablePayload>) => {
    const urls: Record<string, string> = {};
    for (const [key, value] of payloads) urls[key] = `data:${value.mime};base64,${Buffer.from(value.data).toString('base64')}`;
    const html = Buffer.from(indexHtml(title, beforeAssets + `window.__GAME_ASSETS__=${JSON.stringify(urls)};` + afterAssets, loader, network));
    const delivery = zipFile ? makeZip([{ name: 'index.html', data: html },
      ...archiveFiles.map(file => ({ name: file.name, data: Buffer.from(file.content) }))]) : html;
    return { html, delivery, htmlBytes: html.byteLength, deliveryBytes: delivery.byteLength };
  };
  const emptyHtmlBytes = assemble(new Map()).htmlBytes;
  const targetDeliveryBytes = Math.min(adProfile.maxBytes, opts.sizeBudgetBytes ?? Infinity, 3 * 1024 * 1024);
  const baseline = assemble(new Map(optimizationAssets.map(asset => [asset.key, asset])));
  if (errors.length === 0 && (opts.resizeTextures || opts.compressAudio) &&
    (baseline.deliveryBytes > targetDeliveryBytes || baseline.htmlBytes > (adProfile.maxHtmlBytes ?? Infinity))) {
    progress({ phase: 'Optimizing playable budget' });
    const { index } = await scanAssetDatabase(opts.root, { write: false, adopt: false });
    const byUuid = new Map(index.entries.map(entry => [entry.uuid, entry]));
    const fontPages = new Set(index.entries.filter(entry => entry.path.toLowerCase().endsWith('.fnt'))
      .flatMap(entry => index.deps[entry.uuid] ?? []));
    for (const asset of optimizationAssets) {
      const uuid = asset.key.slice('@uuid:'.length);
      asset.importer = byUuid.get(uuid)?.importer;
      asset.losslessOnly = fontPages.has(uuid);
      if (opts.compressAudio && asset.path.toLowerCase().endsWith('.wav')) {
        asset.sourceWav = await readFile(path.join(opts.root, asset.path));
      }
    }
  }
  const optimized = await optimizePlayableAssets({ root: opts.root, assets: optimizationAssets,
    textures: errors.length === 0 && !!opts.resizeTextures, audio: errors.length === 0 && !!opts.compressAudio,
    targetDeliveryBytes, maxHtmlBytes: adProfile.maxHtmlBytes,
    // A single-file page measures by arithmetic (its size is a fixed part plus the assets' JSON); a zip has to be built to be weighed.
    measure: payloads => zipFile ? assemble(payloads) : (() => { const htmlBytes = emptyHtmlBytes - 2 + playableAssetsJsonBytes(payloads); return { htmlBytes, deliveryBytes: htmlBytes }; })(),
    onStage: (stage, assets) => progress({ phase: 'Optimizing playable budget', detail: `${stage} — up to ${assets} assets` }), warnings });
  optimized.report.mode = opts.resizeTextures || opts.compressAudio ? 'auto' : 'skip';
  const final = assemble(optimized.payloads);
  await writeFile(outFile, final.html);
  if (zipFile) await writeFile(zipFile, final.delivery);
  await rm(cookDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  const htmlBytes = final.htmlBytes, bytes = final.deliveryBytes;
  for (let i = 0; i < optimizationAssets.length; i++) {
    const payload = optimized.payloads.get(optimizationAssets[i].key)!;
    spans[i].bytes = `data:${payload.mime};base64,${Buffer.from(payload.data).toString('base64')}`.length;
  }
  if (!optimized.report.meetsTarget) warnings.push(`Playable optimization target not met: delivery ${bytes}/${targetDeliveryBytes} bytes, HTML ${htmlBytes}/${adProfile.maxHtmlBytes ?? 'unlimited'} bytes. Reduce assets or engine modules; no quality below WebP 80 / MP3 96 kbps is selected.`);
  if (adProfile.maxHtmlBytes !== undefined && htmlBytes > adProfile.maxHtmlBytes) {
    // The file is written and its size is on the screen: whether to slim it or ship it anyway is the developer's call, not a failed build.
    warnings.push(`${adProfile.label}: index.html is ${htmlBytes} bytes, exceeding the uncompressed HTML limit of ${adProfile.maxHtmlBytes} bytes. ${adProfile.limitNote}`);
  }
  const inlined = spans.reduce((n, s) => n + s.bytes, 0);
  spans.push({ path: 'index.html', bytes: Math.max(0, htmlBytes - inlined) });

  // A full WASM engine + assets routinely exceeds what a network accepts, and this
  // export used to say so in an English sentence it composed itself. It no longer
  // does: `exportGame` weighs EVERY target against the limits in force and reports
  // the verdict structurally (the network's cap arrives there as a `SizeBudget`),
  // so the build dialog writes that sentence once, in the editor's language, for
  // the playable and the 4MB WeChat main package alike.
  if (adProfile.deliveryNote) warnings.push(adProfile.deliveryNote);

  const playableCheck = checkPlayable({ profile: adProfile, html: await readFile(outFile), delivery: await readFile(zipFile ?? outFile), archiveFiles });
  playableCheck.optimization = optimized.report;
  return {
    playableCheck,
    ok: errors.length === 0, platform: 'playable', outDir: absOut,
    included: cook.included.length, bytes, htmlBytes, zipFile, inlineParts: spans, warnings, errors,
  };
}
