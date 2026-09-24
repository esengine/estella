// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Per-vendor mini-game export profile.
 *
 * The export pipeline (exportMiniGame.ts) is shared by every mini-game vendor
 * (WeChat, Douyin, …): cook → manifest → scene transform → side-module scan →
 * bundle → emit config/entry → copy runtime. Only the vendor-specific emission
 * (config files, entry template) and the packaging suffix policy vary, and those
 * live here as DATA + two small emit hooks.
 *
 * Adding a vendor = one profile object, not a fork of the pipeline.
 */
import { WECHAT_MODULE_BUILD_TARGET } from '../bundle/sideModuleScan';
import type { RuntimeHost } from '../bundle/runtimeHosts';
import type { SizeBudget } from '../project/sizeBudget';
import { packRpk, type RpkSigningKey } from './rpk';
import { RPK_DEBUG_KEY } from './rpkDebugKey';
import { QUICKGAME_DEFAULT_ICON } from './quickgameDefaultIcon';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * A mini-game vendor's id. Open on purpose: the value is identity — the cook's
 * per-platform Import Settings key, the export result's `platform`, diagnostics
 * — and nothing in the pipeline branches on it, so a vendor the editor does not
 * ship can still be exported by handing {@link exportMiniGame} a profile.
 * Mirrors the SDK's `MiniGameVendor` (sdk/src/platform/minigame/api.ts).
 */
export type MiniGameVendor = 'wechat' | 'douyin' | 'kuaishou' | 'bilibili' | 'quickgame' | 'alipay' | 'huawei' | (string & {});

/** Vendor-neutral facts the pipeline computes, handed to the config emitter. */
export interface MiniGameConfigContext {
    title: string;
    appid: string;
    /** The project's version, for a host whose config asks for one. */
    version: string;
    /** The build ordinal a host compares to tell a newer package from an older one. */
    versionCode: number;
    /** The project's app icon (packaging.icon), or null when it has none. */
    icon: Uint8Array | null;
    orientation: 'portrait' | 'landscape';
    /** Lazy groups present in the cook, as vendor subpackage roots. */
    subPackages: ReadonlyArray<{ name: string; root: string }>;
    /** Custom suffixes the cook staged that need an explicit packer include rule. */
    includeSuffixes: string[];
    /** Whether this export actually bundled an open data context. Declaring one
     *  that is not there fails the host's compile, so the config names the
     *  directory only when the directory exists. */
    hasOpenData: boolean;
    /** Where it was bundled — {@link OPEN_DATA_DIR}, handed in rather than read
     *  from a constant so a project-authored profile emits the same name the
     *  pipeline actually wrote to. */
    openDataRoot: string;
    /** A development build that dials the editor: the host has to let a socket reach
     *  an address no domain list names. */
    debugChannel?: boolean;
}

/**
 * The directory an open data context is authored in and bundled to.
 *
 * A family constant, not vendor data: the hosts that have this capability let
 * the game pick the name, so the only thing a vendor could contribute is a
 * different arbitrary string. It is the same on both sides — `<project>/open-data/`
 * in, `<package>/open-data/` out — so there is one name to know.
 */
export const OPEN_DATA_DIR = 'open-data';

/**
 * The engine build EVERY mini-game host takes, and the `build -t` that makes it:
 * these runtimes load JS through `require`, and the browser artifact is an ES
 * module. The filename says WeChat only because WeChat came first — the glue
 * names no vendor API, so `wx` and `tt` run the same bytes.
 */
export const MINIGAME_ENGINE_GLUE: readonly string[] = ['esengine.wxgame.js', 'esengine.js'];
export const MINIGAME_ENGINE_BUILD = 'wechat';

/**
 * Whether this glue is the ES module build, which no mini-game host can load.
 *
 * Read off the artifact, not the filename — the filename is what was wrong.
 * Emscripten emits `export default` in an ESM build and never in a CommonJS one.
 */
export function isEsModule(glue: string): boolean {
    return /\bexport\s+default\b/.test(glue);
}

/** What a vendor that ships a single file is handed to make it. */
export interface MiniGamePackContext {
    /** The finished package directory. */
    outDir: string;
    /** The vendor's id for the game (for a quick game, its package name). */
    appid: string;
    /** The project's own signing key; absent ⇒ the build is signed for debugging. */
    releaseKey?: RpkSigningKey;
}

