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
import { loadEsbuild } from '../bundle/esbuildRuntime';
import { runtimeHostEntry } from '../bundle/runtimeHosts';
import { writeFile, readFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isInsideRoot } from '../fs/pathSandbox';
import path from 'node:path';
import { cookAssets, type CookManifest, type Inclusion } from '../assets/cookAssets';
import { cookWorlds, streamedScenes } from '../world/cookWorld';
import { buildAddressableManifest } from '../assets/addressableManifest';
import type { DebugChannelConfig, PackagedGameConfig } from 'esengine';
import { packagedDebugChannel } from './debugChannel';
import { packagedHotUpdate } from './hotUpdateConfig';
import {
  DEFAULT_RUNTIME_CONFIG, packagedRuntimeFields, type RuntimeProjectConfig,
} from '../project/runtimeConfig';
import { engineImportMap, FULL_IMPORT_MAP, LEAN_ENTRY_FILE, FULL_ENTRY_FILE, type EngineImportMap } from '../bundle/importMap';
import { engineInstalls, forcedSideModules, moduleChoices, type EngineInstallPlan } from '../bundle/engineInstalls';
import { exportMiniGame } from './exportMiniGame';
import { wechatExportProfile, douyinExportProfile, kuaishouExportProfile, bilibiliExportProfile, quickgameExportProfile, alipayExportProfile, huaweiExportProfile } from './miniGameExportProfile';
import type { MiniGameExportProfile } from './miniGameExportProfile';

/** The mini-game vendors the editor ships, by platform id. */
const BUILTIN_MINIGAME_PROFILES: Readonly<Record<string, MiniGameExportProfile>> = {
  wechat: wechatExportProfile,
  douyin: douyinExportProfile,
  kuaishou: kuaishouExportProfile,
  bilibili: bilibiliExportProfile,
  quickgame: quickgameExportProfile,
  alipay: alipayExportProfile,
  huawei: huaweiExportProfile,
};
import { exportPlayable } from './exportPlayable';
import { genericPlayableProfile, type PlayableAdProfile } from './playableAdProfile';
import type { OnExportProgress } from './exportProgress';
import { ESENGINE_EXTERNAL, ESENGINE_SUBPATHS } from '../bundle/esengineResolve';
import { officialPackagesPlugin } from '../bundle/officialPackages';
import type { RpkSigningKey } from './rpk';
import { buildCompiledSystems, type BuildMode } from '../bundle/buildCompiledSystems';
import { resolveEmcc, runEmcc } from '../bundle/emccPath';
import { findHostCC } from '../../../compiler/src/hostCC';
import { explainBundleErrors, type BundleMessage } from '../bundle/bundleDiagnostics';
import { orientationCss, orientationOverlayHtml, orientationLockScript, orientationLockCspHash, type ScreenOrientation } from './orientationHtml';
import { PAGE_BACKGROUND, splashCss, splashHtml, type SplashLook } from './splash';
import { emitIosXcodeProject, type IosProjectSources } from '../../../build-tools/utils/iosProject.js';
import { emitAndroidGradleProject } from '../../../build-tools/utils/gradleProject.js';
import { androidTemplateSources } from '../../../build-tools/utils/nativeTemplate.js';
import { assembleApk, apkFileName } from '../../../build-tools/utils/apk.js';
import { assembleAab, aabFileName } from '../../../build-tools/utils/aab.js';
import { assembleDesktopApp } from '../../../build-tools/utils/desktopApp.js';
import { emitSteamBuild, defaultDepotId } from '../../../build-tools/utils/steamChannel.js';
import { debugSigningKey, type SigningKey } from '../../../build-tools/utils/androidKeystore.js';
import { BUILTIN_PLATFORMS, compileTargetFor, isNativePlatform, desktopTemplateFor, type DesktopOs, type ExportPlatform } from '../project/platforms';
import type { DesktopPackaging, ProjectFeatures, ProjectPackaging, SteamPackaging } from '../project/format';
import type { SizeBudget } from '../project/sizeBudget';
import { measureBuild, type BuildSizeReport } from './sizeReport';
import { sizeSettingsOf } from './sizeHistory';
import { loadProjectModules, sideModuleDeclarations, stageProjectModules } from './projectModules';
import { subsystemGapWarnings, targetGaps } from '../project/targetSupport';
import { contentSubsystems } from './contentSubsystems';
import { scanSideModuleIds, sideModuleFiles, shipsSideModule, textureDecoderBytes } from '../bundle/sideModuleScan';
import { MODULES, NATIVE_MODULE_REGISTRY } from '../../../tools/nativeScriptModules.js';


export type { ExportPlatform };

/** What to say about a CDN a shipping Android build cannot reach: Android refuses
 *  plain http from an app that has not asked for it, and only a development
 *  build asks. */
export function cleartextWarning(platform: string, shipping: boolean, remoteRoot?: string): string | null {
  if (platform !== 'android' || !shipping || !remoteRoot?.startsWith('http://')) return null;
  return `The CDN ${remoteRoot} is plain http://, which Android refuses in a shipping build: `
    + 'remote assets and hot updates will not load. Serve it over https.';
}

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
  /** Plain `http://` is allowed (Android's usesCleartextTraffic): a development
   *  build reaches a LAN server, and a shipping one is held to https. */
  allowHttp?: boolean;
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

/** The build's own record of which chunks each entry reaches (sdk/rolldown.config.js). */
const CHUNK_MANIFEST = 'chunks.json';

/**
 * The files a browser package needs out of sdk/dist: the entries ITS import map
 * names, plus the chunks the SDK build says those reach. Derived from the map,
 * never enumerated: a listed set went stale the first time an entry was added,
 * and a web package shipped a WeChat SDK's chunks.
 */
function browserPayload(sdkDist: string, entries: readonly string[]): Set<string> {
  const manifest = path.join(sdkDist, CHUNK_MANIFEST);
  if (!existsSync(manifest)) {
    // Loud, because the quiet alternative is shipping every target's runtime.
    throw new Error(`${manifest} not found — rebuild the SDK (pnpm --filter ./sdk build).`);
  }
  const reach = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, readonly string[]>;
  const want = new Set<string>();
  for (const entry of entries) {
    want.add(entry);
    for (const chunk of reach[entry] ?? []) want.add(chunk);
  }
  return want;
}

/**
 * Whether a file under sdk/dist belongs in a browser package built with
 * `sourceMaps` on or off — the maps a package carries are one decision and not
 * one per producer. Declarations never ship: nothing at runtime reads a `.d.ts`.
 */
export function shipsToBrowser(
  sourceMaps: boolean,
  sdkDist?: string,
  entries: readonly string[] = FULL_IMPORT_MAP.entries,
): (src: string) => boolean {
  const want = sdkDist ? browserPayload(sdkDist, entries) : undefined;
  const root = sdkDist ? path.resolve(sdkDist) : undefined;
  return (src: string) => {
    const base = path.basename(src);
    if (base.endsWith('.d.ts')) return false;
    if (!sourceMaps && base.endsWith('.map')) return false;
    if (!want || !root) return true;
    const rel = path.relative(root, src).split(path.sep).join('/');
    if (rel === '') return true;
    // A directory passes when something wanted is inside it; `cp` prunes the
    // whole tree otherwise.
    if (statSync(src, { throwIfNoEntry: false })?.isDirectory()) return [...want].some((f) => f.startsWith(`${rel}/`));
    if (rel === CHUNK_MANIFEST) return false;
    return want.has(rel.replace(/\.map$/, ''));
  };
}

