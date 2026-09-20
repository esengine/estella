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
import { brotliCompress as brotliCompressCb, constants as zlibConstants } from 'node:zlib';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cookAssets, type Inclusion } from '../assets/cookAssets';
import { buildAddressableManifest } from '../assets/addressableManifest';
import type { ExportScene } from './exportGame';
import type { OnExportProgress } from './exportProgress';
import { runtimeHostEntry } from '../bundle/runtimeHosts';
import { breakdownOf, type ModuleBytes } from './bundleBreakdown';
import { esengineAlias } from '../bundle/esengineResolve';
import { explainBundleErrors, type BundleMessage } from '../bundle/bundleDiagnostics';
import { scanSideModuleIds, sideModuleFiles } from '../bundle/sideModuleScan';
import { OPEN_DATA_DIR } from './miniGameExportProfile';
import { loadProjectModules, sideModuleDeclarations, stageProjectModules } from './projectModules';
import { buildCompiledSystems, type BuildMode } from '../bundle/buildCompiledSystems';
import { resolveEmcc, runEmcc } from '../bundle/emccPath';
import type { MiniGameExportProfile, MiniGameVendor } from './miniGameExportProfile';

export interface ExportMiniGameResult {
  ok: boolean;
  platform: MiniGameVendor;
  outDir: string;
  included: number;
  warnings: string[];
  errors: string[];
  /** @internal Why each asset is in the build; the size report consumes and drops it. */
  inclusion?: Record<string, Inclusion>;
  /** What each subsystem costs inside `game-bundle.js`, largest first. The bundle
   *  is the main package's biggest file once the engine binary can move out, and
   *  a vendor's brotli path does not take `.js`, so this is where the remaining
   *  room is. */
  bundleModules?: ModuleBytes[];
  /** Project-relative subpackage roots — what is NOT on the main package's cap. */
  subPackageRoots?: string[];
}

interface CookManifest {
  entries: {
    uuid: string; path: string; sourcePath?: string; type: string;
    contentHash?: string; size?: number; group?: string; groupMode?: string;
    atlas?: { page: number; frame: { x: number; y: number; width: number; height: number }; pageWidth: number; pageHeight: number };
  }[];
}

const brotliPack = promisify(brotliCompressCb);

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

/** What this export stages into `wasm/`, and the engine path the loader is told. */
interface RuntimeLayout {
  /** Package-relative path the boot config hands the loader. */
  readonly enginePath: string;
  /** Package-relative directory the runtime artifacts land in, as the generated
   *  entry requires them (`./wasm/`) — one author for where they are and where
   *  they are asked for. */
  readonly runtimeDir: string;
  /** Engine artifacts to stage: the name in `wasmDir` → the PACKAGE-RELATIVE path
   *  it lands at, so a binary that moves into a 分包 is the same list with a
   *  different path rather than a second staging rule. */
  readonly files: ReadonlyArray<{ readonly src: string; readonly staged: string; readonly brotli?: true }>;
  /** The 分包 the engine binary went into, for the host config to declare. */
  readonly subpackage: { readonly name: string; readonly root: string } | null;
}

/**
 * Decided ONCE, read by the boot config and the copy loop: what lands is what
 * the loader is told. Only the ENGINE binary compresses — a side module's is
 * found at `wasm/<file>.wasm` by three hosts that spell that suffix themselves,
 * so renaming one here would leave all three naming a file that is not there.
 */
const ENGINE_SUBPACKAGE = 'engine';

function planRuntimeLayout(
  engineGlueFile: string,
  sideModules: ReadonlyArray<{ file: string }>,
  opts: { brotli: boolean; subpackage: boolean; subpackageDir: string },
): RuntimeLayout {
  const engineBinary = engineGlueFile.replace(/\.js$/, '.wasm');
  const engineName = opts.brotli ? `${engineBinary}.br` : engineBinary;
  // Only the BINARY moves. The glue is `require`d by the entry, and a 分包's files
  // are not requirable before the host has loaded it — so it stays beside game.js,
  // which is where every engine that ships this keeps it.
  const root = `${opts.subpackageDir}/${ENGINE_SUBPACKAGE}`;
  const enginePath = opts.subpackage ? `${root}/${engineName}` : `wasm/${engineName}`;
  const binary = opts.brotli
    ? { src: engineBinary, staged: enginePath, brotli: true as const }
    : { src: engineBinary, staged: enginePath };
  return {
    enginePath,
    runtimeDir: 'wasm',
    subpackage: opts.subpackage ? { name: ENGINE_SUBPACKAGE, root } : null,
    files: [
      { src: engineGlueFile, staged: `wasm/${engineGlueFile}` },
      binary,
      ...sideModules.flatMap((m) => [
        { src: `${m.file}.js`, staged: `wasm/${m.file}.js` },
        { src: `${m.file}.wasm`, staged: `wasm/${m.file}.wasm` },
      ]),
    ],
  };
}