/** Vendor-neutral facts the pipeline computes, handed to the entry emitter. */
export interface MiniGameEntryContext {
    /** Optional modules the shipped scenes need (physics/spine/basis/videodec). */
    sideModules: ReadonlyArray<{ id: string; file: string }>;
    /** The engine glue filename staged into wasm/ (esengine.wxgame.js | esengine.js). */
    engineGlueFile: string;
    /** Package-relative directory those artifacts landed in, decided by the
     *  export's runtime layout. The entry asks for them WHERE THEY ARE. */
    runtimeDir: string;
    /** The host's API global (`wx` / `tt`), from the profile; null when the
     *  vendor did not say, in which case nothing is subpackaged. */
    hostGlobal: string | null;
    /** The 分包 holding the engine binary, when it is in one: the entry has to
     *  ask the host for it before booting, since the file is not in the package
     *  until then. Null when the binary ships in the main package. */
    engineSubpackage: string | null;
}

/**
 * The generated mini-game entry: require the engine glue + each side module,
 * then boot the bundle. Pure CommonJS with no vendor API in it — every host
 * loads JS the same way — so this is the family default, and a profile only
 * overrides it for an unusual loader.
 */
export function defaultMiniGameEntry(ctx: MiniGameEntryContext, load = 'require'): string {
    const requires = ctx.sideModules
        .map((m) => `  ${JSON.stringify(m.id)}: asFactory(${load}('./${ctx.runtimeDir}/${m.file}.js')),`)
        .join('\n');
    const boot = `const asFactory = (m) => (typeof m === 'function' ? m : (m && m.default) || m);
const engineFactory = asFactory(${load}('./${ctx.runtimeDir}/${ctx.engineGlueFile}'));
const sideModuleFactories = {
${requires}
};
const bundle = ${load}('./game-bundle.js');
// A boot that fails rejects; a host without onUnhandledRejection drops that
// silently, which leaves a device on the loading screen with nothing in the log.
Promise.resolve(bundle.boot(engineFactory, sideModuleFactories)).catch(function (e) {
  console.error('[estella] the game did not start: ' + ((e && (e.stack || e.message)) || e));
});`;
    if (!ctx.engineSubpackage) {
        // Before the bundle is REQUIRED: the runtime's own indicator cannot
        // cover a wait that ends when the runtime arrives. Guarded, like every
        // other call to it — an indicator must not take a boot down.
        const notice = ctx.hostGlobal
            ? `try { ${ctx.hostGlobal}.showLoading && ${ctx.hostGlobal}.showLoading({ title: 'Starting 0%', mask: true }); } catch (e) {}\n`
            : '';
        return `'use strict';
// Generated by Estella exportGame (MiniGame entry).
${notice}${boot}
`;
    }
    // The host fetches the engine binary before the bundle is parsed, so the
    // runtime's own indicator cannot cover this wait — and it is the one stage
    // with real byte progress. `showLoading` is OPTIONAL, hence `__say`.
    return `'use strict';
// Generated by Estella exportGame (MiniGame entry, engine in a subpackage).
var __g = ${ctx.hostGlobal};
var __say = function (t) { try { __g.showLoading && __g.showLoading({ title: t, mask: true }); } catch (e) {} };
__say('Fetching the engine 0%');
var __task = __g.loadSubpackage({
  name: ${JSON.stringify(ctx.engineSubpackage)},
  success() {
${boot.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n')}
  },
  fail(err) {
    try { __g.hideLoading && __g.hideLoading(); } catch (e) {}
    // Stringified: a vendor hands back an object, and a console line reading
    // "[object Object]" is the one place a device gives you to look.
    var __why = ''; try { __why = JSON.stringify(err); } catch (e) { __why = String(err); }
    console.error('[estella] the engine subpackage ${ctx.engineSubpackage} did not load — the game cannot start: ' + __why);
  },
});
// Optional on the host: a version without it leaves the 0% notice up, which is
// still a package that says it is doing something.
if (__task && __task.onProgressUpdate) {
  __task.onProgressUpdate(function (p) {
    __say('Fetching the engine ' + Math.round(p.progress || 0) + '%');
  });
}
`;
}

