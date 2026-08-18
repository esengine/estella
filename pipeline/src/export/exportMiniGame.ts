// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Mini-game export pipeline (REARCH_EXPORT E2), shared by every vendor.
 *
 *        Assembles a project into the exact shape the shipped runtime
 *        `initWeChatRuntime` / `initMiniGameRuntime` consumes — correct-by-
 *        construction against that contract (this sandbox has no mini-game
 *        devtools, so runtime correctness is validated by the user in devtools):
 *
 *          asset-manifest.json  AddressableManifest (groups.<g>.assets[uuid] = {path,…});
 *                               the resolver keys by uuid → path.
 *          scenes/<name>.json   the entry scene with @uuid: refs STRIPPED to bare
 *                               uuids (the resolver looks up bare uuids, not @uuid:).
 *          game-bundle.js       esbuild CJS of [the vendor SDK (esengine aliased) +
 *                               project scripts + a boot()] — one esengine instance
 *                               so custom components/systems run.
 *          game.js              the MiniGame entry: require the wasm factory + boot.
 *          wasm/                the vendor engine runtime (WXWebAssembly glue).
 *          game.json / project.config.json   MiniGame config (per profile).
 *
 *        Everything vendor-specific — the config/entry files, the packaging
 *        suffix policy, the SDK entry + glue names, the es-target floor — is a
 *        field/hook on the passed `MiniGameExportProfile`. Adding Douyin is one
 *        profile, not a fork of this file.
 *
 *        Unlike web/desktop (which share the import-map web payload), mini-games
 *        have no import maps and a different module/asset model, so this is its
 *        own path. Pure Node (esbuild + fs) — IPC wiring is in main.ts.
 */
import { loadEsbuild } from '../bundle/esbuildRuntime';
import {
  DEFAULT_RUNTIME_CONFIG, packagedRuntimeFields, type RuntimeProjectConfig,
} from '../project/runtimeConfig';
import { writeFile, mkdir, cp, readFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets } from '../assets/cookAssets';
import { buildAddressableManifest } from '../assets/addressableManifest';
import type { ExportScene } from './exportGame';
import type { OnExportProgress } from './exportProgress';
import { esengineAlias } from '../bundle/esengineResolve';
import { explainBundleErrors, type BundleMessage } from '../bundle/bundleDiagnostics';
import { scanSideModuleIds, sideModuleFiles } from '../bundle/sideModuleScan';
import { OPEN_DATA_DIR } from './miniGameExportProfile';
import { loadProjectModules, sideModuleDeclarations, stageProjectModules } from './projectModules';
import type { MiniGameExportProfile, MiniGameVendor } from './miniGameExportProfile';

export interface ExportMiniGameResult {
  ok: boolean;
  platform: MiniGameVendor;
  outDir: string;
  included: number;
  warnings: string[];
  errors: string[];
}

interface CookManifest {
  entries: {
    uuid: string; path: string; sourcePath?: string; type: string;
    contentHash?: string; size?: number; group?: string; groupMode?: string;
    atlas?: { page: number; frame: { x: number; y: number; width: number; height: number }; pageWidth: number; pageHeight: number };
  }[];
}

const UUID_PREFIX = '@uuid:';

/** Strip @uuid: asset refs to the bare (lowercased) uuid the resolver keys by.
 *  Deep, value-only — any string starting with @uuid: is a ref. */
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

/** Distinct lazy subpackage groups present in the cook, as vendor subPackage roots. */
function subPackagesOf(entries: CookManifest['entries'], subpackageDir: string): Array<{ name: string; root: string }> {
  const names = new Set<string>();
  // Remote (CDN / hot-update) groups are NOT WeChat 分包 — they're fetched from a
  // remote origin, not packed as a subPackage root.
  for (const e of entries) if (e.group && e.group !== 'main' && e.groupMode !== 'remote') names.add(e.group);
  return [...names].map((name) => ({ name, root: `${subpackageDir}/${name}` }));
}

/** packOptions.include suffix rules for every custom extension the cook staged.
 *  Extensions the packer/fs handles without an entry (script + config it compiles
 *  itself) are excluded via `nativeSuffixes`; the rest get an include rule —
 *  mini-game packers deny fs reads of unlisted custom types (.skel/.atlas/.ktx2). */
