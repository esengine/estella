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
import { bootPercent, bootSays, type BootStage } from './bootStages';
import type { ESEngineModule } from '../wasm';
import type { AudioProjectConfig } from '../audio/AudioProjectConfig';
import { initRuntime } from './runtimeLoader';
import type { ThemeOverrides } from '../ui';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from '../defaults';
import { getPlatform, platformReadTextFile, platformInstantiateWasm } from '../platform';
import { MiniGamePlatformAdapter } from '../platform/minigame';
import {
    loadPackagedAssetIndex, createPackagedAssetSource, applyAssetRefResolvers,
    registerPackagedSideModules,
} from './packagedRuntime';
import { createMiniGameSideModuleHost, type MiniGameSideModuleFactories } from '../sideModules';
import type { Physics2DPluginConfig } from '../physics/PhysicsTypes';
import type { SceneData } from '../scene/scene';
import type { AotManifest } from '../ecs/aot/AotSystems';
import type { DebugChannelConfig } from './debugChannel';
import { log } from '../util/logger';
import { Schedule, defineSystem } from '../ecs/system';
import type { App } from '../app/app';

// =============================================================================
// Emscripten WASM Instantiation
// =============================================================================

function createWasmInstantiator(wasmPath: string, tag: string, onError?: (e: unknown) => void) {
    return (imports: WebAssembly.Imports, successCallback: Function) => {
        platformInstantiateWasm(wasmPath, imports).then((result) => {
            successCallback(result.instance, result.module);
        }).catch((e) => {
            log.error(tag, `WASM instantiation failed: ${describeError(e)}`);
            // emscripten's instantiateWasm has no failure channel: on a failed
            // async instantiation successCallback is never called and the factory
            // promise hangs forever. Surface the error so the caller can reject.
            onError?.(e);
        });
        return {};
    };
}

/**
 * WebGL1 extensions WebGL2 made core. Emscripten asks for each unconditionally and
 * swaps the context's own methods for any that answers; vivo's WebGL2 context
 * answers OES_vertex_array_object and then hangs the first createVertexArray.
 * Withheld, as the spec already says a WebGL2 context must.
 */
const CORE_IN_WEBGL2 = new Set(['OES_vertex_array_object', 'ANGLE_instanced_arrays', 'WEBGL_draw_buffers']);

export function hideCoreExtensions(gl: WebGLRenderingContext): void {
    const getExtension = gl.getExtension.bind(gl);
    (gl as { getExtension: (name: string) => unknown }).getExtension =
        (name: string) => (CORE_IN_WEBGL2.has(name) ? null : getExtension(name));
}

/** A mini-game console prints a thrown object as `[object Object]`, so the one
 *  line a device gives you says nothing unless it is made into text here. */
function describeError(e: unknown): string {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    if (e && typeof e === 'object') {
        const o = e as { message?: unknown; errMsg?: unknown };
        if (typeof o.message === 'string') return o.message;
        if (typeof o.errMsg === 'string') return o.errMsg;
        try { return JSON.stringify(e); } catch { /* fall through */ }
    }
    return String(e);
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
    /** Install physics even when the scene shows no bodies — a project that
     *  spawns them from script (Project Settings → Physics → Enabled). */
    physicsEnabled?: boolean;
    /** The physics world the project declared: gravity, solver, collision matrix.
     *  The FULL config, not a three-field subset: a collision matrix that reached
     *  Play and not a shipped build is a game that only collides in rehearsal. */
    physicsConfig?: Physics2DPluginConfig;
    /** Project-declared UI theme; 'light' re-skins ThemeStyle-tagged widgets at boot. */
    uiTheme?: 'dark' | 'light';
    /** Project-declared theme token overrides (partial re-skin over the base). */
    uiThemeOverrides?: ThemeOverrides;
    /** Project-declared mixer state (routing labels only on mini-games — the host
     *  hands out finished players, not a DSP graph). */
    audioConfig?: AudioProjectConfig;
    /** Bitmask of render layers (0..31) that y-sort within the layer (Project Settings → Rendering). */
    ySortLayers?: number;
    /** Bitmask of render layers (0..31) that resolve by real depth (2.5D). */
    depthLayers?: number;
    /** Project color space — 'linear' boots the linear-light pipeline (Project Settings → Rendering). */
    colorSpace?: 'gamma' | 'linear';
    /** Project camera fit (Project Settings → Display) — letterboxes the design resolution
     *  without a UI Canvas; absent = no fit (raw orthoSize). */
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
    /** id → emscripten factory (`require('./wasm/<file>.js')`); the generated
     *  game.js supplies exactly the modules the scene needs. Physics + spine
     *  self-gate off these via {@link createMiniGameSideModuleHost}. */
    sideModuleFactories?: MiniGameSideModuleFactories;
    /**
     * Suffix the export staged those binaries under — `.wasm.br` where the
     * vendor's loader takes one and the project asked for it. Declared rather
     * than guessed: the package carries ONE binary per module, and a loader that
     * spelled the suffix itself would name a file the package does not have.
     */
    sideModuleSuffix?: string;
    /**
     * Project-supplied modules (`.esengine/modules/<id>/`) the export staged, so
     * their ids resolve to an artifact name.
     *
     * Separate from the factories above because they answer different questions:
     * a factory is the glue `game.js` already require()'d, this is where the
     * BINARY sits — and a mini-game instantiates from a package path, so without
     * it an acquired module has a factory and nowhere to load from. Built-in ids
     * need no entry; the engine's table already has them.
     */
    sideModules?: Array<{ id: string; file: string; globalName?: string }>;
    /**
     * The compiled twins this build produced (docs/REARCH_AOT.md), as the path
     * the export staged them at. A path and never bytes: WXWebAssembly compiles
     * a package file and nothing else, which is also why the seam instantiates.
     */
    aot?: { module: string; manifest: AotManifest };
    debugChannel?: DebugChannelConfig;
}