/**
 * Strip the `sourceMappingURL` line from every script under `dir`. A package
 * built without maps still carries scripts that name one, and the browser asks
 * for it the moment anyone opens devtools on the shipped game.
 */
async function dropSourceMapRefs(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await dropSourceMapRefs(full); continue; }
    if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
    const text = await readFile(full, 'utf8');
    const stripped = text.replace(/\r?\n?[ \t]*\/\/# sourceMappingURL=.*/g, '');
    if (stripped !== text) await writeFile(full, stripped);
  }
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
  return subsystemGapWarnings(platform, await contentSubsystems(root, includedPaths));
}

export interface ExportGameResult {
  ok: boolean;
  platform: ExportPlatform;
  outDir: string;
  /** Count of assets included (reachable from the entry scene). */
  included: number;
  /** @internal Why each asset is in the build, by logical path. Consumed by the
   *  size report and dropped: a project's whole asset graph has no business
   *  crossing to the editor on every build. */
  inclusion?: Record<string, Inclusion>;
  /** @internal Subpackage roots the export staged, for the size report to keep
   *  off the main package's cap. Consumed here and dropped. */
  subPackageRoots?: string[];
  /** @internal Staged path → what it weighed before the export packed it.
   *  Consumed by the size report and dropped. */
  packedFrom?: Record<string, number>;
  warnings: string[];
  errors: string[];
  /** A native target's bundle id, as the installed app is known to the OS. */
  appId?: string;
  /** Android: the generated Gradle project, for the editor to reveal. Absent
   *  unless the export asked for a project (and a template was installed). */
  androidProject?: string;
  /** iOS: the generated `.xcodeproj`, for the editor to open. Absent when no iOS
   *  runtime template is installed (the export still carries its content). */
  xcodeProject?: string;
  /** Android: the signed APK. Absent when no Android runtime template is
   *  installed (the export still carries its content). */
  apkFile?: string;
  /** Android: the signed App Bundle, when the project asked for one. Play takes
   *  this; it is not installable. */
  aabFile?: string;
  /** Desktop: the assembled apps, one per desktop OS a runtime template is
   *  installed for. Empty when none is (the export still carries its content). */
  appBundles?: { os: DesktopOs; dir: string }[];
  /** Desktop, Steam channel: the checklist naming this build's depot ids, launch
   *  string and cloud paths — the settings only the partner backend holds. */
  steamChecklist?: string;
  /** Playable, zip-delivery networks: the archive written beside the HTML — the file
   *  the network takes an upload of. */
  zipFile?: string;
  /** A mini-game vendor's single-file package (a quick game's signed `.rpk`). */
  packageFile?: string;
  /** Playable: what the single file is made of. See ExportPlayableResult. */
  inlineParts?: { path: string; bytes: number }[];
  /** The start screen written into the host page, logo included. */
  splashBytes?: number;
  /** What the package weighs, and how it fared against the limits in force.
   *  Absent when the export failed, or when measuring itself did. */
  size?: BuildSizeReport;
}

/**
 * The bare `esengine/*` specifiers a bundle left for the import map to resolve.
 * The game host and a project's own scripts may each reach a subsystem no scene
 * mentions — a game that opens a socket in code, or builds a tilemap by hand.
 */
function externalEngineImports(metafile: { outputs: Record<string, { imports?: { path: string; external?: boolean }[] }> } | undefined): string[] {
  if (!metafile) return [];
  const found = new Set<string>();
  for (const out of Object.values(metafile.outputs)) {
    for (const imp of out.imports ?? []) {
      if (imp.external && imp.path.startsWith('esengine/')) found.add(imp.path);
    }
  }
  return [...found];
}

/** The web host page. `orientation` pins the canvas to a screen orientation (rotate-
 *  to-fit overlay + best-effort lock) — set for the mobile-facing web target, omitted
 *  for desktop (the Electron shell sizes its own window). */
function indexHtml(
  title: string, map: EngineImportMap, look: SplashLook, orientation?: ScreenOrientation,
  debugChannel?: DebugChannelConfig,
): string {
  // The editor a development build dials is the one address beyond 'self' the
  // page may connect to; a build without a channel lists none.
  const connect = debugChannel ? ` ${new URL(debugChannel.url).origin}` : '';
  // Every inline script on this page needs its hash listed, or the browser blocks it.
  const inlineScripts = [map.cspHash, ...(orientation ? [orientationLockCspHash(orientation)] : [])]
    .map((h) => `'${h}'`)
    .join(' ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'unsafe-eval' blob: ${inlineScripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:${connect}; worker-src 'self' blob:;"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <title>${title}</title>
    <script type="importmap">${map.json}</script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: ${PAGE_BACKGROUND}; }
      #canvas { display: block; width: 100%; height: 100%; touch-action: none; }
      ${splashCss(look.background ?? PAGE_BACKGROUND)}
      ${orientation ? orientationCss(orientation) : ''}
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    ${splashHtml(title, look)}
    ${orientation ? orientationOverlayHtml(orientation) : ''}
    ${orientation ? orientationLockScript(orientation) : ''}
    <script type="module" src="./game.js"></script>
  </body>
</html>
`;
}

/** Image types a start screen can inline, by extension. A format the page cannot
 *  decode is a broken image over the whole first screen, so the list is closed. */
const SPLASH_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
};

/**
 * The start screen the page will carry, with the logo INLINED.
 *
 * Inlined rather than staged: an image that needs its own request arrives in the
 * same window the engine does, so a logo meant to cover the wait would appear
 * only once there was nothing left to cover.
 */
async function splashLook(
  root: string, splash: ProjectPackaging['splash'], warnings: string[],
): Promise<SplashLook> {
  const look: SplashLook = { minMs: splash?.minMs, background: splash?.background };
  if (!splash?.logo) return look;
  const file = path.join(root, splash.logo);
  const mime = SPLASH_MIME[path.extname(splash.logo).toLowerCase()];
  if (!mime) {
    warnings.push(`The splash logo ${splash.logo} is not an image the page can inline — shown as the game's title instead.`);
    return look;
  }
  if (!existsSync(file)) {
    warnings.push(`The splash logo ${splash.logo} does not exist — shown as the game's title instead.`);
    return look;
  }
  const bytes = await readFile(file);
  look.logo = `data:${mime};base64,${bytes.toString('base64')}`;
  // Said out loud because the page swallows it: inlined, the logo IS index.html,
  // so a size report files it as page rather than art. Base64 is the cost —
  // a third more than the file on disk.
  warnings.push(`The start screen's logo ${splash.logo} is inlined into the page:`
    + ` ${bytes.length} bytes of image, ${look.logo.length} in the page.`);
  return look;
}