function packIncludeSuffixes(entries: CookManifest['entries'], nativeSuffixes: ReadonlySet<string>): string[] {
  const suffixes = new Set<string>();
  for (const e of entries) {
    const ext = path.extname(e.path).toLowerCase();
    if (ext && !nativeSuffixes.has(ext)) suffixes.add(ext);
  }
  return [...suffixes].sort();
}

/** A needed module absent from the vendor wasm dir is a HARD error — the package
 *  would otherwise ship silently broken (same contract as the playable
 *  exporter's collectSideModules). */
async function scanSideModules(
  profile: MiniGameExportProfile,
  root: string,
  includedPaths: readonly string[],
  cookEntries: CookManifest['entries'],
  absOut: string,
  wasmDir: string,
  errors: string[],
  physicsEnabled: boolean,
): Promise<Array<{ id: string; file: string }>> {
  const ids = await scanSideModuleIds({
    root, includedPaths, cookEntries, stagedDir: absOut, physicsEnabled,
  });
  const { files, unknown } = sideModuleFiles(ids);
  for (const id of unknown) errors.push(`internal: no artifact mapping for side module "${id}"`);

  const present: Array<{ id: string; file: string }> = [];
  for (const { id, file } of files) {
    if (existsSync(path.join(wasmDir, `${file}.js`))) { present.push({ id, file }); continue; }
    const target = profile.sideModuleBuildTargets[id];
    // No target means the vendor has no build of this module at all, and naming
    // one that does not exist sends the reader to build the web artifact instead.
    errors.push(target
      ? `content needs "${id}" but ${file}.js is not in the ${profile.id} wasm dir — build it with \`node build-tools/cli.js build -t ${target}\` and re-export.`
      : `content needs "${id}", which has no ${profile.id} build — the module is not available on this platform.`);
  }
  return present;
}

/**
 * Export the open project as a mini-game for `profile`'s vendor into `outDir`.
 * `sdkDir` is the SDK dist dir the bundle aliases `esengine` to (the vendor
 * build, profile.sdkEntryFile); `wasmDir` the vendor engine runtime to copy.
 */