/**
 * The host's loading indicator, driven by the same stage list the web start
 * screen reads. It is the only progress surface a mini-game has: the display
 * canvas is the GL surface, so nothing 2D can be drawn over it. Every call is
 * optional — an indicator is something a boot SHOWS, never something it fails on.
 */
function hostProgress(global: { showLoading?: (o: { title: string; mask?: boolean }) => void; hideLoading?: () => void }) {
    const done: BootStage[] = [];
    const say = (): void => {
        try {
            global.showLoading?.({ title: `${bootSays(done)} ${bootPercent(done)}%`, mask: true });
        } catch { /* an indicator must not take the boot down with it */ }
    };
    say();
    return {
        reach(stage: BootStage): void {
            if (done.includes(stage)) return;
            done.push(stage);
            say();
        },
        finish(): void {
            try { global.hideLoading?.(); } catch { /* as above */ }
        },
    };
}

export async function initMiniGameRuntime(config: MiniGameRuntimeConfig): Promise<void> {
    // Before the app exists, so a plugin that acquires during build finds them.
    registerPackagedSideModules({ sideModules: config.sideModules });
    // The family adapter owns the host global; boot refuses to guess at one.
    const adapter = getPlatform();
    if (!(adapter instanceof MiniGamePlatformAdapter)) {
        throw new Error(
            '[ESEngine] initMiniGameRuntime requires a mini-game platform — call ' +
            'setPlatform(new MiniGamePlatformAdapter(profile)) (or installMiniGamePlatform(profile)) first.',
        );
    }
    const tag = adapter.name;
    const progress = hostProgress(adapter.host);
    progress.reach('config');
    progress.reach('scripts');

    // The packaged-realm asset assembly, shared with the native runtime: read the
    // addressable manifest off the device, index it, build the catalog.
    const index = await loadPackagedAssetIndex();
    const { model: manifestModel, catalog } = index;
    progress.reach('manifest');

    // The FIRST canvas of the process is the display surface on every vendor.
    const canvas = adapter.createScreenCanvas();

    const module = await instantiateModule(config.engineFactory, config.engineWasmPath, tag, { canvas });
    progress.reach('engine');

    const gl = canvas.getContext('webgl2') as WebGLRenderingContext | null;
    if (!gl) {
        // The renderer is GLSL ES 3.0 throughout, so a WebGL1 context would boot
        // to shader failures and a black screen; this says why instead.
        const offersWebGL1 = canvas.getContext('webgl') !== null;
        log.error(tag, offersWebGL1
            ? 'This host offers only WebGL1, and the engine renders on WebGL2 — the game cannot start here'
            : 'Failed to create a WebGL2 context');
        return;
    }

    hideCoreExtensions(gl);
    const glHandle = module.GL.registerContext(gl, {
        majorVersion: 2,
        minorVersion: 0,
        enableExtensionsByDefault: true,
    });

    const app = createWebApp(module, {
        renderSurface: { kind: 'gl-context', handle: glHandle },
        ySortLayers: config.ySortLayers,
        depthLayers: config.depthLayers,
        colorSpace: config.colorSpace,
        screenFit: config.screenFit,
        getViewportSize: () => ({
            width: canvas.width,
            height: canvas.height,
        }),
        // Physics + spine self-gate off these factories (require()'d in game.js).
        sideModules: config.sideModuleFactories
            ? createMiniGameSideModuleHost(config.sideModuleFactories, config.sideModuleSuffix)
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
    progress.reach('assets');
    await initRuntime({
        app,
        module,
        source,
        manifest: manifestModel,
        catalog,
        scenes,
        firstScene: config.firstScene,
        physicsEnabled: config.physicsEnabled,
        physicsConfig: config.physicsConfig,
        uiTheme: config.uiTheme,
        uiThemeOverrides: config.uiThemeOverrides,
        audioConfig: config.audioConfig,
        aspectRatio: canvas.width / canvas.height,
        ...(config.aot ? { aot: config.aot } : {}),
        ...(config.debugChannel ? { debugChannel: config.debugChannel } : {}),
    });

    progress.reach('ready');
    // Before run(), which may hand control to the engine's loop and not return.
    progress.finish();
    reportFirstFrame(app, adapter.host as { launchSuccess?: () => void });
    app.run();
}

/**
 * Tell the host the first screen has rendered, where it asks to be told:
 * Bilibili reviews a game by it (「需要在游戏首页成功渲染时调用」`bl.launchSuccess`).
 * At the end of the first frame, once; a host without the call is skipped.
 */
export function reportFirstFrame(app: Pick<App, 'addSystemToSchedule'>, host: { launchSuccess?: () => void }): void {
    if (typeof host.launchSuccess !== 'function') return;
    let told = false;
    app.addSystemToSchedule(Schedule.Last, defineSystem([], () => {
        if (told) return;
        told = true;
        try { host.launchSuccess!(); } catch (e) { log.warn('runtime', `launchSuccess threw: ${String(e)}`); }
    }, { name: 'ReportFirstFrame' }));
}
