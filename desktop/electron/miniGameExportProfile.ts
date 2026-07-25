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
import { WECHAT_MODULE_BUILD_TARGET } from './sideModuleScan';

/**
 * A mini-game vendor's id. Open on purpose: the value is identity — the cook's
 * per-platform Import Settings key, the export result's `platform`, diagnostics
 * — and nothing in the pipeline branches on it, so a vendor the editor does not
 * ship can still be exported by handing {@link exportMiniGame} a profile.
 * Mirrors the SDK's `MiniGameVendor` (sdk/src/platform/minigame/api.ts).
 */
export type MiniGameVendor = 'wechat' | 'douyin' | (string & {});

/** Vendor-neutral facts the pipeline computes, handed to the config emitter. */
export interface MiniGameConfigContext {
    title: string;
    appid: string;
    orientation: 'portrait' | 'landscape';
    /** Lazy groups present in the cook, as vendor subpackage roots. */
    subPackages: ReadonlyArray<{ name: string; root: string }>;
    /** Custom suffixes the cook staged that need an explicit packer include rule. */
    includeSuffixes: string[];
}

/** Vendor-neutral facts the pipeline computes, handed to the entry emitter. */
export interface MiniGameEntryContext {
    /** Optional modules the shipped scenes need (physics/spine/basis/videodec). */
    sideModules: ReadonlyArray<{ id: string; file: string }>;
    /** The engine glue filename staged into wasm/ (esengine.wxgame.js | esengine.js). */
    engineGlueFile: string;
}

export interface MiniGameExportProfile {
    /** Vendor identity — the export result's `platform` + diagnostics. */
    readonly id: MiniGameVendor;
    /** SDK dist entry the bundle aliases `esengine` to (index.wechat.js). */
    readonly sdkEntryFile: string;
    /** Runtime bootstrap fn imported from 'esengine' in the generated boot. */
    readonly runtimeInit: string;
    /** Engine glue filenames to look for in wasmDir, in preference order. */
    readonly engineGlueCandidates: readonly string[];
    /** esbuild target for the game bundle + glue down-level (real-device syntax floor). */
    readonly esTarget: 'es2017' | 'es2019' | 'es2020';
    /** Build-target name woven into "runtime not found" errors (`build -t <hint>`). */
    readonly wasmBuildHint: string;
    /** side-module id → the `build -t <target>` that produces it for THIS vendor.
     *  The optional modules (physics/basis/videodec/spine) are built per vendor
     *  runtime, so the "module missing" guidance cannot be a shared constant. */
    readonly sideModuleBuildTargets: Readonly<Record<string, string>>;
    /** Extensions the packer handles natively (no packOptions.include needed). */
    readonly nativeSuffixes: ReadonlySet<string>;
    /** Custom extensions the packer denies unless restaged to `<ext>.bin`. */
    readonly binRestageExts: readonly string[];
    /** Subpackage root prefix (files stage under `<subpackageDir>/<name>/`). */
    readonly subpackageDir: string;

    /** Emit the vendor config files (game.json + project.config.json / project.tt.json). */
    emitConfigFiles(ctx: MiniGameConfigContext): Array<{ file: string; content: string }>;
    /** Emit the MiniGame entry the host runs (game.js). */
    emitEntry(ctx: MiniGameEntryContext): string;
}

// =============================================================================
// WeChat profile
// =============================================================================

export const wechatExportProfile: MiniGameExportProfile = {
    id: 'wechat',
    // The bundle aliases `esengine` → <sdkDir>/index.wechat.js (the wechat SDK build).
    sdkEntryFile: 'index.wechat.js',
    runtimeInit: 'initWeChatRuntime',
    // Require by the ACTUAL name in the wasm dir: the -t wechat build emits
    // esengine.wxgame.js; a web-aligned build, esengine.js.
    engineGlueCandidates: ['esengine.wxgame.js', 'esengine.js'],
    // Real-device WeChat rejects es2020 syntax (`??`, `?.`) even though devtools
    // accepts it; es2017 down-levels those while keeping async/await.
    esTarget: 'es2017',
    wasmBuildHint: 'wechat',
    sideModuleBuildTargets: WECHAT_MODULE_BUILD_TARGET,
    // Script + config WeChat's packer compiles itself; every OTHER staged custom
    // extension needs a packOptions.include rule (fs reads are otherwise denied).
    nativeSuffixes: new Set(['.js', '.json']),
    // WeChat's code-package suffix whitelist has no ktx2/esv; restage to *.bin.
    binRestageExts: ['ktx2', 'esv'],
    subpackageDir: 'subpackages',

    emitConfigFiles(ctx) {
        const gameCfg: Record<string, unknown> = {
            deviceOrientation: ctx.orientation,
            showStatusBar: false,
        };
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
            setting: { es6: false, minified: false, bigPackageSizeSupport: true },
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

    emitEntry(ctx) {
        const requires = ctx.sideModules
            .map((m) => `  ${JSON.stringify(m.id)}: asFactory(require('./wasm/${m.file}.js')),`)
            .join('\n');
        return `'use strict';
// Generated by Estella exportGame (WeChat MiniGame entry).
const asFactory = (m) => (typeof m === 'function' ? m : (m && m.default) || m);
const engineFactory = asFactory(require('./wasm/${ctx.engineGlueFile}'));
const sideModuleFactories = {
${requires}
};
const bundle = require('./game-bundle.js');
bundle.boot(engineFactory, sideModuleFactories);
`;
    },
};
