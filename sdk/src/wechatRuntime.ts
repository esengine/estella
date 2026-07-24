// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wechatRuntime.ts
 * @brief   WeChat MiniGame runtime initialization
 */

/// <reference types="minigame-api-typings" />

import { createWebApp } from './webAppFactory';
import type { ESEngineModule } from './wasm';
import type { AudioProjectConfig } from './audio/AudioProjectConfig';
import { initRuntime } from './runtimeLoader';
import type { ThemeOverrides } from './ui';
import type { RuntimeAssetSource } from './runtimeAssets';
import { FileSystemBackend } from './asset/Backend';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from './defaults';
import { platformReadTextFile, platformInstantiateWasm, platformLoadImagePixels } from './platform';
import { loadPackagedAssetIndex } from './packagedRuntime';
import { createWeChatSideModuleHost, type WeChatSideModuleFactories } from './sideModules';
import type { Vec2 } from './types';
import type { SceneData } from './scene';
import { log } from './logger';

// =============================================================================
// Emscripten WASM Instantiation
// =============================================================================

function createWasmInstantiator(wasmPath: string, onError?: (e: unknown) => void) {
    return (imports: WebAssembly.Imports, successCallback: Function) => {
        platformInstantiateWasm(wasmPath, imports).then((result) => {
            successCallback(result.instance, result.module);
        }).catch((e) => {
            log.error('wechat', 'WASM instantiation failed', e);
            // emscripten's instantiateWasm has no failure channel: on a failed
            // async instantiation successCallback is never called and the factory
            // promise hangs forever. Surface the error so the caller can reject.
            onError?.(e);
        });
        return {};
    };
}

// Wraps an emscripten module factory so an async instantiateWasm failure rejects
// the returned promise instead of hanging the module load indefinitely.
function instantiateModule<T>(
    factory: (opts: unknown) => Promise<T>,
    wasmPath: string,
    extraOpts: Record<string, unknown> = {},
): Promise<T> {
    let rejectOnError: (e: unknown) => void = () => {};
    const errorGate = new Promise<never>((_, reject) => { rejectOnError = reject; });
    const modulePromise = factory({
        ...extraOpts,
        instantiateWasm: createWasmInstantiator(wasmPath, rejectOnError),
    });
    return Promise.race([modulePromise, errorGate]);
}

// =============================================================================
// Public API
// =============================================================================

export interface WeChatRuntimeConfig {
    engineFactory: (opts: unknown) => Promise<ESEngineModule>;
    /** Package-relative path of the engine wasm binary. The exporter stages the
     *  runtime under wasm/ and knows which glue it shipped, so it passes the
     *  glue's `.wasm` twin here; defaults to the canonical -t wechat layout. */
    engineWasmPath?: string;
    sceneNames: string[];
    firstScene: string;
    runtimeConfig?: RuntimeBuildConfig;
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number };
    /** Project-declared UI theme; 'light' re-skins ThemeStyle-tagged widgets at boot. */
    uiTheme?: 'dark' | 'light';
    /** Project-declared theme token overrides (partial re-skin over the base). */
    uiThemeOverrides?: ThemeOverrides;
    /** Project-declared mixer state (routing labels only on WeChat — no DSP graph). */
    audioConfig?: AudioProjectConfig;
    /** Bitmask of render layers (0..31) that y-sort within the layer (Project Settings → Rendering). */
    ySortLayers?: number;
    /** Project color space — 'linear' boots the linear-light pipeline (Project Settings → Rendering). */
    colorSpace?: 'gamma' | 'linear';
    /** Project camera fit (Project Settings → Display) — letterboxes the design resolution
     *  without a UI Canvas; absent = no fit (raw orthoSize). */
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
    /** id → emscripten factory (`require('./wasm/<file>.js')`); the generated
     *  game.js supplies exactly the modules the scene needs. Physics + spine
     *  self-gate off these via {@link createWeChatSideModuleHost}. */
    sideModuleFactories?: WeChatSideModuleFactories;
}

export async function initWeChatRuntime(config: WeChatRuntimeConfig): Promise<void> {
    // The packaged-realm asset assembly, shared with the native runtime: read the
    // addressable manifest off the device, index it, build the catalog.
    const { manifest, model: manifestModel, catalog, resolvePath } = await loadPackagedAssetIndex();

    const canvas = wx.createCanvas();
    const info = wx.getSystemInfoSync();
    canvas.width = info.windowWidth * info.pixelRatio;
    canvas.height = info.windowHeight * info.pixelRatio;

    const module = await instantiateModule(config.engineFactory, config.engineWasmPath ?? 'wasm/esengine.wxgame.wasm', { canvas });

    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
        log.error('wechat', 'Failed to create WebGL context');
        return;
    }

    const glHandle = module.GL.registerContext(gl, {
        majorVersion: String(gl.getParameter(gl.VERSION)).indexOf('WebGL 2') === 0 ? 2 : 1,
        minorVersion: 0,
        enableExtensionsByDefault: true,
    });

    const app = createWebApp(module, {
        renderSurface: { kind: 'gl-context', handle: glHandle },
        ySortLayers: config.ySortLayers,
        colorSpace: config.colorSpace,
        screenFit: config.screenFit,
        getViewportSize: () => ({
            width: canvas.width,
            height: canvas.height,
        }),
        // Physics + spine self-gate off these factories (require()'d in game.js).
        sideModules: config.sideModuleFactories
            ? createWeChatSideModuleHost(config.sideModuleFactories)
            : undefined,
    });

    if (config.runtimeConfig) {
        applyBuildRuntimeConfig(app, config.runtimeConfig);
    }

    // Canonical asset source: WeChat filesystem backend, wx image decode, manifest
    // ref resolution (bare-uuid → build path).
    const source: RuntimeAssetSource = {
        backend: new FileSystemBackend(),
        decodePixels: (path) => platformLoadImagePixels(path),
        resolveRef: resolvePath,
        // Logical addresses where present (content-addressed packs rename the
        // staged file), else the staged path — either keeps the extension the
        // .eslocale discovery filters on.
        listAssetPaths: () => manifestModel.allAssets().map((a) => a.address ?? a.path),
    };

    // The first scene loads eagerly (the game boots into it); every other
    // registers lazily by path — SceneManager fetches scenes/<name>.json
    // through the runtime Assets (wx fs backend) on the first switchTo.
    const scenes: Array<{ name: string; data?: SceneData; path?: string }> = [];
    for (const name of config.sceneNames) {
        if (name === config.firstScene) {
            const sceneText = await platformReadTextFile(`scenes/${name}.json`);
            scenes.push({ name, data: JSON.parse(sceneText) as SceneData });
        } else {
            scenes.push({ name, path: `scenes/${name}.json` });
        }
    }

    // The manifest rides into initRuntime, which sets it on the per-App runtime
    // Assets — so game code can `Assets.loadGroup(name)` on demand (a lazy
    // subpackage group triggers wx.loadSubpackage first, an eager 'main' group
    // loads directly), and it survives scene switches. Setting it on the
    // pre-initRuntime Assets resource was a bug: the runtime instance replaced
    // that resource, so loadGroup lost the manifest after the first scene load.
    await initRuntime({
        app,
        module,
        source,
        manifest: manifestModel,
        catalog,
        scenes,
        firstScene: config.firstScene,
        physicsConfig: config.physicsConfig,
        uiTheme: config.uiTheme,
        uiThemeOverrides: config.uiThemeOverrides,
        audioConfig: config.audioConfig,
        aspectRatio: canvas.width / canvas.height,
    });

    app.run();
}