export interface MiniGameExportProfile {
    /** Vendor identity — the export result's `platform` + diagnostics. */
    readonly id: MiniGameVendor;
    /** SDK dist entry the bundle aliases `esengine` to (index.wechat.js). */
    readonly sdkEntryFile: string;
    /**
     * The same entry with no optional subsystems, when the vendor's SDK build has
     * one. An export that knows which subsystems its content uses takes this and
     * imports those back, so the package carries no others. Absent = always the
     * whole entry.
     */
    readonly sdkLeanEntryFile?: string;
    /** Runtime bootstrap fn imported from 'esengine' in the generated boot. */
    readonly runtimeInit: string;
    /**
     * An SDK export the generated entry CALLS before `runtimeInit` to install
     * the platform. A vendor whose SDK entry installs it as a module side
     * effect has no answer here that survives a bundler: the WeChat package
     * booted to "Platform not initialized" for exactly that reason.
     */
    readonly platformInit?: string;
    /** Engine glue filenames to look for in wasmDir, in preference order. */
    readonly engineGlueCandidates: readonly string[];
    /** esbuild target for the game bundle + glue down-level (real-device syntax floor). */
    readonly esTarget: 'es2016' | 'es2017' | 'es2019' | 'es2020';
    /** Build-target name woven into "runtime not found" errors (`build -t <hint>`). */
    readonly wasmBuildHint: string;
    /** side-module id → the `build -t <target>` that produces it for THIS vendor.
     *  The optional modules (physics/basis/videodec/spine) are built per vendor
     *  runtime, so the "module missing" guidance cannot be a shared constant. */
    readonly sideModuleBuildTargets: Readonly<Record<string, string>>;
    /** Extensions the packer handles natively (no packOptions.include needed). */
    readonly nativeSuffixes: ReadonlySet<string>;
    /**
     * Every extension this host's packer will UPLOAD; anything staged outside it
     * ships as `<name>.<ext>.bin` (`unwrapRestagedPath` reads through that).
     * Null ⇒ no published list, so the package is staged exactly as cooked.
     * A list, not the known failures: an upload rule refuses where nobody looks.
     */
    readonly packerSuffixes: ReadonlySet<string> | null;
    /**
     * The global this host exposes its API on: `wx` for WeChat, `tt` for Douyin.
     * Taking it from the profile keeps the shared entry free of any vendor's
     * name; null means nothing can be subpackaged, there being nothing to ask.
     */
    readonly hostGlobal: string | null;
    /**
     * Whether this vendor's loader takes a `.wasm.br` path — a CAPABILITY;
     * spending the build time is `packaging.compressWasm`. WeChat's
     * `WXWebAssembly.instantiate` accepts one from base library 2.14.0, a floor
     * documented rather than probed: the loader cannot be asked.
     */
    readonly wasmBrotli: boolean;
    /** Subpackage root prefix (files stage under `<subpackageDir>/<name>/`). */
    readonly subpackageDir: string;
    /**
     * The entry script a subpackage root must carry, or absent when the vendor
     * asks for none. WeChat refuses to compile a 分包 whose root has no
     * `game.js` — a root full of assets and no entry is not a subpackage to it,
     * and the message names the missing FILE rather than the rule.
     */
    readonly subpackageEntry?: string;

    /**
     * What this host refuses to accept — the main package cap, the all-in cap.
     *
     * Every mini-game host has these limits and each states them differently, so
     * they are DATA like everything else here: a vendor the editor does not ship
     * declares its own and the build dialog reports it exactly as it reports
     * WeChat's. Built-in vendors leave this absent — their limits are the
     * platform's rule, not the export's, and live in
     * `src/project/sizeBudget.ts` where the settings UI can read them without
     * loading an export profile.
     */
    readonly sizeBudgets?: readonly SizeBudget[];

    /**
     * Absolute path of a module whose DEFAULT EXPORT is the runtime
     * `MiniGameProfile` — the host global plus any capability this vendor
     * overrides (its own video decoder, audio backend, socket, wasm loader).
     *
     * A vendor has two halves: this file describes PACKAGING, and that module
     * describes the RUNTIME. The built-in WeChat entry installs its own platform
     * on import, so it needs none; a project platform boots through
     * `esengine/minigame`, which deliberately installs nothing until the game
     * names a host — so the generated entry installs this one before booting.
     * Absent ⇒ the game is expected to install a platform itself.
     */
    readonly runtimeProfileModule?: string;

    /**
     * The same thing for a BUILT-IN vendor, whose profile module ships with the
     * pipeline rather than living in a project: a name out of RUNTIME_HOSTS,
     * resolved against the export's hostsDir. Declaring the path directly would
     * be wrong in a packaged editor, which bundles those sources elsewhere.
     */
    readonly runtimeProfileHost?: RuntimeHost;

