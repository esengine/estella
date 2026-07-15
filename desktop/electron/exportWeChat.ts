// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  WeChat MiniGame export (REARCH_EXPORT E2). Assembles a project into the
 *        exact shape the SHIPPED runtime `initWeChatRuntime` consumes — it's
 *        correct-by-construction against that contract (this sandbox has no WeChat
 *        devtools, so runtime correctness is validated by the user in devtools):
 *
 *          asset-manifest.json  AddressableManifest (groups.<g>.assets[uuid] = {path,…});
 *                               the WeChat path resolver keys by uuid → path.
 *          scenes/<name>.json   the entry scene with @uuid: refs STRIPPED to bare
 *                               uuids (the resolver looks up bare uuids, not @uuid:).
 *          game-bundle.js       esbuild CJS of [wechat SDK (esengine aliased to the
 *                               wechat build) + project scripts + a boot()] — one
 *                               esengine instance so custom components/systems run.
 *          game.js              the MiniGame entry: require the wasm factory + boot.
 *          wasm/                the -t wechat engine runtime (WXWebAssembly glue).
 *          game.json / project.config.json   MiniGame config.
 *
 *        Unlike web/desktop (which share the import-map web payload), WeChat has no
 *        import maps and a different module/asset model, so this is its own path.
 *        Pure Node (esbuild + fs) — IPC wiring is in main.ts.
 */