export async function exportMiniGame(profile: MiniGameExportProfile, opts: {
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
  /** MiniGame appid (Project Settings) → project config. */
  appid?: string;
  /** Screen orientation (Project Settings) → game.json. */
  orientation?: 'portrait' | 'landscape';
  /** The project's runtime settings, derived once by `runtimeConfigOf`; the
   *  generated boot passes the packaged slice of them to the vendor runtime. */
  runtime?: RuntimeProjectConfig;
  minify?: boolean;
  /** Emit content-addressed asset filenames (<hash><ext>) for dedup + immutable caching. */
  contentAddressed?: boolean;
  /** Encode raster textures to GPU-compressed KTX2 at cook time. */
  compressTextures?: boolean;
  compressAudio?: boolean;
  /** Pack `<name>.atlas/` folder PNGs into atlas pages at cook time. */
  atlasTextures?: boolean;
  onProgress?: OnExportProgress;
}): Promise<ExportMiniGameResult> {
  const title = opts.title ?? 'Game';
  const absOut = path.isAbsolute(opts.outDir) ? opts.outDir : path.join(opts.root, opts.outDir);
  const progress = opts.onProgress ?? (() => {});
  const warnings: string[] = [];
  const errors: string[] = [];

  // 0. The generated entry unconditionally requires the engine glue, so a
  //    missing vendor runtime cannot produce a runnable package — fail before
  //    cooking. Require by its ACTUAL name in the wasm dir (the -t wechat
  //    build emits esengine.wxgame.js; a web-aligned build, esengine.js).
  const engineGlueFile = profile.engineGlueCandidates
    .find((f) => existsSync(path.join(opts.wasmDir, f)));
  if (!engineGlueFile) {
    // The optional-module targets come off the profile, so the guidance names
    // THIS vendor's builds rather than a hardcoded WeChat pair.
    const moduleTargets = [...new Set(Object.values(profile.sideModuleBuildTargets))];
    errors.push(
      `${profile.id} engine runtime not found in ${opts.wasmDir} — ` +
      `build it with \`node build-tools/cli.js build -t ${profile.wasmBuildHint}\`` +
      (moduleTargets.length > 0
        ? ` (optional modules build separately: ${moduleTargets.map((t) => `-t ${t}`).join(' / ')})`
        : ''),
    );
    return { ok: false, platform: profile.id, outDir: absOut, included: 0, warnings, errors };
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
  // `platform: profile.id` — the cook reads each texture's per-platform Import
  // Settings under this key, so a vendor must cook against ITS OWN overrides.
  const cook = await cookAssets(opts.root, { entryScenes: scenes.map((s) => s.path), outDir: absOut, contentAddressed: opts.contentAddressed, compressTextures: opts.compressTextures, compressAudio: opts.compressAudio, atlasTextures: opts.atlasTextures, transcodeVideo: true, platform: profile.id });
  warnings.push(...cook.warnings);

  // 1a. Restage for the vendor's code-package suffix whitelist (WeChat has no
  //     `ktx2`, `esv` or `esscene`; the packer drops such files and fs reads are
  //     denied regardless of packOptions):
  //       *.ktx2                → *.ktx2.bin (whitelisted; isKtx2Path accepts both)
  //       *.esv                 → *.esv.bin (the wasm video backend strips the
  //                               .bin when deriving the .m4a audio sibling)
  //       assets/…/<x>.esscene  → scenes/<name>.json, @uuid: refs stripped to the
  //                               bare uuids the resolver keys by; the manifest
  //                               entry follows, so scene refs resolve to the file.
  progress({ phase: 'Transforming scenes' });
  const binRestageRe = new RegExp(`\\.(${profile.binRestageExts.join('|')})$`);
  const flatManifestPath = path.join(absOut, 'assets.manifest.json');
  let cookEntries: CookManifest['entries'] = [];
  const sceneRawByName = new Map<string, unknown>();
  try {
    const flat = JSON.parse(await readFile(flatManifestPath, 'utf8')) as CookManifest;
    for (const e of flat.entries) {
      if (binRestageRe.test(e.path.toLowerCase())) {
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

  // 1b. Scan the shipped content for the optional modules it needs (physics/spine),
  //     so the generated entry requires exactly those — the export-time half of
  //     the runtime's self-gating.
  const engineSideModules = await scanSideModules(
    profile, opts.root, cook.includedPaths, cookEntries, absOut, opts.wasmDir, errors,
    opts.runtime?.physicsEnabled ?? false,
  );
  // …plus the ones the PROJECT supplies. They are not scanned for: a project put
  // them in `.esengine/modules/` in order to use them, and unlike physics or
  // spine there is no component in the scene the engine could recognize as the
  // thing that needs one. Staged and required by the same code path, so a
  // third-party runtime loads on a device exactly like a built-in.
  const projectModules = await loadProjectModules(opts.root, profile.id);
  const sideModules = [
    ...engineSideModules,
    ...projectModules.filter((m) => m.buildDir).map((m) => ({ id: m.id, file: m.file })),
  ];
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

  // 4. game-bundle.js — vendor SDK (esengine aliased) + project scripts + boot(),
  //    one esengine instance so the project's defineComponent/defineSystem run.
  const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
  // The engine wasm path rides into the boot config: only the exporter knows
  // which glue it staged (esengine.wxgame vs the web-aligned esengine), and the
  // runtime must instantiate the staged glue's .wasm twin, not guess a name.
  const engineWasmPath = `wasm/${engineGlueFile.replace(/\.js$/, '.wasm')}`;
  // The packaged slice of the project's settings, GENERATED rather than listed:
  // a setting added to packagedRuntimeFields reaches this boot without anyone
  // having to remember that this template exists. Theme colours are the one that
  // is not a plain value — the runtime takes parsed overrides, so a call is
  // emitted for them instead.
  // Every mini-game vendor gives the runtime a GL context and nothing else, so
  // a WebGPU request cannot be honoured here — carrying it would be a config
  // field the runtime is guaranteed to ignore.
  const { renderBackend: _webgpuNotHere, ...packaged } =
    packagedRuntimeFields(opts.runtime ?? DEFAULT_RUNTIME_CONFIG);
  const themeColors = packaged.uiThemeColors;
  const runtimeArgs = Object.entries(packaged)
    .map(([k, v]) => (k === 'uiThemeColors'
      ? `, uiThemeOverrides: parseThemeOverrides(${JSON.stringify(v)})`
      : `, ${k}: ${JSON.stringify(v)}`))
    .join('');
  // A vendor whose SDK entry does not install a platform on import (the
  // family entry, esengine/minigame — it waits until the game names a host)
  // gets its runtime profile installed here, at the top of boot(). Without
  // this the package would build fine and then throw on the device, which is
  // the worst place to learn that the two halves of a vendor were never joined.
  const installsPlatform = !!profile.runtimeProfileModule;
  // A mini-game does not read game.config.json — its configuration IS this
  // generated call — so the project modules' artifact names ride it here. The
  // factories arrive separately (game.js require()s the glue); this is what tells
  // the runtime where each binary sits in the package.
  const projectDeclarations = sideModuleDeclarations(projectModules, profile.id);
  const entrySrc =
    `import { ${profile.runtimeInit}${installsPlatform ? ', installMiniGamePlatform' : ''}${themeColors ? ', parseThemeOverrides' : ''} } from 'esengine';\n` +
    (installsPlatform ? `import __platformProfile from ${JSON.stringify(profile.runtimeProfileModule)};\n` : '') +
    (scriptsAbs && existsSync(scriptsAbs) ? `import ${JSON.stringify(scriptsAbs)};\n` : '') +
    `export function boot(engineFactory, sideModuleFactories) {\n` +
    (installsPlatform ? `  installMiniGamePlatform(__platformProfile);\n` : '') +
    `  return ${profile.runtimeInit}({ engineFactory, engineWasmPath: ${JSON.stringify(engineWasmPath)}, sideModuleFactories, sceneNames: ${JSON.stringify(scenes.map((s) => s.name))}, firstScene: ${JSON.stringify(sceneName)}${runtimeArgs}${projectDeclarations.length > 0 ? `, sideModules: ${JSON.stringify(projectDeclarations)}` : ''} });\n` +
    `}\n`;
  progress({ phase: 'Bundling game' });
  try {
    const { build } = await loadEsbuild();
    const res = await build({
      stdin: { contents: entrySrc, resolveDir: opts.root, loader: 'js', sourcefile: 'minigame-entry.js' },
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      // Real-device WeChat rejects es2020 syntax (`??`, `?.`) even though the
      // devtools accepts it; es2017 down-levels those while keeping async/await.
      target: profile.esTarget,
      alias: esengineAlias(opts.sdkDir, profile.sdkEntryFile),
      minify: opts.minify ?? false,
      sourcemap: false,
      outfile: path.join(absOut, 'game-bundle.js'),
      logLevel: 'silent',
      write: true,
    });
    errors.push(...explainBundleErrors(res.errors));
  } catch (err) {
    const e = err as { errors?: BundleMessage[]; message?: string };
    errors.push(...(e.errors ? explainBundleErrors(e.errors) : [String(e.message ?? err)]));
  }

  // 4b. The open data context — a SECOND bundle, for a second JS runtime.
  //
  //     It has no WebGL, no wasm and almost none of the host API; it draws on a
  //     2D canvas the main domain samples as a texture, and it is the only place
  //     a player's friends can be read. So it cannot share the game bundle, and
  //     the `esengine` alias is deliberately WITHHELD here: a context that
  //     imports the engine fails to resolve at export instead of throwing on a
  //     device, which is the only place that mistake would otherwise surface.
  //
  //     The project owns this file and a package may be what it imports
  //     (`estella-plugin-minigame-services/open-data` is a friends board in one
  //     line). No directory, no context — which is what asking for none means.
  const openDataEntry = ['index.ts', 'index.js']
    .map((f) => path.join(opts.root, OPEN_DATA_DIR, f))
    .find((f) => existsSync(f));
  if (openDataEntry) {
    progress({ phase: 'Bundling open data context' });
    try {
      const { build } = await loadEsbuild();
      const res = await build({
        entryPoints: [openDataEntry],
        bundle: true,
        format: 'cjs',
        platform: 'browser',
        // Same syntax floor as the game bundle: the host compiles EVERY .js in
        // the package, this one included.
        target: profile.esTarget,
        minify: opts.minify ?? false,
        sourcemap: false,
        outfile: path.join(absOut, OPEN_DATA_DIR, 'index.js'),
        logLevel: 'silent',
        write: true,
      });
      errors.push(...explainBundleErrors(res.errors));
    } catch (err) {
      const e = err as { errors?: BundleMessage[]; message?: string };
      errors.push(...(e.errors ? explainBundleErrors(e.errors) : [String(e.message ?? err)]));
    }
  }

  // 5. Entry + config (vendor-specific emission).
  await writeFile(path.join(absOut, 'game.js'), profile.emitEntry({ sideModules, engineGlueFile }));
  const configFiles = profile.emitConfigFiles({
    title,
    appid: opts.appid ?? '',
    orientation: opts.orientation ?? 'portrait',
    subPackages: subPackagesOf(cookEntries, profile.subpackageDir),
    includeSuffixes: packIncludeSuffixes(cookEntries, profile.nativeSuffixes),
    // Only a bundle that was actually written counts: an entry that failed to
    // build must not leave the config pointing at a directory with no index.js.
    hasOpenData: !!openDataEntry && errors.length === 0,
    openDataRoot: OPEN_DATA_DIR,
  });
  for (const { file, content } of configFiles) {
    await writeFile(path.join(absOut, file), content);
  }

  // 6. The engine runtime + exactly the side modules the scene needs. WeChat's
  //    main package has a 4MB budget — unneeded side modules must not ride along.
  //    Rematerialize wasm/ from scratch: it holds EXACTLY this export's runtime
  //    set and nothing else. A prior export into the same outDir may have staged
  //    a module this project no longer needs (e.g. basis.js when KTX2 was on),
  //    and this run — copying only the current set — would leave that stale .js
  //    behind. The mini-game packer compiles EVERY .js in the package, so a stale
  //    glue built by an older pipeline (raw es2020 `?.`/`??`, not down-leveled)
  //    fails real-device compile ("invalid file: wasm/basis.js … Unexpected token .").
  //    Scoped to wasm/ (exporter-owned); the outDir root also hosts devtools'
  //    project.private.config.json, so we don't wipe the whole tree.
  progress({ phase: 'Copying runtime' });
  const wasmOut = path.join(absOut, 'wasm');
  await rm(wasmOut, { recursive: true, force: true });
  await mkdir(wasmOut, { recursive: true });
  // Engine artifacts only — the project's own come from `.esengine/modules/`,
  // not from the engine runtime dir, and are staged below.
  const runtimeFiles = [
    engineGlueFile,
    engineGlueFile.replace(/\.js$/, '.wasm'),
    ...engineSideModules.flatMap((m) => [`${m.file}.js`, `${m.file}.wasm`]),
  ];
  const { transform } = await loadEsbuild();
  for (const f of runtimeFiles) {
    const src = path.join(opts.wasmDir, f);
    if (!existsSync(src)) {
      errors.push(`${profile.id} runtime file missing: ${f} (in ${opts.wasmDir}) — rebuild with \`node build-tools/cli.js build -t ${profile.wasmBuildHint}\``);
      continue;
    }
    const dest = path.join(wasmOut, f);
    if (f.endsWith('.js')) {
      // Emscripten glue can carry es2020 syntax (`?.`, `??`) that real-device
      // WeChat rejects — down-level it like the game bundle.
      const out = await transform(await readFile(src, 'utf8'), { target: profile.esTarget, loader: 'js' });
      await writeFile(dest, out.code);
    } else {
      await cp(src, dest);
    }
  }
  // The project's own modules land in the same wasm/ dir, with the same glue
  // down-level applied — game.js require()s them by the same path.
  warnings.push(...await stageProjectModules(projectModules, wasmOut, profile.id,
    async (code) => (await transform(code, { target: profile.esTarget, loader: 'js' })).code));

  return { ok: errors.length === 0, platform: profile.id, outDir: absOut, included: cook.included.length, warnings, errors };
}