    /** Emit the vendor config files (game.json + project.config.json). */
    emitConfigFiles(ctx: MiniGameConfigContext): Array<{ file: string; content: string | Uint8Array }>;
    /**
     * Turn the finished directory into the one file the vendor takes, when it
     * takes a file (a quick game's signed `.rpk`). Absent ⇒ the directory is the
     * package, as a WeChat project is.
     */
    pack?(ctx: MiniGamePackContext): Promise<{ file: string; warnings: string[] }>;
    /** Emit the MiniGame entry the host runs (game.js). */
    emitEntry(ctx: MiniGameEntryContext): string;
}

// =============================================================================
// WeChat profile
// =============================================================================

/** WeChat's published code-package suffix whitelist (the "文件类型" table). */
const WECHAT_PACKER_SUFFIXES: ReadonlySet<string> = new Set(`png jpg jpeg gif svg js json cer obj dae fbx mtl stl 3ds mp3 pvr wav plist ttf fnt gz ccz m4a
    mp4 bmp atlas swf ani part proto bin sk mipmaps txt zip tt map ogg silk dbbin dbmv etc lmat lm
    ls lh lani lav lsani ltc aac astc br csv cur dat dds glb gltf ico ktx lmani lml pkm prefab
    scene wasm xml`.split(/\s+/).filter(Boolean));

export const wechatExportProfile: MiniGameExportProfile = {
    id: 'wechat',
    // The bundle aliases `esengine` → <sdkDir>/index.wechat.js (the wechat SDK build).
    sdkEntryFile: 'index.wechat.js',
    sdkLeanEntryFile: 'index.wechat.lean.js',
    runtimeInit: 'initWeChatRuntime',
    platformInit: 'initWeChatPlatform',
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // Real-device WeChat rejects es2020 syntax (`??`, `?.`) even though devtools
    // accepts it; es2017 down-levels those while keeping async/await.
    esTarget: 'es2017',
    wasmBuildHint: MINIGAME_ENGINE_BUILD,
    hostGlobal: 'wx',
    sideModuleBuildTargets: WECHAT_MODULE_BUILD_TARGET,
    // Script + config WeChat's packer compiles itself; every OTHER staged custom
    // extension needs a packOptions.include rule (fs reads are otherwise denied).
    nativeSuffixes: new Set(['.js', '.json']),
    // developers.weixin.qq.com/minigame/dev/guide/base-ability/code-package.html,
    // "文件类型": only these may be uploaded.
    packerSuffixes: WECHAT_PACKER_SUFFIXES,
    // developers.weixin.qq.com/minigame/dev/framework/performance/wasm.html:
    // `WXWebAssembly.instantiate(path)` takes 「.wasm 和 .wasm.br」 from base library
    // 2.14.0 — and a package whose engine is one, in a subpackage, plays in devtools.
    wasmBrotli: true,
    subpackageDir: 'subpackages',
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        const gameCfg: Record<string, unknown> = {
            deviceOrientation: ctx.orientation,
            showStatusBar: false,
        };
        // 开放数据域: named ONLY when this export bundled one. WeChat compiles
        // the directory the key points at, so declaring an absent context is a
        // build failure rather than a feature nobody uses.
        if (ctx.hasOpenData) {
            gameCfg.openDataContext = ctx.openDataRoot;
        }
        // WeChat 分包: each lazy group is a subpackage rooted at subpackages/<name>/.
        // The game calls Assets.loadGroup(name) → wx.loadSubpackage at runtime.
        if (ctx.subPackages.length > 0) {
            gameCfg.subPackages = ctx.subPackages.map((s) => ({ name: s.name, root: s.root }));
        }

        const projectCfg: Record<string, unknown> = {
            miniprogramRoot: './',
            projectname: ctx.title,
            appid: ctx.appid, // set in Project Settings → Packaging → WeChat (else fill in devtools)
            // bigPackageSizeSupport: devtools preview of a >4MB main package (upload
            // still enforces the limit — move heavy content to subpackages/ to ship).
            setting: {
                es6: false, minified: false, bigPackageSizeSupport: true,
                // DevTools refuses a socket to an unlisted address ("url not in domain
                // list"), and the editor is one: a LAN IP no console can register.
                ...(ctx.debugChannel ? { urlCheck: false } : {}),
            },
            compileType: 'game',
            ...(ctx.includeSuffixes.length > 0
                ? { packOptions: { include: ctx.includeSuffixes.map((value) => ({ type: 'suffix', value })) } }
                : {}),
        };

        return [
            { file: 'game.json', content: JSON.stringify(gameCfg, null, 2) + '\n' },
            { file: 'project.config.json', content: JSON.stringify(projectCfg, null, 2) + '\n' },
        ];
    },

    emitEntry: defaultMiniGameEntry,
};