/** A filesystem-safe slug for the app id / package name. */
/** Bind every `esengine` import to what the host already evaluated: a native
 *  build has no module loader, and a second copy would put a game's tokens in
 *  a rival registry. Each specifier is LOOKED UP in tools/nativeScriptModules.js,
 *  never pattern-matched — a subpath must never be able to mean the bare name. */
function esengineGlobalPlugin(): Plugin {
  return {
    name: 'esengine-global',
    setup(build) {
      build.onResolve({ filter: /^esengine(\/.*)?$/ }, (args) => {
        const m = MODULES[args.path];
        if (!m) {
          return { errors: [{ text:
            `"${args.path}" is not a module the SDK publishes. Importing it from a game `
            + `script would resolve to nothing on a native build. Declare it in `
            + `tools/nativeScriptModules.js if it is meant to exist.` }] };
        }
        if (m.disposition === 'forbidden-native-script') {
          return { errors: [{ text:
            `"${args.path}" cannot be imported by a game script in a native package: `
            + `${m.why ?? 'no reason recorded'}.` }] };
        }
        return { path: args.path, namespace: 'esengine-global' };
      });
      build.onLoad({ filter: /.*/, namespace: 'esengine-global' }, (args) => ({
        // The bare specifier is the core global; a subpath is its own namespace
        // from that same running graph, so a resource token has one author.
        contents: MODULES[args.path]?.disposition === 'native-subpath'
          ? `module.exports = globalThis.${NATIVE_MODULE_REGISTRY}[${JSON.stringify(args.path)}];`
          : 'module.exports = globalThis.ESEngine;',
        loader: 'js',
      }));
    },
  };
}

export interface ExportGameOptions {
  root: string;
  /** The project-relative scene to boot. */
  entryScene: string;
  /** Project-relative scenes dir (manifest layout); default the entry's dir.
   *  Every `.esscene` under it ships as a switchable scene. */
  scenesDir?: string;
  /** Scenes excluded from the build (`packaging.excludeScenes`); the entry
   *  scene always ships. */
  excludeScenes?: string[];
  /** Where every runtime host is (runtimeHosts.ts): `pipeline/src/runtime`, or the
   *  tree an editor prebuilt from it, since a packaged app ships no sources. */
  hostsDir: string;
  /** The official `estella-plugin-*` packages the editor ships (`plugins/`);
   *  a project's scripts resolve them from here. */
  packagesDir: string;
  /** Project-relative startup entry (e.g. src/main.ts) → bundled to scripts.mjs. */
  scriptsEntry?: string;
  sdkDistDir: string;
  /** The engine runtime to copy. */
  wasmDir: string;
  outDir: string;
  /**
   * Content-addressed asset filenames (<hash><ext>) — dedup + immutable/CDN caching.
   * Default ON for web / desktop / native; the mini-game route keeps logical paths,
   * where there is no CDN cache to earn an immutable name and the vendor's packer
   * whitelists by suffix. Explicit `false`/`true` overrides either.
   */
  contentAddressed?: boolean;
  /** Encode raster textures to GPU-compressed KTX2 at cook time. Default off
   *  (lossy + encode-time cost — opt in per project). */
  compressTextures?: boolean;
  compressAudio?: boolean;
  /** Pack `<name>.atlas/` folder PNGs into atlas pages at cook time. Default off. */
  atlasTextures?: boolean;
  /** Compress the engine binary to `.wasm.br`, where the target's loader takes
   *  one. Default off; ignored by targets that cannot load it. */
  compressWasm?: boolean;
  /** Move the engine binary into a 分包 the host loads at startup, off the main
   *  package's budget. Default off; ignored by targets without subpackages. */
  engineSubpackage?: boolean;
  title?: string;
  platform?: ExportPlatform;
  /** The ad network a playable targets (`packaging.platforms.playable.network`),
   *  resolved by the caller since a project can define its own. Absent ⇒ generic. */
  playableAdProfile?: PlayableAdProfile;

  /** What the project says about its engine modules (`ProjectFeatures.modules`).
   *  Absent ⇒ every module is `auto`, which is what detection alone gives. */
  features?: ProjectFeatures;
  /** Per-target overrides laid over those; one target's limits are not another's. */
  modulesByPlatform?: ProjectPackaging['modulesByPlatform'];
  /** Desktop product/display name (Project Settings); default the project title. */
  desktopProductName?: string;
  /**
   * The id the game is registered under on THIS export's mini-game vendor
   * console (Project Settings → Packaging). One option, not one per vendor: a
   * WeChat appid in a Douyin package is refused at upload, and naming it
   * `wechatAppid` is how the Douyin export came to send one.
   */
  miniGameAppid?: string;
  /** The build ordinal a mini-game host compares packages by. Absent ⇒ 1. */
  miniGameVersionCode?: number;
  /** The project's key for a mini-game vendor that takes a signed file (a quick
   *  game's `.rpk`). Absent ⇒ signed with the public debug key. */
  miniGameReleaseKey?: RpkSigningKey;
  /** Reverse-DNS application id for a native target (format.ts resolveAppId).
   *  Written into app.config.json, where the packagers read it. */
  appId?: string;
  /** The app's version, as a store shows it (ProjectManifest.version). */
  appVersion?: string;
  /** Android's build ordinal. Absent ⇒ 1. */
  androidVersionCode?: number;
  /** Android: also write the Google Play upload format (.aab) beside the .apk. */
  androidAppBundle?: boolean;
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
  /**
   * Where emcc is, for the step that compiles the systems a project marked
   * `@compiled` (docs/REARCH_AOT.md). Absent ⇒ found from the environment or
   * the repo's own submodule; a project that promised nothing never needs one.
   */
  emcc?: string | null;
  /**
   * Whether this export compiles what the project marked `@compiled`.
   *
   * Default `release`: it compiles, and a promise the subset cannot keep fails
   * the build. `dev` skips the step, which is how one project is packaged twice
   * for the differential that proves the two frames agree (REARCH_AOT.md §8.2).
   */
  aotMode?: BuildMode;
  /** Shipping config: minify the bundles, no sourcemap. Default off (dev). */
  minify?: boolean;
  sourcemap?: boolean;
  /** Where the editor listens for this development build; with `minify`, the
   *  export fails (see `packagedDebugChannel`). */
  debugChannel?: DebugChannelConfig | null;
  /**
   * The project's runtime settings, derived ONCE from the manifest
   * (`runtimeConfigOf`) rather than re-listed per target. Every packaged build
   * writes the same slice of it (`packagedRuntimeFields`), which is what stopped
   * the 2.5D depth mask from reaching the play realm and no shipped build.
   * Absent ⇒ a project that declared nothing.
   */
  runtime?: RuntimeProjectConfig;
  /** Hot-update delivery baked into game.config.json: the CDN root `remote`-group
   *  assets resolve against + the storage key an applied update persists under.
   *  The addressable `asset-manifest.json` this export always emits enables it. */
  hotUpdate?: { remoteRoot?: string; persistUpdateKey?: string };
  /** The export profile this build was made with, recorded in its size history. */
  profile?: string;
  /** Signing key files the project names, checked against its repository. */
  secretFiles?: readonly string[];
  /** iOS: where the prebuilt engine + app shell live, so the export can wrap
   *  itself in an Xcode project. Omitted (or null) exports content only. */
  iosSources?: IosProjectSources | null;
  /** Android: the installed runtime template the package is assembled from —
   *  which carries every architecture it will ship. Omitted (or null) exports
   *  content only. */
  androidTemplate?: string | null;
  /** Desktop: every installed runtime template, resolved by the caller — one app
   *  is assembled per entry. Not filtered to the building machine's OS: assembly
   *  is pure Node, and a Steam upload wants all of them. Empty exports content
   *  only. */
  desktopTemplates?: { os: DesktopOs; dir: string }[];
  /** Desktop: where this build goes (`packaging.platforms.desktop.channel`).
   *  Absent ⇒ standalone, which writes the app and nothing else. */
  desktopChannel?: DesktopPackaging['channel'];
  /** Desktop, Steam channel: what only the partner backend can tell you. */
  steam?: SteamPackaging;
  /**
   * What an Android export produces. 'package' assembles the APK (and the App
   * Bundle beside it when asked); 'project' writes an Android Studio project the
   * game is built from instead — the same trade the iOS export has always made,
   * and the only route for a game that has to add an SDK of its own.
   */
  androidOutput?: 'package' | 'project';
  /** Android: the release identity a shipping build (`minify`) is signed with.
   *  A development build, or a shipping one without it, uses the development key,
   *  which installs on a device and is refused by every store. Read only when a
   *  shipping build needs it, so a development build asks for no passphrase. */
  androidKey?: SigningKey | (() => SigningKey);
  /** The app's launcher icon (project-relative). Omitted ⇒ the template's default. */
  appIcon?: string;
  /** `packaging.sizeBudget[platform]` — the project's own package-size ceiling in
   *  bytes, replacing whatever limit the target declares. See sizeBudget.ts. */
  sizeBudgetBytes?: number;
  /** How the page's start screen should look; see SplashPackaging. */
  splash?: ProjectPackaging['splash'];
}