import { loadEsbuild } from './esbuildRuntime';
import { writeFile, mkdir, cp, readFile, rename, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from './cookAssets';
import type { ExportScene } from './exportGame';
import type { OnExportProgress } from './exportProgress';
import { esengineAlias } from './esengineResolve';
import {
  sceneUsesPhysics, detectSpineVersion, detectSpineVersionJson,
  spineModuleId, SIDE_MODULE_FILE, WECHAT_MODULE_BUILD_TARGET,
} from './sideModuleScan';

export interface ExportWeChatResult {
  ok: boolean;
  platform: 'wechat';
  outDir: string;
  included: number;
  warnings: string[];
  errors: string[];
}

interface CookManifest {
  entries: {
    uuid: string; path: string; sourcePath?: string; type: string;
    contentHash?: string; size?: number; group?: string;
    atlas?: { page: number; frame: { x: number; y: number; width: number; height: number }; pageWidth: number; pageHeight: number };
  }[];
}

// Editor asset type → AddressableAssetType (sdk/src/assetTypes.ts). The WeChat
// path resolver ignores type (keys by uuid → path); this only feeds the Catalog,
// so an unmapped type degrading to 'binary' is harmless.
const ADDRESSABLE_TYPE: Record<string, string> = {
  texture: 'texture', material: 'material', audio: 'audio', 'bitmap-font': 'bitmap-font',
  prefab: 'prefab', spine: 'spine',
  scene: 'json', 'anim-clip': 'json', tilemap: 'json', timeline: 'json', json: 'json', shader: 'text',
};
const addrType = (editorType: string): string => ADDRESSABLE_TYPE[editorType] ?? 'binary';

const UUID_PREFIX = '@uuid:';

/** Strip @uuid: asset refs to the bare (lowercased) uuid the WeChat resolver keys
 *  by. Deep, value-only — any string starting with @uuid: is a ref. */
function stripUuidRefs(v: unknown): unknown {
  if (typeof v === 'string') return v.startsWith(UUID_PREFIX) ? v.slice(UUID_PREFIX.length).toLowerCase() : v;
  if (Array.isArray(v)) return v.map(stripUuidRefs);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) o[k] = stripUuidRefs((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

function gameJson(
  orientation: 'portrait' | 'landscape',
  subPackages: ReadonlyArray<{ name: string; root: string }>,
): string {
  const cfg: Record<string, unknown> = { deviceOrientation: orientation, showStatusBar: false };
  // WeChat 分包: each lazy group is a subpackage rooted at subpackages/<name>/.
  // The game calls Assets.loadGroup(name) → wx.loadSubpackage at runtime.
  if (subPackages.length > 0) cfg.subPackages = subPackages.map((s) => ({ name: s.name, root: s.root }));
  return JSON.stringify(cfg, null, 2) + '\n';
}

/** Distinct lazy subpackage groups present in the cook, as WeChat subPackage roots. */
function subPackagesOf(entries: CookManifest['entries']): Array<{ name: string; root: string }> {
  const names = new Set<string>();
  for (const e of entries) if (e.group && e.group !== 'main') names.add(e.group);
  return [...names].map((name) => ({ name, root: `subpackages/${name}` }));
}

// Extensions WeChat's packer/fs handles without a packOptions.include entry:
// script + config it compiles itself. Every OTHER staged extension gets an
// include rule — WeChat denies fs reads of unlisted custom types (the .skel/
// .atlas/.ktx2 family), and a redundant rule for a native type is harmless.
const WECHAT_NATIVE_SUFFIXES = new Set(['.js', '.json']);

/** packOptions.include suffix rules for every custom extension the cook staged. */
function packIncludeSuffixes(entries: CookManifest['entries']): string[] {
  const suffixes = new Set<string>();
  for (const e of entries) {
    const ext = path.extname(e.path).toLowerCase();
    if (ext && !WECHAT_NATIVE_SUFFIXES.has(ext)) suffixes.add(ext);
  }
  return [...suffixes].sort();
}

function projectConfigJson(title: string, appid: string, includeSuffixes: string[]): string {
  return JSON.stringify({
    miniprogramRoot: './',
    projectname: title,
    appid, // set in Project Settings → Packaging → WeChat (else fill in devtools)
    // bigPackageSizeSupport: devtools preview of a >4MB main package (upload
    // still enforces the limit — move heavy content to subpackages/ to ship).
    setting: { es6: false, minified: false, bigPackageSizeSupport: true },
    compileType: 'game',
    ...(includeSuffixes.length > 0
      ? { packOptions: { include: includeSuffixes.map((value) => ({ type: 'suffix', value })) } }
      : {}),
  }, null, 2) + '\n';
}

/** The MiniGame entry WeChat runs: require the engine + the scene's optional
 *  side modules (physics/spine), hand them to the bundle's boot(). WeChat has no
 *  fetch/import — modules are pulled in by `require` here (outside the bundle). */
function gameEntryJs(sideModules: ReadonlyArray<{ id: string; file: string }>, engineGlueFile: string): string {
  const requires = sideModules
    .map((m) => `  ${JSON.stringify(m.id)}: asFactory(require('./wasm/${m.file}.js')),`)
    .join('\n');
  return `'use strict';
// Generated by Estella exportGame (WeChat MiniGame entry).
const asFactory = (m) => (typeof m === 'function' ? m : (m && m.default) || m);
const engineFactory = asFactory(require('./wasm/${engineGlueFile}'));
const sideModuleFactories = {
${requires}
};
const bundle = require('./game-bundle.js');
bundle.boot(engineFactory, sideModuleFactories);
`;
}

/** The export-time mirror of the runtime's physics/spine self-gating: which
 *  optional modules ANY shipped scene needs (a dynamically switched scene must
 *  find its modules present). A needed module absent from the wechat wasm dir
 *  is a HARD error — the package would otherwise ship silently broken (same
 *  contract as the playable exporter's collectSideModules). */
async function scanWeChatSideModules(
  sceneDatas: unknown[],
  cookEntries: CookManifest['entries'],
  absOut: string,
  wasmDir: string,
  errors: string[],
): Promise<Array<{ id: string; file: string }>> {
  const ids = new Set<string>();
  if (sceneDatas.some((s) => s && sceneUsesPhysics(s as Parameters<typeof sceneUsesPhysics>[0]))) ids.add('physics');
  // Spine: the skeleton carries the version. Skeleton + atlas share the authored
  // meta type `spine`, so discriminate by extension — `.skel` is a binary
  // skeleton, `.json` a JSON one; the `.atlas` sibling is not a skeleton.
  for (const e of cookEntries) {
    // Any staged KTX2 texture (compressTextures cook, or an authored .ktx2 —
    // staged as .ktx2.bin for the WeChat suffix whitelist) needs the Basis
    // transcoder at runtime. Mirrors sdk isKtx2Path.
    if (/\.ktx2(\.bin)?$/.test(e.path.toLowerCase())) ids.add('basis');
    if (e.type !== 'spine') continue;
    const ext = path.extname(e.sourcePath ?? e.path).toLowerCase();
    try {
      let v: ReturnType<typeof detectSpineVersionJson> = null;
      if (ext === '.skel') {
        v = detectSpineVersion(new Uint8Array(await readFile(path.join(absOut, e.path))));
      } else if (ext === '.json') {
        v = detectSpineVersionJson(await readFile(path.join(absOut, e.path), 'utf8'));
      }
      if (v) ids.add(spineModuleId(v));
    } catch { /* unreadable cook entry — cookAssets already warned; skip */ }
  }
  const present: Array<{ id: string; file: string }> = [];
  for (const id of ids) {
    const file = SIDE_MODULE_FILE[id];
    if (file && existsSync(path.join(wasmDir, `${file}.js`))) present.push({ id, file });
    else errors.push(`scene needs "${id}" but ${file}.js is not in the wechat wasm dir — build it with \`node build-tools/cli.js build -t ${WECHAT_MODULE_BUILD_TARGET[id] ?? id}\` and re-export.`);
  }
  return present;
}

/** Read the web cook's flat manifest → AddressableManifest the WeChat runtime reads.
 *  Carries the cook's `contentHash` (XXH64) + `size` through so the runtime can
 *  dedupe by content and treat `<hash>.<ext>` as a permanently-cacheable CDN URL;
 *  falls back to stat() for size only if a legacy cook omitted it. */
async function buildAddressableManifest(absOut: string): Promise<string> {
  const cook = JSON.parse(await readFile(path.join(absOut, 'assets.manifest.json'), 'utf8')) as CookManifest;
  type Entry = {
    path: string; address?: string; type: string; size: number; labels: string[]; contentHash?: string;
    metadata?: { atlasPage?: number; atlasFrame?: { x: number; y: number; width: number; height: number }; atlasPageWidth?: number; atlasPageHeight?: number };
  };
  type Group = { bundleMode: string; labels: string[]; assets: Record<string, Entry> };
  // One group per cook group: 'main' is local (eager); every other is a lazy
  // subpackage. bundleMode here is the typed wire value the SDK's normalizeBundleMode
  // reads ('local' | 'lazy').
  const groups: Record<string, Group> = {};
  for (const e of cook.entries) {
    let size = e.size ?? 0;
    if (e.size == null) { try { size = (await stat(path.join(absOut, e.path))).size; } catch { /* missing file → 0 */ } }
    const groupName = e.group ?? 'main';
    const group = (groups[groupName] ??= {
      bundleMode: groupName === 'main' ? 'local' : 'lazy', labels: [], assets: {},
    });
    const entry: Entry = { path: e.path, type: addrType(e.type), size, labels: [] };
    if (e.contentHash) entry.contentHash = e.contentHash;
    // The logical source path rides as the asset's address: path-style refs
    // resolve through it (ManifestModel indexes addresses; the runtime builds
    // its logical→staged catalog from them). Only meaningful when staging
    // renamed the file (content addressing / texture encoding).
    if (e.sourcePath && e.sourcePath !== e.path) entry.address = e.sourcePath;
    // Atlas frame → manifest metadata; the runtime derives uv from it and
    // registers the frame under its uuid/address catalog keys.
    if (e.atlas) {
      entry.metadata = {
        atlasPage: e.atlas.page,
        atlasFrame: e.atlas.frame,
        atlasPageWidth: e.atlas.pageWidth,
        atlasPageHeight: e.atlas.pageHeight,
      };
    }
    group.assets[e.uuid.toLowerCase()] = entry;
  }
  // Always emit a main group so the runtime's main package exists even if every
  // asset happened to land in a subpackage.
  groups.main ??= { bundleMode: 'local', labels: [], assets: {} };
  return JSON.stringify({ version: '2.0', groups }, null, 2) + '\n';
}

/**
 * Export the open project as a WeChat MiniGame into `outDir`. `sdkDir` is the SDK
 * dist dir the bundle aliases `esengine` to (the wechat build, index.wechat.js);
 * `wasmDir` the -t wechat engine runtime to copy.
 */
export async function exportWeChat(opts: {
  root: string;
  entryScene: string;
  /** Every switchable scene to ship (name + project-relative path, entry
   *  included) — discovered by exportGame. Absent: the entry scene only. */
  scenes?: ExportScene[];
  scriptsEntry?: string;
  sdkDir: string;
  wasmDir: string;
  outDir: string;
  title?: string;
  /** WeChat MiniGame appid (Project Settings) → project.config.json. */
  appid?: string;
  /** Screen orientation (Project Settings) → game.json. */
  orientation?: 'portrait' | 'landscape';
  /** Bitmask of render layers (0..31) that y-sort (Project Settings → Rendering). */
  ySortLayers?: number;
  /** Project color space — 'linear' boots the mini-game on the linear-light pipeline. */
  colorSpace?: 'gamma' | 'linear';
  minify?: boolean;
  /** Emit content-addressed asset filenames (<hash><ext>) for dedup + immutable caching. */
  contentAddressed?: boolean;
  /** Encode raster textures to GPU-compressed KTX2 at cook time. */
  compressTextures?: boolean;
  compressAudio?: boolean;
  /** Pack `<name>.atlas/` folder PNGs into atlas pages at cook time. */
  atlasTextures?: boolean;
  onProgress?: OnExportProgress;
}): Promise<ExportWeChatResult> {
  const title = opts.title ?? 'Game';
  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  const progress = opts.onProgress ?? (() => {});
  const warnings: string[] = [];
  const errors: string[] = [];

  // 0. The generated entry unconditionally requires the engine glue, so a
  //    missing wechat runtime cannot produce a runnable package — fail before
  //    cooking. Require by its ACTUAL name in the wasm dir (the -t wechat
  //    build emits esengine.wxgame.js; a web-aligned build, esengine.js).
  const engineGlueFile = ['esengine.wxgame.js', 'esengine.js']
    .find((f) => existsSync(path.join(opts.wasmDir, f)));
  if (!engineGlueFile) {
    errors.push(
      `wechat engine runtime not found in ${opts.wasmDir} — ` +
      'build it with `node build-tools/cli.js build -t wechat` ' +
      '(add -t physics-wechat / -t spine-wechat if the project uses physics or Spine)',
    );
    return { ok: false, platform: 'wechat', outDir: absOut, included: 0, warnings, errors };
  }

  await mkdir(absOut, { recursive: true });

  // Every switchable scene ships; the exporter's caller (exportGame) discovers
  // them from the project's scenes dir. Absent (tests / direct calls): entry only.
  const scenes: ExportScene[] = opts.scenes ?? [
    { name: path.basename(opts.entryScene).replace(/\.[^.]+$/, ''), path: opts.entryScene.replace(/\\/g, '/') },
  ];
  const sceneName = scenes.find((s) => s.path === opts.entryScene.replace(/\\/g, '/'))?.name ?? scenes[0].name;

  // 1. Cook reachable assets from every scene root (paths preserved) + the flat
  //    manifest. KTX2 textures are fine here: the scan below sees the staged
  //    .ktx2 files and ships the Basis transcoder side module with them.
  progress({ phase: 'Cooking assets' });
  const cook = await cookAssets(opts.root, { entryScenes: scenes.map((s) => s.path), outDir: absOut, contentAddressed: opts.contentAddressed, compressTextures: opts.compressTextures, compressAudio: opts.compressAudio, atlasTextures: opts.atlasTextures });
  warnings.push(...cook.warnings);

  // 1a. Restage for WeChat's code-package suffix whitelist (it has no `ktx2`
  //     or `esscene`; the packer drops such files and fs reads are denied
  //     regardless of packOptions):
  //       *.ktx2                → *.ktx2.bin (whitelisted; isKtx2Path accepts both)
  //       assets/…/<x>.esscene  → scenes/<name>.json, @uuid: refs stripped to the
  //                               bare uuids the WeChat resolver keys by; the
  //                               manifest entry follows, so scene refs resolve
  //                               to the readable file.
  progress({ phase: 'Transforming scenes' });
  const flatManifestPath = path.join(absOut, 'assets.manifest.json');
  let cookEntries: CookManifest['entries'] = [];
  const sceneRawByName = new Map<string, unknown>();
  try {
    const flat = JSON.parse(await readFile(flatManifestPath, 'utf8')) as CookManifest;
    for (const e of flat.entries) {
      if (e.path.toLowerCase().endsWith('.ktx2')) {
        await rename(path.join(absOut, e.path), path.join(absOut, `${e.path}.bin`));
        e.path = `${e.path}.bin`;
        continue;
      }
      const scene = scenes.find((s) => s.path === e.path);
      if (scene) {
        const staged = path.join(absOut, e.path);
        const raw = JSON.parse(await readFile(staged, 'utf8'));
        sceneRawByName.set(scene.name, raw);
        const outPath = `scenes/${scene.name}.json`;
        await mkdir(path.dirname(path.join(absOut, outPath)), { recursive: true });
        await writeFile(path.join(absOut, outPath), JSON.stringify(stripUuidRefs(raw)) + '\n');
        await rm(staged, { force: true });
        e.path = outPath;
      }
    }
    await writeFile(flatManifestPath, JSON.stringify(flat, null, 2));
    cookEntries = flat.entries;
  } catch (err) {
    errors.push(`scene transform: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1b. Scan every scene for the optional modules it needs (physics/spine), so
  //     the generated entry requires exactly those — the export-time half of
  //     the runtime's self-gating. A dynamically switched scene must find its
  //     modules present, so the union over ALL shipped scenes counts.
  const sideModules = await scanWeChatSideModules([...sceneRawByName.values()], cookEntries, absOut, opts.wasmDir, errors);
  const sceneRaw = sceneRawByName.get(sceneName) ?? null;
  if (!sceneRaw) errors.push(`entry scene "${opts.entryScene}" was not staged by the cook`);

  // 2. Flat manifest → AddressableManifest (asset-manifest.json); drop the web one.
  progress({ phase: 'Building manifest' });
  try {
    await writeFile(path.join(absOut, 'asset-manifest.json'), await buildAddressableManifest(absOut));
    await rm(path.join(absOut, 'assets.manifest.json'), { force: true });
  } catch (err) {
    errors.push(`manifest: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. game-bundle.js — wechat SDK (esengine aliased) + project scripts + boot(),
  //    one esengine instance so the project's defineComponent/defineSystem run.
  const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
  // The engine wasm path rides into the boot config: only the exporter knows
  // which glue it staged (esengine.wxgame vs the web-aligned esengine), and the
  // runtime must instantiate the staged glue's .wasm twin, not guess a name.
  const engineWasmPath = `wasm/${engineGlueFile.replace(/\.js$/, '.wasm')}`;
  const entrySrc =
    `import { initWeChatRuntime } from 'esengine';\n` +
    (scriptsAbs && existsSync(scriptsAbs) ? `import ${JSON.stringify(scriptsAbs)};\n` : '') +
    `export function boot(engineFactory, sideModuleFactories) {\n` +
    `  return initWeChatRuntime({ engineFactory, engineWasmPath: ${JSON.stringify(engineWasmPath)}, sideModuleFactories, sceneNames: ${JSON.stringify(scenes.map((s) => s.name))}, firstScene: ${JSON.stringify(sceneName)}${opts.ySortLayers ? `, ySortLayers: ${opts.ySortLayers >>> 0}` : ''}${opts.colorSpace === 'linear' ? `, colorSpace: 'linear'` : ''} });\n` +
    `}\n`;
  progress({ phase: 'Bundling game' });
  try {
    const { build } = await loadEsbuild();
    const res = await build({
      stdin: { contents: entrySrc, resolveDir: opts.root, loader: 'js', sourcefile: 'wechat-entry.js' },
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      // Real-device WeChat rejects es2020 syntax (`??`, `?.`) even though the
      // devtools accepts it; es2017 down-levels those while keeping async/await.
      target: 'es2017',
      alias: esengineAlias(opts.sdkDir, 'index.wechat.js'),
      minify: opts.minify ?? false,
      sourcemap: false,
      outfile: path.join(absOut, 'game-bundle.js'),
      logLevel: 'silent',
      write: true,
    });
    errors.push(...res.errors.map((e) => e.text));
  } catch (err) {
    const e = err as { errors?: { text: string }[]; message?: string };
    errors.push(...(e.errors?.map((x) => x.text) ?? [String(e.message ?? err)]));
  }

  // 5. Entry + config.
  await writeFile(path.join(absOut, 'game.js'), gameEntryJs(sideModules, engineGlueFile));
  await writeFile(path.join(absOut, 'game.json'), gameJson(opts.orientation ?? 'portrait', subPackagesOf(cookEntries)));
  await writeFile(path.join(absOut, 'project.config.json'), projectConfigJson(title, opts.appid ?? '', packIncludeSuffixes(cookEntries)));

  // 6. The engine runtime + exactly the side modules the scene needs. WeChat's
  //    main package has a 4MB budget — unneeded side modules must not ride along.
  progress({ phase: 'Copying runtime' });
  const wasmOut = path.join(absOut, 'wasm');
  await mkdir(wasmOut, { recursive: true });
  const runtimeFiles = [
    engineGlueFile,
    engineGlueFile.replace(/\.js$/, '.wasm'),
    ...sideModules.flatMap((m) => [`${m.file}.js`, `${m.file}.wasm`]),
  ];
  const { transform } = await loadEsbuild();
  for (const f of runtimeFiles) {
    const src = path.join(opts.wasmDir, f);
    if (!existsSync(src)) {
      errors.push(`wechat runtime file missing: ${f} (in ${opts.wasmDir}) — rebuild with \`node build-tools/cli.js build -t wechat\``);
      continue;
    }
    const dest = path.join(wasmOut, f);
    if (f.endsWith('.js')) {
      // Emscripten glue can carry es2020 syntax (`?.`, `??`) that real-device
      // WeChat rejects — down-level it like the game bundle.
      const out = await transform(await readFile(src, 'utf8'), { target: 'es2017', loader: 'js' });
      await writeFile(dest, out.code);
    } else {
      await cp(src, dest);
    }
  }

  return { ok: errors.length === 0, platform: 'wechat', outDir: absOut, included: cook.included.length, warnings, errors };
}