// =============================================================================
// Douyin profile
// =============================================================================

/**
 * Douyin (抖音) as a packaging profile. No SDK entry of its own — it goes through
 * the door a project vendor uses, `runtimeProfileHost`. A packer whitelist,
 * `.wasm.br` and a host wasm loader stay off until a device settles them:
 * claiming one early builds clean and fails at upload or at boot.
 */
export const douyinExportProfile: MiniGameExportProfile = {
    id: 'douyin',
    sdkEntryFile: 'index.minigame.js',
    runtimeInit: 'initMiniGameRuntime',
    runtimeProfileHost: 'douyinPlatformProfile',
    // No Douyin-specific engine build — and no web one either: the mini-game
    // build is the family's, see MINIGAME_ENGINE_GLUE.
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // Same floor as WeChat until a device says otherwise — down-levelling costs
    // nothing and a syntax error on a phone costs a release.
    esTarget: 'es2017',
    wasmBuildHint: MINIGAME_ENGINE_BUILD,
    hostGlobal: 'tt',
    sideModuleBuildTargets: {},
    // Assumed to match WeChat, not read from a Douyin doc: script and config are
    // what a mini-game packer compiles itself everywhere this checkout has looked.
    // Wrong here means a staged file the runtime cannot read, on a device.
    nativeSuffixes: new Set(['.js', '.json']),
    // No published list this checkout can cite, so nothing is restaged: staging a
    // file under a name the packer does not take is the failure that only shows at
    // upload, and inventing the list would be that failure with extra steps.
    packerSuffixes: null,
    // Not claimed until a device says it: `.wasm.br` is WeChat's documented path,
    // and shipping only the compressed file to a host that cannot read it is a
    // package that builds clean and never boots.
    wasmBrotli: false,
    subpackageDir: 'subpackages',
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        const gameCfg: Record<string, unknown> = {
            deviceOrientation: ctx.orientation,
            showStatusBar: false,
        };
        if (ctx.subPackages.length > 0) {
            gameCfg.subPackages = ctx.subPackages.map((s) => ({ name: s.name, root: s.root }));
        }
        const projectCfg: Record<string, unknown> = {
            miniprogramRoot: './',
            projectname: ctx.title,
            appid: ctx.appid,
            compileType: 'game',
        };
        // `project.config.json`, the same name WeChat uses: the vendor's own CLI
        // (tt-minigame-ide-cli) and its Godot adaptation doc both name that file,
        // and nothing published names `project.tt.json`.
        return [
            { file: 'game.json', content: JSON.stringify(gameCfg, null, 2) + '\n' },
            { file: 'project.config.json', content: JSON.stringify(projectCfg, null, 2) + '\n' },
        ];
    },

    emitEntry: defaultMiniGameEntry,
};

// =============================================================================
// Kuaishou profile
// =============================================================================

/**
 * Kuaishou (快手), from open.kuaishou.com/miniGameDocs: `game.js` + `game.json`
 * and nothing else (the appid is entered in the developer tool), and `game.json`
 * spells `subpackages` lower-case. The host has no open data context.
 */
export const kuaishouExportProfile: MiniGameExportProfile = {
    id: 'kuaishou',
    sdkEntryFile: 'index.minigame.js',
    runtimeInit: 'initMiniGameRuntime',
    runtimeProfileHost: 'kuaishouPlatformProfile',
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // WeChat's floor, unconfirmed here: down-levelling costs nothing and a syntax
    // error on a phone costs a release.
    esTarget: 'es2017',
    wasmBuildHint: MINIGAME_ENGINE_BUILD,
    hostGlobal: 'ks',
    sideModuleBuildTargets: {},
    // Assumed to match WeChat and Douyin, not read from a Kuaishou doc; a wrong
    // guess is a staged file the runtime cannot read, on a device.
    nativeSuffixes: new Set(['.js', '.json']),
    // No published upload whitelist, so nothing is restaged — see Douyin's note.
    packerSuffixes: null,
    // The docs show `.wasm.br` only as the Unity converter's output; not claimed
    // for an engine that loads its own binary.
    wasmBrotli: false,
    subpackageDir: 'subpackages',
    // 「ks.loadSubpackage … 会自动 require 分包目录下的 game.js」
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        const gameCfg: Record<string, unknown> = { deviceOrientation: ctx.orientation };
        if (ctx.subPackages.length > 0) {
            gameCfg.subpackages = ctx.subPackages.map((s) => ({ name: s.name, root: s.root }));
        }
        return [{ file: 'game.json', content: JSON.stringify(gameCfg, null, 2) + '\n' }];
    },

    emitEntry: defaultMiniGameEntry,
};