/**
 * Export the open project for `platform` (default web). Every target's package is
 * WEIGHED here, the one point they all pass through: measuring inside each early-
 * returning pipeline would be accountings that drift, and a platform a project
 * defines for itself would have none. See sizeReport.ts for what is counted.
 */
export async function exportGame(opts: ExportGameOptions): Promise<ExportGameResult> {
  const result = await attachSizeReport(await produceExport(opts), opts);
  const exposed = committableSecrets(opts.root, opts.secretFiles ?? []);
  return exposed.length > 0 ? { ...result, warnings: [...result.warnings, ...exposed] } : result;
}

/**
 * Signing keys a commit of the project would publish: inside it, and either
 * tracked or not ignored. A project that is not a git checkout says nothing,
 * since there is no repository to leak into.
 */
export function committableSecrets(root: string, files: readonly string[]): string[] {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (files.length === 0 || git('rev-parse', '--is-inside-work-tree').stdout.trim() !== 'true') return [];
  const out: string[] = [];
  for (const file of files) {
    const abs = path.resolve(root, file);
    if (!isInsideRoot(root, abs) || !existsSync(abs)) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (git('ls-files', '--error-unmatch', '--', rel).status === 0) {
      out.push(`The signing key ${rel} is committed to the project's repository: anyone with the repository can sign as you. Move it out of the project and remove it from git history.`);
    } else if (git('check-ignore', '-q', '--', rel).status !== 0) {
      out.push(`The signing key ${rel} is in the project and not ignored, so the next commit of everything would publish it. Move it out of the project, or add it to .gitignore.`);
    }
  }
  return out;
}

/**
 * The size limits an ad network's profile imposes, in the shape every target
 * states one.
 *
 * The playable profile predates this vocabulary and spells its cap
 * `maxBytes` + `limitNote`; a project's own network profile
 * (`.esengine/platforms/<id>.mjs`) is written against those names, so they stay
 * as the network's contract and are translated here — one conversion, rather
 * than a second shape for the rest of the editor to know about.
 */
function playableBudgets(profile: PlayableAdProfile | undefined): readonly SizeBudget[] {
  // The SAME fallback the playable pipeline picks when no network was chosen
  // (the strictest cap we know of), taken from the one place it is declared —
  // resolving it separately here is how the reported limit and the enforced one
  // drift apart.
  const resolved = profile ?? genericPlayableProfile;
  return [{ scope: 'deliverable', maxBytes: resolved.maxBytes, note: resolved.limitNote }];
}

/**
 * Weigh what the export produced, and judge it against the limits in force.
 *
 * Measures the PAYLOAD. A failed export is not measured: half a package has no
 * meaningful size, and a number next to an error reads as if the build were fine.
 */
async function attachSizeReport(result: ExportGameResult, opts: ExportGameOptions): Promise<ExportGameResult> {
  if (!result.ok) return result;
  // Packages written inside the output dir: each repackages content that is also
  // there loose, and the one a store/network takes is the deliverable the limit
  // applies to. The playable ships its single file as index.html unless a zip
  // was written for a zip-delivery network.
  const desktopApps = result.appBundles ?? [];
  const packages = [result.apkFile, result.aabFile, result.zipFile, result.packageFile, ...desktopApps.map((a) => a.dir)]
    .filter((p): p is string => !!p);
  // Desktop makes one package per OS; the limit is judged on the one this machine
  // could run, falling back to the first, because a per-OS budget would be a
  // different setting and none of the three is "the" upload.
  const desktopApp = desktopApps.find((a) => a.os === desktopTemplateFor(process.platform))
    ?? desktopApps[0];
  const deliverable = result.platform === 'playable'
    ? result.zipFile ?? path.join(result.outDir, 'index.html')
    : result.packageFile ?? result.apkFile ?? result.aabFile ?? desktopApp?.dir;
  try {
    const size = await measureBuild({
      root: result.outDir,
      platform: result.platform,
      profileBudgets: opts.miniGameProfile?.sizeBudgets
        ?? (result.platform === 'playable' ? playableBudgets(opts.playableAdProfile) : undefined),
      projectMaxBytes: opts.sizeBudgetBytes,
      deliverable,
      packages,
      subPackageRoots: result.subPackageRoots,
      inlineOf: result.inlineParts ? { file: 'index.html', parts: result.inlineParts } : undefined,
      splashBytes: result.splashBytes,
      inclusion: result.inclusion,
      packedFrom: result.packedFrom,
      // The project, not the build: what this target weighed last time lives with
      // the project, and the settings ride along so a compression change is not
      // read as content that grew.
      history: {
        projectRoot: opts.root,
        settings: sizeSettingsOf(opts),
      },
    });
    return { ...result, size, inclusion: undefined };
  } catch {
    return { ...result, inclusion: undefined };  // measuring is reporting, never a reason to fail a build
  }
}