/**
 * The vendor subPackage roots this package actually carries, read off the STAGED
 * paths: a root the package lacks fails the whole game at load ("root 不存在").
 * Only LAZY delivery is a 分包 — a group's name outlives its delivery, so a
 * project that once had one still carries the name of one.
 */
function subPackagesOf(
  entries: CookManifest['entries'],
  subpackageDir: string,
): { subPackages: Array<{ name: string; root: string }>; strays: string[] } {
  const carried = new Set<string>();
  const strays: string[] = [];
  for (const e of entries) {
    if (!e.group || e.group === 'main' || e.groupMode !== 'lazy') continue;
    const root = `${subpackageDir}/${e.group}`;
    if (e.path === root || e.path.startsWith(`${root}/`)) carried.add(e.group);
    else strays.push(`${e.sourcePath} is in 分包 '${e.group}' but ships at ${e.path}, outside ${root}/`);
  }
  return {
    subPackages: [...carried].map((name) => ({ name, root: `${subpackageDir}/${name}` })),
    strays,
  };
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
  /** Where the runtime hosts live — sources in dev, a prebuilt tree in a packaged
   *  editor. A built-in vendor's platform profile is resolved against it. */
  hostsDir: string;
  title?: string;
  /** MiniGame appid (Project Settings) → project config. */
  appid?: string;
  /** Screen orientation (Project Settings) → game.json. */
  orientation?: 'portrait' | 'landscape';
  /** The project's runtime settings, derived once by `runtimeConfigOf`; the
   *  generated boot passes the packaged slice of them to the vendor runtime. */
  runtime?: RuntimeProjectConfig;
  minify?: boolean;
  /**
   * Where emcc is, for the systems a project marked `@compiled`
   * (docs/REARCH_AOT.md). Absent ⇒ found from the environment; a project that
   * promised nothing never needs one.
   */
  emcc?: string | null;
  /** Whether this export compiles `@compiled` systems; see exportGame. */
  aotMode?: BuildMode;
  /** Emit content-addressed asset filenames (<hash><ext>) for dedup + immutable caching. */
  contentAddressed?: boolean;
  /** Encode raster textures to GPU-compressed KTX2 at cook time. */
  compressTextures?: boolean;
  compressAudio?: boolean;
  /** Pack `<name>.atlas/` folder PNGs into atlas pages at cook time. */
  atlasTextures?: boolean;
  /** The project's `packaging.compressWasm`; honoured only where the vendor can
   *  load a `.wasm.br` (profile.wasmBrotli) — policy meeting capability. */
  compressWasm?: boolean;
  /** The project's `packaging.engineSubpackage`: move the engine binary out of
   *  the main package into a 分包 the host loads at startup. */
  engineSubpackage?: boolean;
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

  // 1a. Anything the packer will not upload ships as `<name>.<ext>.bin`. Scenes
  //     have their own transform below (`<x>.esscene` → `scenes/<name>.json`,
  //     @uuid: refs stripped to the bare uuids the resolver keys by).
  progress({ phase: 'Transforming scenes' });
  const needsRestage = (p: string): boolean => {
    if (!profile.packerSuffixes) return false;
    const ext = path.extname(p).slice(1).toLowerCase();
    return ext !== '' && !profile.packerSuffixes.has(ext);
  };
  const flatManifestPath = path.join(absOut, 'assets.manifest.json');
  let cookEntries: CookManifest['entries'] = [];
  const sceneRawByName = new Map<string, unknown>();
  try {
    const flat = JSON.parse(await readFile(flatManifestPath, 'utf8')) as CookManifest;
    for (const e of flat.entries) {
      // Scenes FIRST: they have a transform of their own below, which leaves a
      // `.json` the packer takes. Restaging one would ship the authored file
      // beside the transformed one, under a name nothing reads.
      const scene = scenes.find((s) => s.path === e.path);
      if (!scene && needsRestage(e.path)) {
        await rename(path.join(absOut, e.path), path.join(absOut, `${e.path}.bin`));
        e.path = `${e.path}.bin`;
        continue;
      }
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
  // Compressing needs both halves: a vendor whose loader takes `.wasm.br`, and a
  // project that asked for it. Either alone leaves the binary as built.
  const brotli = profile.wasmBrotli && (opts.compressWasm ?? false);
  const runtimeLayout = planRuntimeLayout(engineGlueFile, engineSideModules, {
    brotli,
    // No API global ⇒ nothing to ask for the 分包 with, so it stays in the main package.
    subpackage: profile.hostGlobal !== null && profile.subpackageDir !== '' && (opts.engineSubpackage ?? false),
    subpackageDir: profile.subpackageDir,
  });
  const engineWasmPath = runtimeLayout.enginePath;
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
  // esengine/minigame installs no platform until a host is named, so boot() names
  // one: a built-in points at a shipped module, a project vendor at a file beside
  // its own platform. Unjoined, the package builds and throws on the device.
  const platformProfileModule = profile.runtimeProfileHost
    ? runtimeHostEntry(opts.hostsDir, profile.runtimeProfileHost)
    : profile.runtimeProfileModule;
  const installsPlatform = !!platformProfileModule;
  // A mini-game does not read game.config.json — its configuration IS this
  // generated call — so the project modules' artifact names ride it here. The
  // factories arrive separately (game.js require()s the glue); this is what tells
  // the runtime where each binary sits in the package.
  const projectDeclarations = sideModuleDeclarations(projectModules, profile.id);

  // The compiled twins, staged as a package file and named in the boot call —
  // the target AOT exists for (docs/REARCH_AOT.md §1.1: iOS mini-games have no
  // JIT). A PATH, because WXWebAssembly cannot compile bytes.
  const built = await buildCompiledSystems(opts.root, {
    mode: opts.aotMode ?? 'release', cc: resolveEmcc(opts.emcc), run: runEmcc,
  });
  if (!built.ok) {
    errors.push(...built.errors);
    return { ok: false, platform: profile.id, outDir: absOut, included: cook.included.length, warnings, errors };
  }
  let aotArg = '';
  if (built.modulePath && built.manifest) {
    progress({ phase: 'Compiling systems', detail: `${built.manifest.systems.length} system(s)` });
    await mkdir(path.join(absOut, 'aot'), { recursive: true });
    await cp(built.modulePath, path.join(absOut, 'aot', 'systems.wasm'));
    aotArg = `, aot: ${JSON.stringify({ module: 'aot/systems.wasm', manifest: built.manifest })}`;
  }
  // The scan's answer for wasm side modules, asked of their JS: the lean entry
  // plus the subpaths that install what this project uses. Video has no subpath,
  // so a project with video takes the whole entry.
  const OPTIONAL_SUBPATH: Record<string, string> = {
    physics: 'esengine/physics',
    physics3d: 'esengine/physics3d',
    dragonbones: 'esengine/dragonbones',
  };
  const needed = new Set(sideModules.map((m) => m.id));
  const wantsVideo = needed.has('videodec');
  // Only when the SDK build actually produced one: a tree without it (an older
  // dist, a test fixture) must fall back to the whole entry rather than alias
  // `esengine` to a file that is not there.
  const leanEntry = profile.sdkLeanEntryFile
    && existsSync(path.join(opts.sdkDir, profile.sdkLeanEntryFile))
    ? profile.sdkLeanEntryFile : null;
  const lean = !!leanEntry && !wantsVideo;
  const installs = lean
    ? [...new Set([...needed].map((id) => (id.startsWith('spine:')
      ? 'esengine/spine'
      : OPTIONAL_SUBPATH[id] ?? '')).filter(Boolean))].sort()
    : [];

  const entrySrc =
    installs.map((m) => `import ${JSON.stringify(m)};\n`).join('') +
    `import { ${profile.runtimeInit}${installsPlatform ? ', installMiniGamePlatform' : ''}${themeColors ? ', parseThemeOverrides' : ''} } from 'esengine';\n` +
    (installsPlatform ? `import __platformProfile from ${JSON.stringify(platformProfileModule)};\n` : '') +
    (scriptsAbs && existsSync(scriptsAbs) ? `import ${JSON.stringify(scriptsAbs)};\n` : '') +
    `export function boot(engineFactory, sideModuleFactories) {\n` +
    (installsPlatform ? `  installMiniGamePlatform(__platformProfile);\n` : '') +
    `  return ${profile.runtimeInit}({ engineFactory, engineWasmPath: ${JSON.stringify(engineWasmPath)}, sideModuleFactories, sceneNames: ${JSON.stringify(scenes.map((s) => s.name))}, firstScene: ${JSON.stringify(sceneName)}${runtimeArgs}${projectDeclarations.length > 0 ? `, sideModules: ${JSON.stringify(projectDeclarations)}` : ''}${aotArg} });\n` +
    `}\n`;
  progress({ phase: 'Bundling game' });
  /** What each subsystem costs in the bundle — empty if esbuild wrote no metafile. */
  let bundleModules: ModuleBytes[] = [];
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
      alias: esengineAlias(opts.sdkDir, lean ? leanEntry! : profile.sdkEntryFile),
      minify: opts.minify ?? false,
      sourcemap: false,
      outfile: path.join(absOut, 'game-bundle.js'),
      logLevel: 'silent',
      write: true,
      // Once the engine binary can leave the main package, this bundle is the
      // largest file in it — and the vendor's brotli path does not take `.js`.
      // esbuild already knows which subsystem each surviving byte came from.
      metafile: true,
    });
    errors.push(...explainBundleErrors(res.errors));
    if (res.metafile) bundleModules = breakdownOf(res.metafile, 'game-bundle.js');
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
  const cooked = subPackagesOf(cookEntries, profile.subpackageDir);
  warnings.push(...cooked.strays);
  // The engine's 分包, if the binary went into one, joins the cook's lazy groups
  // here: the root entry each vendor demands and the host config's declaration
  // are written once, for every subpackage, whatever put it there.
  const subPackages = {
    subPackages: runtimeLayout.subpackage
      ? [...cooked.subPackages, runtimeLayout.subpackage]
      : cooked.subPackages,
  };
  // A vendor that wants an entry in every subpackage root refuses the package
  // without one, naming the missing file rather than the rule. These roots hold
  // assets the runtime reads by path, so the entry has nothing to do but exist.
  if (profile.subpackageEntry) {
    for (const sp of subPackages.subPackages) {
      // A cook group's root exists because its assets landed there; the engine's
      // is made by the staging below, which has not run yet.
      await mkdir(path.join(absOut, sp.root), { recursive: true });
      await writeFile(
        path.join(absOut, sp.root, profile.subpackageEntry),
        `// Entry for the "${sp.name}" subpackage, which ${profile.id} requires in every\n`
        + '// subpackage root. This one carries assets the runtime loads by path, so it\n'
        + '// has nothing to run.\n',
      );
    }
  }
  await writeFile(path.join(absOut, 'game.js'),
    profile.emitEntry({ sideModules, engineGlueFile, runtimeDir: runtimeLayout.runtimeDir,
      engineSubpackage: runtimeLayout.subpackage?.name ?? null, hostGlobal: profile.hostGlobal }));
  const configFiles = profile.emitConfigFiles({
    title,
    appid: opts.appid ?? '',
    orientation: opts.orientation ?? 'portrait',
    subPackages: subPackages.subPackages,
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
  await rm(wasmOut, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  await mkdir(wasmOut, { recursive: true });
  // Engine artifacts only — the project's own come from `.esengine/modules/`,
  // not from the engine runtime dir, and are staged below.
  const { transform } = await loadEsbuild();
  for (const f of runtimeLayout.files) {
    const src = path.join(opts.wasmDir, f.src);
    if (!existsSync(src)) {
      errors.push(`${profile.id} runtime file missing: ${f.src} (in ${opts.wasmDir}) — rebuild with \`node build-tools/cli.js build -t ${profile.wasmBuildHint}\``);
      continue;
    }
    const dest = path.join(absOut, f.staged);
    await mkdir(path.dirname(dest), { recursive: true });
    if (f.src.endsWith('.js')) {
      // Emscripten glue can carry es2020 syntax (`?.`, `??`) that real-device
      // WeChat rejects — down-level it like the game bundle.
      const out = await transform(await readFile(src, 'utf8'), { target: profile.esTarget, loader: 'js' });
      await writeFile(dest, out.code);
    } else if (f.brotli) {
      // Quality 11: it runs once per build, and the bytes it saves are spent
      // against a main-package limit for the life of the package.
      const raw = await readFile(src);
      const packed = await brotliPack(raw, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
        },
      });
      await writeFile(dest, packed);
      progress({
        phase: 'Copying runtime',
        detail: `${f.staged} ${(raw.byteLength / 1048576).toFixed(2)}MB → ${(packed.byteLength / 1048576).toFixed(2)}MB`,
      });
    } else {
      await cp(src, dest);
    }
  }
  // The project's own modules land in the same wasm/ dir, with the same glue
  // down-level applied — game.js require()s them by the same path.
  warnings.push(...await stageProjectModules(projectModules, wasmOut, profile.id,
    async (code) => (await transform(code, { target: profile.esTarget, loader: 'js' })).code));

  return {
    ok: errors.length === 0, platform: profile.id, outDir: absOut,
    included: cook.included.length, warnings, errors, inclusion: cook.inclusion,
    bundleModules,
    // The size report weighs the main package against a cap the subpackages are
    // NOT on, and it cannot tell a subpackage root from any other directory. The
    // export that made them names them.
    subPackageRoots: subPackages.subPackages.map((sp) => sp.root),
  };
}