// =============================================================================
// Bilibili profile
// =============================================================================

/** The upload whitelist, from the page's own `whiteList` array
 *  (miniapp.bilibili.com/small-game-doc/framework/structure). */
const BILIBILI_PACKER_SUFFIXES: ReadonlySet<string> = new Set(`png jpg jpeg gif svg js json cer obj dae fbx mtl stl 3ds mp3 pvr wav plist ttf fnt gz ccz m4a
    mp4 bmp atlas swf ani part proto bin sk mipmaps txt zip ogg silk dbbin dbmv etc lmat lm ls lh
    lani lav lsani ltc csv scene prefab lml lmani ktx dds xml wasm exml xtt fui webp`.split(/\s+/).filter(Boolean));

/**
 * Bilibili (B 站), from miniapp.bilibili.com/small-game-doc: `game.json` carries the
 * appid and version and spells `subpackages` lower-case. WebGL2 exists only in
 * high-performance mode (「仅在高性能模式下，支持运行 WebGL2.0 小游戏」), so all
 * four switches are always on — the engine renders on nothing less.
 */
export const bilibiliExportProfile: MiniGameExportProfile = {
    id: 'bilibili',
    sdkEntryFile: 'index.minigame.js',
    runtimeInit: 'initMiniGameRuntime',
    runtimeProfileHost: 'bilibiliPlatformProfile',
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // 「如果开发使用了 ES7 语法，特别是 async/await 的写法，必须在 game.js 开头引入
    // [regenerator]」: async/await is lowered to generators rather than trusted.
    esTarget: 'es2016',
    wasmBuildHint: MINIGAME_ENGINE_BUILD,
    hostGlobal: 'bl',
    sideModuleBuildTargets: {},
    // 「*.json、game.json 会经过编译」 — and `require` takes no .json at all.
    nativeSuffixes: new Set(['.js', '.json']),
    // miniapp.bilibili.com/small-game-doc/framework/structure, 「只有后缀名在白名单内的文件可以被上传」.
    packerSuffixes: BILIBILI_PACKER_SUFFIXES,
    // 「平台暂不支持Wasm Brotli压缩」 (the Cocos build note).
    wasmBrotli: false,
    subpackageDir: 'subpackages',
    // WeChat's rule, assumed here: the docs name loadSubpackage but not what a
    // root must hold, and a root without game.js is refused on WeChat.
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        const gameCfg: Record<string, unknown> = {
            version: ctx.version,
            appId: ctx.appid,
            deviceOrientation: ctx.orientation,
            showStatusBar: false,
            iOSHighPerformance: true,
            'iOSHighPerformance+': true,
            androidHighPerformance: true,
            'androidHighPerformance+': true,
        };
        if (ctx.hasOpenData) gameCfg.openDataContext = ctx.openDataRoot;
        if (ctx.subPackages.length > 0) {
            gameCfg.subpackages = ctx.subPackages.map((s) => ({ name: s.name, root: s.root }));
        }
        return [{ file: 'game.json', content: JSON.stringify(gameCfg, null, 2) + '\n' }];
    },

    emitEntry: defaultMiniGameEntry,
};

// =============================================================================
// Quick-game profile (快游戏联盟: vivo / OPPO / Xiaomi / Honor)
// =============================================================================

const QUICKGAME_ICON = 'icon.png';

/** The host evaluates a required file at global scope with no CommonJS wrapper
 *  (a package that relied on one died on `module is not defined`), so each load
 *  gets a fresh module/exports on the global and hands back module.exports. */
const COMMONJS_SHIM = 'var __load = function (p) { var m = { exports: {} }; globalThis.module = m; '
    + 'globalThis.exports = m.exports; require(p); return m.exports; };\n';