async function produceExport(opts: ExportGameOptions): Promise<ExportGameResult> {
  const platform = opts.platform ?? 'web';
  const title = opts.title ?? 'Game';
  // One orientation for every target; default landscape (the engine's 1920×1080 Canvas
  // aspect) so a caller that omits it still ships consistently. The IPC handler resolves
  // it from the manifest (explicit setting, else the design resolution's aspect).
  const orientation: ScreenOrientation = opts.orientation ?? 'landscape';
  // One derivation of the project's settings, forwarded whole. Every target used
  // to take them as loose fields and each one had to remember the same list.
  const runtime = opts.runtime ?? DEFAULT_RUNTIME_CONFIG;
  const progress = opts.onProgress ?? (() => {});
  const debugChannel = packagedDebugChannel(opts);
  const scenes = await discoverProjectScenes(opts.root, opts.entryScene, opts.scenesDir, opts.excludeScenes);

  // Cutting a world is part of the common cook below, which the three pipelines
  // that follow do not reach. Shipping an unstreamed world to them is a real
  // difference in what the package IS, so it is said rather than discovered.
  // The three pipelines below return before the common cook that cuts a world,
  // so shipping one to them builds fine and delivers the whole thing — a
  // declaration the runtime never receives. Refused rather than warned about.
  const streamed = await streamedScenes(opts.root, scenes);
  const refuseStreamedWorld = (target: string): never => {
    throw new Error(
      `${streamed.join(', ')} declares a streamed world, and ${target} cannot ship one: `
      + 'world cells are cooked for web, desktop, android and ios. Export one of those, '
      + 'or remove StreamedWorld to ship this target with the world loaded whole.',
    );
  };

  // A platform the editor does not ship: the project supplied an export profile
  // (.esengine/platforms/<id>.mjs, loaded by the main process since it carries
  // functions). It rides the same vendor-neutral mini-game pipeline WeChat does
  // — that pipeline taking a profile is exactly what makes this possible.
  if (opts.miniGameProfile) {
    if (streamed.length > 0) refuseStreamedWorld('a mini-game package');
    return await exportMiniGame(opts.miniGameProfile, {
      root: opts.root,
      entryScene: opts.entryScene,
      scenes,
      scriptsEntry: opts.scriptsEntry,
      sdkDir: opts.sdkDistDir,
      wasmDir: opts.wasmDir,
      outDir: opts.outDir,
      hostsDir: opts.hostsDir,
      packagesDir: opts.packagesDir,
      title,
      appid: opts.miniGameAppid,
      appVersion: opts.appVersion,
      versionCode: opts.miniGameVersionCode,
      appIcon: opts.appIcon,
      releaseKey: opts.miniGameReleaseKey,
      features: opts.features,
      modulesByPlatform: opts.modulesByPlatform,
      orientation,
      runtime,
      minify: opts.minify,
      debugChannel: opts.debugChannel,
      hotUpdate: opts.hotUpdate,
      emcc: opts.emcc,
      aotMode: opts.aotMode,
      contentAddressed: opts.contentAddressed,
      compressTextures: opts.compressTextures,
      compressAudio: opts.compressAudio,
      atlasTextures: opts.atlasTextures,
      compressWasm: opts.compressWasm,
      engineSubpackage: opts.engineSubpackage,
      onProgress: opts.onProgress,
    });
  }

  // WeChat has no import maps + a different module/asset model → its own pipeline.
  // A table, not a branch per vendor: adding one is a profile object, which is
  // the promise miniGameExportProfile makes and a `platform === …` chain drops.
  const builtinMiniGame = BUILTIN_MINIGAME_PROFILES[platform];
  if (builtinMiniGame) {
    if (streamed.length > 0) refuseStreamedWorld(`the ${builtinMiniGame.id} package`);
    return await exportMiniGame(builtinMiniGame, {
      root: opts.root,
      entryScene: opts.entryScene,
      scenes,
      scriptsEntry: opts.scriptsEntry,
      sdkDir: opts.sdkDistDir,
      wasmDir: opts.wasmDir,
      outDir: opts.outDir,
      hostsDir: opts.hostsDir,
      packagesDir: opts.packagesDir,
      title,
      appid: opts.miniGameAppid,
      appVersion: opts.appVersion,
      versionCode: opts.miniGameVersionCode,
      appIcon: opts.appIcon,
      releaseKey: opts.miniGameReleaseKey,
      features: opts.features,
      modulesByPlatform: opts.modulesByPlatform,
      orientation,
      runtime,
      minify: opts.minify,
      debugChannel: opts.debugChannel,
      hotUpdate: opts.hotUpdate,
      emcc: opts.emcc,
      aotMode: opts.aotMode,
      contentAddressed: opts.contentAddressed,
      compressTextures: opts.compressTextures,
      compressAudio: opts.compressAudio,
      atlasTextures: opts.atlasTextures,
      compressWasm: opts.compressWasm,
      engineSubpackage: opts.engineSubpackage,
      onProgress: opts.onProgress,
    });
  }

  // Playable ads are a single inlined HTML (SINGLE_FILE glue + base64 assets).
  if (platform === 'playable') {
    if (streamed.length > 0) refuseStreamedWorld('a playable ad (one inlined file)');
    return await exportPlayable({
      root: opts.root,
      entryScene: opts.entryScene,
      scriptsEntry: opts.scriptsEntry,
      hostsDir: opts.hostsDir,
      packagesDir: opts.packagesDir,
      sdkDir: opts.sdkDistDir,
      wasmDir: opts.wasmDir,
      outDir: opts.outDir,
      title,
      orientation,
      minify: opts.minify,
      features: opts.features,
      modulesByPlatform: opts.modulesByPlatform,
      runtime,
      adProfile: opts.playableAdProfile,
      onProgress: opts.onProgress,
    });
  }

  // Everything past here is the web / desktop / native pipeline. An id that is
  // none of those and brought no profile is a typo or an unloaded project
  // platform, and packaging it as a web game would hand back the wrong package.
  if (!(BUILTIN_PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error(
      `"${platform}" is not a platform this export knows: the built-ins are ${BUILTIN_PLATFORMS.join(', ')},`
      + ' and a project platform arrives with its profile (loadProjectPlatform).',
    );
  }

  // path.resolve, not isAbsolute-or-join: on Windows `/Users/me/out` IS absolute
  // and yet names no DRIVE, so it survived that branch unchanged — and then each
  // consumer anchored it somewhere else. Node's fs took the current drive's root;
  // esbuild took its own working directory. The cook, the SDK tree and the html
  // landed in one place and `game.js` + `scripts.mjs` in another, and because
  // neither half FAILED the export reported ok with no errors: a package whose
  // index.html loads a script that is not in it. resolve() yields one
  // fully-qualified path for every consumer, anchors a relative one at the
  // project (which is what `dist-game` has always meant), and leaves a properly
  // drive-qualified absolute path alone.
  const absOut = path.resolve(opts.root, opts.outDir);
  // Every target writes its payload at the top level, desktop included: it is a
  // native target, so what it writes is content.
  const payloadDir = absOut;
  // The native app carries the runtime in its binary (engine core + SDK bundle),
  // so its export is CONTENT: cooked assets, manifests, scenes, config — no host
  // page, no SDK/wasm tree, and project scripts as a plain script the host evals.
  // iOS and Android write the SAME payload — what differs is the toolchain that
  // wraps it — so this asks what KIND of target it is, not which one.
  const nativeContent = isNativePlatform(platform);
  const warnings: string[] = [];
  const errors: string[] = [];
  /** iOS: set once the project is written around the content (see below). */
  let xcodeProject: string | undefined;
  let appId: string | undefined;
  let androidProject: string | undefined;
  let apkFile: string | undefined;
  let aabFile: string | undefined;
  /** Desktop: one assembled app per desktop OS a template is installed for. */
  let appBundles: { os: DesktopOs; dir: string }[] = [];
  /** Desktop, Steam channel: the per-build checklist written beside the scripts. */
  let steamChecklist: string | undefined;
  await mkdir(payloadDir, { recursive: true });
  // One answer for the whole package: the bundles esbuild writes here and the
  // SDK tree copied in beside them.
  const sourceMaps = opts.sourcemap ?? false;
  const common: BuildOptions = {
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    external: ESENGINE_EXTERNAL,
    plugins: [officialPackagesPlugin(opts.packagesDir)],
    minify: opts.minify ?? false,
    sourcemap: sourceMaps,
    write: true,
    logLevel: 'silent',
    // A package installs the subpaths its own scripts import, and esbuild
    // already knows which bare specifiers it left external.
    metafile: true,
  };

  // 1. Cook reachable assets + manifest, from EVERY shippable scene as a root
  //    (the scene files themselves are staged too).
  progress({ phase: 'Cooking assets' });
  // Video ships as MPEG-1 `.esv` for every target whose only decoder is the
  // pl_mpeg path — a device (native) and WeChat both play video through it, so
  // both need the cook. Browser/Chromium targets (web, desktop) decode the source
  // container directly and keep it. Without this a device shows a blank frame: it
  // cannot decode an .mp4.
  const transcodeVideo = isNativePlatform(platform) || platform === 'wechat';
  // Optional native modules the PROJECT supplies (.esengine/modules/<id>/), resolved
  // for this target before anything is staged — their ids ride game.config.json, so
  // the runtime can acquire them exactly like the engine's own.
  const projectModules = await loadProjectModules(opts.root, platform);
  const cook = await cookAssets(opts.root, { entryScenes: scenes.map((s) => s.path), outDir: payloadDir, contentAddressed: opts.contentAddressed ?? true, compressTextures: opts.compressTextures, compressAudio: opts.compressAudio, atlasTextures: opts.atlasTextures, transcodeVideo, platform, textureDecoderBytes: textureDecoderBytes(opts.wasmDir) });
  warnings.push(...cook.warnings);
  // An asset the game reaches and the cook could not produce is a hole, not a
  // note: the scene still references it and the runtime 404s at boot.
  for (const f of cook.failed) errors.push(`asset not packaged — ${f}`);
  warnings.push(...await unsupportedContentWarnings(opts.root, cook.includedPaths, platform));
  progress({ phase: 'Cooking assets', detail: `${cook.included.length} reachable` });

  // What the cook physically staged, read before the flat manifest is dropped
  // below: the side-module scan asks it what the package carries, and a texture
  // compressed to KTX2 or a video transcoded to .esv is only nameable here.
  let cookEntries: CookManifest['entries'] = [];
  try {
    cookEntries = (JSON.parse(
      await readFile(path.join(payloadDir, 'assets.manifest.json'), 'utf8'),
    ) as CookManifest).entries;
  } catch (err) {
    errors.push(`cook manifest: ${err instanceof Error ? err.message : String(err)}`);
  }

  /** What the host must import, or null when this build has no project code. */
  let scriptsFile: string | null = null;
  /** The `esengine/*` specifiers the bundles above left for the import map. */
  const scriptImports = new Set<string>();

  // Also emit the AddressableManifest (v2.0) beside the flat one — the SAME
  // model every target now shares, so `loadGroup` / remote-group / hot-update
  // work on web + desktop too (not just mini-games). Additive: the eager boot
  // still reads the flat manifest; this powers on-demand + hot-update delivery.
  await writeFile(path.join(payloadDir, 'asset-manifest.json'), await buildAddressableManifest(payloadDir));
  // A scene that declared itself streamed is cut here, once its assets are staged
  // and its references are in the form the runtime resolves. The entry scene it
  // leaves behind is the PERSISTENT world; the places arrive by residency.
  progress({ phase: 'Cutting worlds' });
  const world = await cookWorlds(opts.root, payloadDir, scenes);
  warnings.push(...world.warnings);
  // The flat manifest is a build-time intermediate: the addressable one above is
  // derived from it, and every runtime now reads only that. Dropping it keeps one
  // asset model in the package — the mini-game export has always done this.
  await rm(path.join(payloadDir, 'assets.manifest.json'), { force: true });

  const hotUpdate = await packagedHotUpdate(opts.root, opts.hotUpdate);

  // What wasm this project's content pulls in — evidence for the plan below, and
  // the filter the runtime tree is copied through further down.
  const sideModuleIds = !nativeContent && existsSync(opts.wasmDir)
    ? await scanSideModuleIds({
      root: opts.root, includedPaths: cook.includedPaths, cookEntries,
      stagedDir: payloadDir,
      // One path for old and new: moduleChoices reads `physics.enabled` as an
      // include, so the legacy flag arrives here as the choice it always meant.
      forced: forcedSideModules(moduleChoices(opts.features, opts.modulesByPlatform?.[platform])),
    })
    : [];
  /** The subpaths this package installs, and whether a lean entry can carry it.
   *  Set on the browser path once the project's own imports are known. */
  let plan: EngineInstallPlan = { lean: false, subpaths: [], refused: [] };
  try {
    const { build } = await loadEsbuild();
    // 2. Project bundle (defineComponent/defineSystem). ESM with `esengine`
    //    external on the web; on native an IIFE the host evals. Before the host,
    //    because what it imports is evidence for the plan below.
    const scriptsAbs = opts.scriptsEntry ? path.join(opts.root, opts.scriptsEntry) : null;
    if (scriptsAbs && existsSync(scriptsAbs)) {
      scriptsFile = nativeContent ? 'scripts.js' : 'scripts.mjs';
      progress({ phase: 'Bundling project scripts' });
      const proj = nativeContent
        ? await build({
          ...common, format: 'iife', external: [],
          plugins: [esengineGlobalPlugin(), officialPackagesPlugin(opts.packagesDir)],
          entryPoints: [scriptsAbs], outfile: path.join(payloadDir, 'scripts.js'),
        })
        : await build({ ...common, entryPoints: [scriptsAbs], outfile: path.join(payloadDir, 'scripts.mjs') });
      errors.push(...explainBundleErrors(proj.errors));
      for (const spec of externalEngineImports(proj.metafile)) scriptImports.add(spec);
    }
    // 3. Game host — esengine EXTERNAL (resolved by the index.html import map),
    //    so the shipped game shares one SDK with the project bundle and runs
    //    custom systems (same shape as the play realm).
    if (!nativeContent) {
      plan = engineInstalls({
        subsystems: (await contentSubsystems(opts.root, cook.includedPaths)).keys(),
        assetPaths: cook.includedPaths,
        sideModuleIds,
        scriptImports,
        choices: moduleChoices(opts.features, opts.modulesByPlatform?.[platform]),
        debugChannel: !!debugChannel,
      });
      // A package missing half a scene, with nothing saying which half, is worse
      // than one that refuses to be made.
      for (const r of plan.refused) {
        errors.push(`${r.specifier} is excluded in Project Settings, and this build uses it — `
          + `${r.evidence}. Set it to Auto or Include, or take it out of the content.`);
      }
      progress({ phase: 'Bundling game host' });
      // An entry that IMPORTS what this package installs, then the host. Staging
      // a subpath only lets the page resolve it; a subsystem is installed by
      // something importing it, and on a lean entry nothing else does.
      const hostEntry = runtimeHostEntry(opts.hostsDir, 'gameHost');
      const host = await build({
        ...common,
        stdin: {
          contents: plan.subpaths.map((m) => `import ${JSON.stringify(m)};\n`).join('')
            + `import ${JSON.stringify(hostEntry)};\n`,
          resolveDir: path.dirname(hostEntry),
          loader: 'js',
          sourcefile: 'game-entry.js',
        },
        outfile: path.join(payloadDir, 'game.js'),
      });
      errors.push(...explainBundleErrors(host.errors));
    }

  } catch (err) {
    const e = err as { errors?: BundleMessage[]; message?: string };
    errors.push(...(e.errors ? explainBundleErrors(e.errors) : [String(e.message ?? err)]));
    return { ok: false, platform, outDir: absOut, included: cook.included.length, warnings, errors };
  }

  /** The desktop apps this export will assemble that this machine cannot make a
   *  compiled module for. Empty means every one of them is this machine. */
  function foreignDesktopOses(templates: { os: DesktopOs }[] | undefined): DesktopOs[] {
    const here = desktopTemplateFor(process.platform);
    return (templates ?? []).map((t) => t.os).filter((os) => os !== here);
  }

  // 3b. Compiled systems. Which machine they are built for is `compileTargetFor`,
  //     because the build dialog looks for the same compiler this does, before
  //     an export starts.
  let aot: PackagedGameConfig['aot'];
  const aotTarget = compileTargetFor(platform);
  const foreignOs = aotTarget === 'native' ? foreignDesktopOses(opts.desktopTemplates) : [];
  if (aotTarget !== null && foreignOs.length > 0) {
    // A compiled system is machine code for ONE machine, and this assembles an
    // app per installed template. Half a package with AOT is worse than a
    // uniform one, so nothing is compiled and the build says why.
    warnings.push('Compiled systems were left out: this build also assembles '
      + `${foreignOs.join(' and ')}, and a compiled system is machine code for one machine. `
      + `Export on the machine you are targeting, or install only its runtime template.`);
  } else if (aotTarget !== null) {
    // An export is not the editor's preview: here a `@compiled` marker is a
    // promise someone is collecting on, so a promise the subset cannot keep
    // fails the build rather than quietly falling back to the interpreter.
    const built = await buildCompiledSystems(opts.root, {
      mode: opts.aotMode ?? 'release',
      target: aotTarget,
      cc: aotTarget === 'native' ? findHostCC() : resolveEmcc(opts.emcc),
      run: runEmcc,
    });
    if (!built.ok) {
      errors.push(...built.errors);
      return { ok: false, platform, outDir: absOut, included: cook.included.length, warnings, errors };
    }
    if (built.modulePath && built.manifest) {
      progress({ phase: 'Compiling systems', detail: `${built.manifest.systems.length} system(s)` });
      const name = path.basename(built.modulePath);
      await mkdir(path.join(payloadDir, 'aot'), { recursive: true });
      await cp(built.modulePath, path.join(payloadDir, 'aot', name));
      aot = { module: `aot/${name}`, manifest: built.manifest };
    }
  }

  // 4. SDK (import-map target) + wasm runtime. A missing tree fails the export
  //    rather than degrading it. What ships is derived from THIS package's
  //    import map: a game with no tilemap ships no tilemap.
  let engineMap = FULL_IMPORT_MAP;
  if (!nativeContent) {
    // Only when the SDK build actually produced one: a tree without it (an older
    // dist, a test fixture) falls back to the whole entry rather than pointing
    // `esengine` at a file that is not there.
    const hasLean = existsSync(path.join(opts.sdkDistDir, LEAN_ENTRY_FILE));
    engineMap = plan.lean && hasLean
      ? engineImportMap(LEAN_ENTRY_FILE, plan.subpaths)
      : engineImportMap(FULL_ENTRY_FILE, Object.keys(ESENGINE_SUBPATHS));

    progress({ phase: 'Copying SDK + runtime' });
    if (existsSync(opts.sdkDistDir)) {
      await cp(opts.sdkDistDir, path.join(payloadDir, 'sdk'), {
        recursive: true, filter: shipsToBrowser(sourceMaps, opts.sdkDistDir, engineMap.entries),
      });
      if (!sourceMaps) await dropSourceMapRefs(path.join(payloadDir, 'sdk'));
    } else errors.push(`sdk dist not found: ${opts.sdkDistDir}`);
    if (existsSync(opts.wasmDir)) {
      const { files, unknown } = sideModuleFiles(sideModuleIds);
      for (const id of unknown) errors.push(`internal: no artifact mapping for side module "${id}"`);
      for (const { id, file } of files) {
        if (!existsSync(path.join(opts.wasmDir, `${file}.js`))) {
          errors.push(`content needs "${id}" but ${file}.js is not in ${opts.wasmDir} — build the target that produces it (build-tools/build.config.js maps artifacts to targets) and re-export.`);
        }
      }
      await cp(opts.wasmDir, path.join(payloadDir, 'wasm'), {
        recursive: true, filter: shipsSideModule(files.map((f) => f.file)),
      });
    } else errors.push(`wasm runtime dir not found: ${opts.wasmDir}`);
  }

  // The project's own modules go beside the engine's, so every transport finds
  // all of them in the one place it already looks. Outside the branch above
  // because a native target must still be TOLD its modules cannot ship there —
  // it stages nothing and says so.
  warnings.push(...await stageProjectModules(projectModules, path.join(payloadDir, 'wasm'), platform));

  // 5. Host page + entry-scene config. Only where a BROWSER boots the game: a
  //    native target has no page, and saying it wrote one is a progress line that
  //    reports work nothing did.
  let splashBytes: number | undefined;
  if (!nativeContent) {
    progress({ phase: 'Writing host page' });
    const look = await splashLook(opts.root, opts.splash, warnings);
    splashBytes = Buffer.byteLength(splashCss(look.background ?? PAGE_BACKGROUND) + splashHtml(title, look));
    await writeFile(
      path.join(payloadDir, 'index.html'),
      indexHtml(title, engineMap, look, platform === 'web' ? orientation : undefined, debugChannel),
    );
  }
  // Typed against the SDK's contract, so a field the runtimes read can never be
  // spelled differently here — the two sides share one declaration.
  const gameConfig: PackagedGameConfig = {
    entryScene: opts.entryScene, scenes,
    ...(scriptsFile ? { scripts: scriptsFile } : {}),
    ...packagedRuntimeFields(runtime),
    ...(hotUpdate ? { hotUpdate } : {}),
    ...(sideModuleDeclarations(projectModules, platform).length > 0
      ? { sideModules: sideModuleDeclarations(projectModules, platform) } : {}),
    ...(aot ? { aot } : {}),
    ...(world.worlds.length > 0 ? { worlds: world.worlds } : {}),
    ...(debugChannel ? { debugChannel } : {}),
    ...(existsSync(path.join(payloadDir, 'wasm', 'esengine.wasm'))
      ? { engineBytes: statSync(path.join(payloadDir, 'wasm', 'esengine.wasm')).size } : {}),
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
      // The desktop override predates this path as electron-builder's
      // productName; it means the same thing a bundle's CFBundleName does, so it
      // keeps working and now names the .app itself.
      name: (platform === 'desktop' && opts.desktopProductName) || title,
      version: opts.appVersion ?? '1.0',
      versionCode: opts.androidVersionCode ?? 1,
      orientation,
      allowHttp: !opts.minify,
    };
    await writeFile(path.join(payloadDir, 'app.config.json'), JSON.stringify(appConfig, null, 2) + '\n');
    appId = appConfig.id;
    const http = cleartextWarning(platform, !!opts.minify, hotUpdate?.remoteRoot);
    if (http) warnings.push(http);

    // One icon for both targets, read once. A path that no longer exists is a
    // warning rather than a failed export: the package is still correct, it just
    // carries the default mark.
    let icon: Buffer | undefined;
    if (opts.appIcon) {
      const file = path.join(opts.root, opts.appIcon);
      if (existsSync(file)) icon = await readFile(file);
      else warnings.push(`The app icon ${opts.appIcon} does not exist — packaged with Estella's default.`);
    }

    // Both mobile targets finish the job here, out of the installed runtime
    // template: assembling an app is copying files and writing two formats, so it
    // belongs in the export rather than behind a command the user has to find. An
    // install with no template still exports its content, and says so.
    if (platform === 'ios') {
      progress({ phase: 'Writing Xcode project' });
      const sources = opts.iosSources ?? null;
      if (sources) {
        const projectDir = await emitIosXcodeProject(absOut, appConfig, sources, undefined, icon);
        xcodeProject = projectDir;
      } else {
        warnings.push('No iOS runtime template is installed for this editor version, so no Xcode '
          + 'project was written — the content is here. Install one from the iOS row in Package '
          + 'Project, then export again.');
      }
    }

    if (platform === 'desktop') {
      // One app per installed template, whichever OS is doing the building: the
      // assembler is pure Node, so a Steam upload can carry every OS from one
      // machine (docs/REARCH_STEAM.md §6.3).
      const templates = opts.desktopTemplates ?? [];
      let steamLibrary = false;
      if (templates.length === 0) {
        warnings.push('No desktop runtime template is installed for this editor version, so no app '
          + 'was assembled — the content is here. Install one from the Desktop row in Package '
          + 'Project, then export again.');
      }
      for (const { os, dir } of templates) {
        progress({ phase: `Assembling the ${os} app` });
        const built = await assembleDesktopApp({
          platform: os, templateDir: dir, contentDir: absOut, outDir: absOut, app: appConfig,
          iconPng: opts.appIcon ? path.join(opts.root, opts.appIcon) : undefined,
          steamSdkDir: opts.steam?.sdkPath,
          warn: (m: string) => warnings.push(m),
        });
        appBundles.push({ os, dir: built.dir });
        steamLibrary ||= built.steamLibrary !== null;
        // Silence is the failure mode: with no library the game runs, every unlock
        // reaches nobody, and nothing reports it until a player does.
        if (opts.desktopChannel === 'steam' && !built.steamLibrary) {
          warnings.push(`The ${os} build carries no Steam library, so it reaches no store: `
            + 'achievements are recorded locally and nothing else. Point Project Settings → '
            + 'Packaging → Steamworks SDK at your own SDK download.');
        }
      }
      if (opts.desktopChannel === 'steam' && appBundles.length > 0) {
        const appId = opts.steam?.appId;
        if (!appId) {
          warnings.push('The Steam channel is selected but no App ID is set (Project Settings → '
            + 'Packaging → Desktop), so no depot scripts were written — scripts built around a '
            + 'guessed id would name someone else\'s game.');
        } else {
          progress({ phase: 'Writing the Steam build scripts' });
          // A depot for each app that was actually assembled. Naming an OS whose
          // app is not there uploads an empty depot and reports success.
          const emitted = await emitSteamBuild({
            outDir: absOut,
            appId,
            appName: appConfig.name,
            description: opts.steam?.description,
            // The checklist is where a build says what the backend must be told AND
            // what this package can actually reach.
            achievements: opts.runtime?.achievements,
            steamLibrary,
            depots: appBundles.map(({ os }) => ({
              os, depotId: opts.steam?.depots?.[os] ?? defaultDepotId(appId, os),
            })),
          });
          steamChecklist = emitted.checklist;
        }
      }
    }

    if (platform === 'android') {
      const template = opts.androidTemplate ?? null;
      const wantsProject = opts.androidOutput === 'project';
      if (!template) {
        warnings.push(`No Android runtime template is installed for this editor version, so no ${
          wantsProject ? 'project was written' : 'APK was assembled'} — the content is here. `
          + 'Install one from the Android row in Package Project, then export again.');
      } else if (wantsProject) {
        progress({ phase: 'Writing Android Studio project' });
        androidProject = await emitAndroidGradleProject(
          absOut, appConfig, androidTemplateSources(template), icon);
      } else {
        progress({ phase: 'Assembling the APK' });
        const release = opts.minify && opts.androidKey
          ? (typeof opts.androidKey === 'function' ? opts.androidKey() : opts.androidKey) : null;
        const key = release ?? debugSigningKey();
        if (opts.minify && !opts.androidKey) {
          warnings.push('This shipping APK is signed with the development key, which Google Play refuses: '
            + 'set a release key under Project Settings → Android → Signing.');
        }
        const assembly = { templateDir: template, contentDir: absOut, app: appConfig, key, icon };
        apkFile = path.join(absOut, apkFileName(appConfig.id));
        await writeFile(apkFile, assembleApk(assembly));
        if (opts.androidAppBundle) {
          progress({ phase: 'Assembling the App Bundle' });
          aabFile = path.join(absOut, aabFileName(appConfig.id));
          await writeFile(aabFile, assembleAab(assembly));
        }
      }
    }
  }

  return {
    ok: errors.length === 0, platform, outDir: absOut, included: cook.included.length,
    inclusion: cook.inclusion,
    warnings, errors, ...(appId ? { appId } : {}), ...(xcodeProject ? { xcodeProject } : {}), ...(androidProject ? { androidProject } : {}),
    ...(apkFile ? { apkFile } : {}), ...(aabFile ? { aabFile } : {}),
    ...(appBundles.length > 0 ? { appBundles } : {}),
    ...(steamChecklist ? { steamChecklist } : {}),
    ...(splashBytes !== undefined ? { splashBytes } : {}),
  };
}
