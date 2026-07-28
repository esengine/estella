// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    miniGameRuntime.ts
 * @brief   Boot for the mini-game platform family — the shipped package's entry
 *          point on WeChat, Douyin, or a vendor a game brought itself.
 *
 *          Everything here is written against the platform seam, never a vendor
 *          global: the display canvas and its size come from the family adapter
 *          (`createScreenCanvas`), the wasm binary through `instantiateWasm`
 *          (where the one genuine per-vendor divergence lives), scenes through
 *          `platformReadTextFile`. So a new vendor boots on this file unchanged
 *          — {@link initWeChatRuntime} is nothing but this function with
 *          WeChat's staged wasm name filled in.
 */

import { createWebApp } from './webAppFactory';
import type { ESEngineModule } from '../wasm';
import type { AudioProjectConfig } from '../audio/AudioProjectConfig';
import { initRuntime } from './runtimeLoader';
import type { ThemeOverrides } from '../ui';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from '../defaults';
import { getPlatform, platformReadTextFile, platformInstantiateWasm } from '../platform';
import { MiniGamePlatformAdapter } from '../platform/minigame';
import { loadPackagedAssetIndex, createPackagedAssetSource, applyAssetRefResolvers } from './packagedRuntime';
import { createMiniGameSideModuleHost, type MiniGameSideModuleFactories } from '../sideModules';
import type { Vec2 } from '../types';
import type { SceneData } from '../scene';
import { log } from '../logger';

// =============================================================================
// Emscripten WASM Instantiation
// =============================================================================

function createWasmInstantiator(wasmPath: string, tag: string, onError?: (e: unknown) => void) {
    return (imports: WebAssembly.Imports, successCallback: Function) => {
        platformInstantiateWasm(wasmPath, imports).then((result) => {
            successCallback(result.instance, result.module);
        }).catch((e) => {
            log.error(tag, 'WASM instantiation failed', e);
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
    tag: string,
    extraOpts: Record<string, unknown> = {},
): Promise<T> {
    let rejectOnError: (e: unknown) => void = () => {};
    const errorGate = new Promise<never>((_, reject) => { rejectOnError = reject; });
    const modulePromise = factory({
        ...extraOpts,
        instantiateWasm: createWasmInstantiator(wasmPath, tag, rejectOnError),
    });
    return Promise.race([modulePromise, errorGate]);
}

// =============================================================================
// Public API
// =============================================================================

export interface MiniGameRuntimeConfig {
    engineFactory: (opts: unknown) => Promise<ESEngineModule>;
    /** Package-relative path of the engine wasm binary. The exporter stages the
     *  runtime under wasm/ and knows which glue it shipped, so it passes the
     *  glue's `.wasm` twin here. */
    engineWasmPath: string;
    sceneNames: string[];
    firstScene: string;
    runtimeConfig?: RuntimeBuildConfig;
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number };
    /** Project-declared UI theme; 'light' re-skins ThemeStyle-tagged widgets at boot. */
    uiTheme?: 'dark' | 'light';
    /** Project-declared theme token overrides (partial re-skin over the base). */
    uiThemeOverrides?: ThemeOverrides;
    /** Project-declared mixer state (routing labels only on mini-games — the host
     *  hands out finished players, not a DSP graph). */
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
     *  self-gate off these via {@link createMiniGameSideModuleHost}. */
    sideModuleFactories?: MiniGameSideModuleFactories;
}

export async function initMiniGameRuntime(config: MiniGameRuntimeConfig): Promise<void> {
    // The family adapter owns the host global; boot refuses to guess at one.
    const adapter = getPlatform();
    if (!(adapter instanceof MiniGamePlatformAdapter)) {
        throw new Error(
            '[ESEngine] initMiniGameRuntime requires a mini-game platform — call ' +
            'setPlatform(new MiniGamePlatformAdapter(profile)) (or installMiniGamePlatform(profile)) first.',
        );
    }
    const tag = adapter.name;

    // The packaged-realm asset assembly, shared with the native runtime: read the
    // addressable manifest off the device, index it, build the catalog.
    const index = await loadPackagedAssetIndex();
    const { model: manifestModel, catalog } = index;

    // The FIRST canvas of the process is the display surface on every vendor.
    const canvas = adapter.createScreenCanvas();

    const module = await instantiateModule(config.engineFactory, config.engineWasmPath, tag, { canvas });

    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
        log.error(tag, 'Failed to create WebGL context');
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
            ? createMiniGameSideModuleHost(config.sideModuleFactories)
            : undefined,
    });

    if (config.runtimeConfig) {
        applyBuildRuntimeConfig(app, config.runtimeConfig);
    }

    // Canonical asset source: the host filesystem backend, host image decode,
    // manifest ref resolution (bare-uuid → build path).
    const source = createPackagedAssetSource(index);
    applyAssetRefResolvers(app, index.resolvePath);

    // The first scene loads eagerly (the game boots into it); every other
    // registers lazily by path — SceneManager fetches scenes/<name>.json
    // through the runtime Assets (host fs backend) on the first switchTo.
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
    // subpackage group triggers the host's loadSubpackage first, an eager 'main'
    // group loads directly), and it survives scene switches. Setting it on the
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