/**
 * The alliance's unified package (gamedoc.quickapp.cn, 1300): `manifest.json` +
 * `game.js` + an icon, signed into `<package>.rpk`. The name must end in
 * `.minigame` and `allianceVersion: 1300` marks it as the alliance's. It runs on
 * the `quickgame` engine build.
 */
export const quickgameExportProfile: MiniGameExportProfile = {
    id: 'quickgame',
    sdkEntryFile: 'index.minigame.js',
    runtimeInit: 'initMiniGameRuntime',
    runtimeProfileHost: 'quickgamePlatformProfile',
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // WeChat's floor; the host's V8 is 8.3, which takes es2017.
    esTarget: 'es2017',
    wasmBuildHint: 'quickgame',
    hostGlobal: 'qg',
    sideModuleBuildTargets: {},
    // Assumed to match the other vendors, not read from a quick-game doc; a wrong
    // guess is a staged file the runtime cannot read.
    nativeSuffixes: new Set(['.js', '.json']),
    // No upload whitelist is published for the rpk; nothing is restaged.
    packerSuffixes: null,
    // No doc names a `.wasm.br` loader for this host.
    wasmBrotli: false,
    subpackageDir: 'subpackages',
    // 「主包和分包都可以是main.js 或 game.js」.
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        if (!ctx.appid.endsWith('.minigame')) {
            throw new Error(`the quick-game package name is "${ctx.appid}", and the host takes only one that ends in `
                + '".minigame" — set it in Project Settings → Packaging → Quick game');
        }
        const manifest: Record<string, unknown> = {
            package: ctx.appid,
            name: ctx.title,
            icon: `/${QUICKGAME_ICON}`,
            versionName: ctx.version,
            versionCode: ctx.versionCode,
            // 「1160(此字段是取各家兼容最低版本支持)」; vivo's 1203 engine took it.
            minPlatformVersion: 1160,
            allianceVersion: 1300,
            type: 'game',
            orientation: ctx.orientation,
            deviceOrientation: ctx.orientation,
            config: { logLevel: 'log' },
        };
        if (ctx.subPackages.length > 0) {
            manifest.subpackages = ctx.subPackages.map((s) => ({ name: s.name, root: s.root }));
        }
        return [
            { file: 'manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' },
            { file: QUICKGAME_ICON, content: ctx.icon ?? QUICKGAME_DEFAULT_ICON },
        ];
    },

    emitEntry: globalEvalEntry,
    pack: (ctx) => packSignedRpk(ctx, 'Quick game'),
};

/** The family entry for a host whose `require` gives a file no CommonJS wrapper. */
function globalEvalEntry(ctx: MiniGameEntryContext): string {
    return defaultMiniGameEntry(ctx, '__load').replace("'use strict';\n", `'use strict';\n${COMMONJS_SHIM}`);
}

/** The finished directory as `<package>.rpk`, signed with the project's key or,
 *  with a warning naming where to set one, the public debug key. */
async function packSignedRpk(ctx: MiniGamePackContext, settingsPage: string): Promise<{ file: string; warnings: string[] }> {
    const warnings: string[] = [];
    const key = ctx.releaseKey ?? RPK_DEBUG_KEY;
    if (!ctx.releaseKey) {
        warnings.push('Signed with the public debug key, which a device debugger installs and a store refuses —'
            + ` set a release key in Project Settings → Packaging → ${settingsPage} to publish.`);
    }
    const file = path.join(ctx.outDir, `${ctx.appid}.rpk`);
    const entries = [];
    for (const name of await listFiles(ctx.outDir)) {
        if (name.endsWith('.rpk')) continue;
        entries.push({ name, data: await readFile(path.join(ctx.outDir, name)) });
    }
    await writeFile(file, packRpk(entries, QUICKGAME_ICON, key));
    return { file, warnings };
}

// =============================================================================
// Alipay profile
// =============================================================================

/**
 * Alipay (支付宝), from opendocs.alipay.com/mini-game: `subpackages` lower-case,
 * the appid passed to the tools (`minidev -a`) rather than packaged, and the
 * review build's own transpile and minify — on by default — turned off in
 * `project.config.json`, since this bundle is already down-levelled.
 */
export const alipayExportProfile: MiniGameExportProfile = {
    id: 'alipay',
    sdkEntryFile: 'index.minigame.js',
    runtimeInit: 'initMiniGameRuntime',
    runtimeProfileHost: 'alipayPlatformProfile',
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // WeChat's floor, unconfirmed here: down-levelling costs nothing and a syntax
    // error on a phone costs a release.
    esTarget: 'es2017',
    wasmBuildHint: 'quickgame',
    hostGlobal: 'my',
    sideModuleBuildTargets: {},
    // Assumed to match the other vendors, not read from an Alipay doc; a wrong
    // guess is a staged file the runtime cannot read.
    nativeSuffixes: new Set(['.js', '.json']),
    // No upload whitelist is published; nothing is restaged.
    packerSuffixes: null,
    // MYWebAssembly documents a `.wasm` path only.
    wasmBrotli: false,
    subpackageDir: 'subpackages',
    // 「目录根目录下的 game.js 会作为入口文件」.
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        const gameCfg: Record<string, unknown> = {
            deviceOrientation: ctx.orientation,
            showStatusBar: false,
            // MYWebAssembly runs on iOS only in high-performance mode; 10.8.6+ goes on
            // to 高性能+ by default, and this keeps an older client off 普通模式.
            iOSHighPerformance: true,
        };
        if (ctx.subPackages.length > 0) {
            gameCfg.subpackages = ctx.subPackages.map((s) => ({ name: s.name, root: s.root }));
        }
        return [
            { file: 'game.json', content: JSON.stringify(gameCfg, null, 2) + '\n' },
            { file: 'project.config.json', content: JSON.stringify({ setting: { transpile: false, minify: false } }, null, 2) + '\n' },
        ];
    },

    emitEntry: defaultMiniGameEntry,
};

// =============================================================================
// Huawei quick-game profile
// =============================================================================

/**
 * Huawei (developer.huawei.com, quickApp-Guides): the same signed `.rpk` as the
 * alliance — Huawei's signtool writes the same block — with Huawei's manifest
 * (`appType: "fastgame"`, orientation under `display`). Subpackages are
 * separate unsigned `<name>.rpk` files in Huawei's tool, not yet written here.
 */
export const huaweiExportProfile: MiniGameExportProfile = {
    id: 'huawei',
    sdkEntryFile: 'index.minigame.js',
    runtimeInit: 'initMiniGameRuntime',
    runtimeProfileHost: 'huaweiPlatformProfile',
    engineGlueCandidates: MINIGAME_ENGINE_GLUE,
    // WeChat's floor, unconfirmed here: down-levelling costs nothing and a syntax
    // error on a phone costs a release.
    esTarget: 'es2017',
    wasmBuildHint: 'quickgame',
    hostGlobal: 'qg',
    sideModuleBuildTargets: {},
    // Assumed to match the other vendors, not read from a Huawei doc; a wrong
    // guess is a staged file the runtime cannot read.
    nativeSuffixes: new Set(['.js', '.json']),
    // No upload whitelist is published for the rpk; nothing is restaged.
    packerSuffixes: null,
    // `.br` needs minPlatformVersion 1126 and Huawei's own tool to write it.
    wasmBrotli: false,
    subpackageDir: 'subpackages',
    // 「分包入口文件只能命名为 game.js」.
    subpackageEntry: 'game.js',

    emitConfigFiles(ctx) {
        if (!ctx.appid) {
            throw new Error('the Huawei quick game has no package name — set it in Project Settings → Packaging → Huawei quick game');
        }
        if (ctx.subPackages.length > 0) {
            throw new Error('Huawei packs each subpackage as its own .rpk, which this export does not write yet —'
                + ' ship the lazy groups in the main package, or as remote content');
        }
        const manifest = {
            package: ctx.appid,
            name: ctx.title,
            appType: 'fastgame',
            icon: `/${QUICKGAME_ICON}`,
            versionName: ctx.version,
            versionCode: ctx.versionCode,
            // 「设定值建议不小于 1103」.
            minPlatformVersion: 1103,
            config: { logLevel: 'log' },
            display: { orientation: ctx.orientation, fullScreen: true },
        };
        return [
            { file: 'manifest.json', content: JSON.stringify(manifest, null, 2) + '\n' },
            { file: QUICKGAME_ICON, content: ctx.icon ?? QUICKGAME_DEFAULT_ICON },
        ];
    },

    emitEntry: globalEvalEntry,
    pack: (ctx) => packSignedRpk(ctx, 'Huawei quick game'),
};

async function listFiles(root: string, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(path.join(root, prefix), { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...await listFiles(root, rel));
        else if (e.isFile()) out.push(rel);
    }
    return out;
}
