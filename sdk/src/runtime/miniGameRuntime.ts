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
import type { RenderOptions } from '../app/renderOptions';
import { bootPercent, bootSays, type BootStage } from './bootStages';
import { markIdentDone, playIdent, type IdentRun } from './ident';
import type { ESEngineModule } from '../wasm';
import { initRuntime } from './runtimeLoader';
import { instantiateWasmModule } from '../wasm/instantiateModule';
import { runGameStartup, type GameStartup } from './gameStartup';
import { runtimeProjectSettings, type RuntimeProjectSettings } from './projectSettings';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from '../defaults';
import { getPlatform, platformReadTextFile, platformInstantiateWasm } from '../platform';
import { MiniGamePlatformAdapter } from '../platform/minigame';
import {
    loadPackagedAssetIndex, createPackagedAssetSource, applyAssetRefResolvers,
    registerPackagedSideModules, glContextAttributes, packagedAppOptions,
} from './packagedRuntime';
import { createMiniGameSideModuleHost, type MiniGameSideModuleFactories, type MiniGameSideModuleBinary } from '../sideModules';
import type { SceneData } from '../scene/scene';
import { startDebugChannel } from './debugChannelHook';
import type { DebugChannelConfig } from './debugChannelProtocol';
import type { PackagedGameConfig } from './packagedRuntime';
import { log } from '../util/logger';
import { Schedule, defineSystem } from '../ecs/system';
import type { App, Plugin } from '../app/app';

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

// =============================================================================
// Public API
// =============================================================================

export interface MiniGameRuntimeConfig extends RenderOptions, RuntimeProjectSettings {
    /** Reuse the bundled project's registrations on each start. */
    projectPlugin?: Plugin;
    engineFactory: (opts: unknown) => Promise<ESEngineModule>;
    /** Package-relative path of the engine wasm binary. The exporter stages the
     *  runtime under wasm/ and knows which glue it shipped, so it passes the
     *  glue's `.wasm` twin here. */
    engineWasmPath: string;
    ident?: boolean;
    sceneNames: string[];
    /** Package-relative files indexed by logical scene name. */
    sceneFiles?: readonly { name: string; path: string }[];
    firstScene: string;
    runtimeConfig?: RuntimeBuildConfig;
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
    /** Binary locations that differ from wasm/<file> plus the default suffix. */
    sideModuleBinaries?: Readonly<Record<string, MiniGameSideModuleBinary>>;
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
    aot?: PackagedGameConfig['aot'];
    debugChannel?: DebugChannelConfig;
    /** The CDN root remote groups resolve against, and the key an applied update
     *  is stored under — the same field every packaged runtime reads. */
    hotUpdate?: PackagedGameConfig['hotUpdate'];
}

/**
 * The host's loading indicator, driven by the same stage list the web start
 * screen reads. It is the only progress surface a mini-game has: the display
 * canvas is the GL surface, so nothing 2D can be drawn over it. Every call is
 * optional — an indicator is something a boot SHOWS, never something it fails on.
 */
export function hostProgress(global: {
    showLoading?: (o: { title: string; mask?: boolean; complete?: () => void }) => void;
    hideLoading?: () => void;
}) {
    const done: BootStage[] = [];
    let finished = false;
    const hide = (): void => {
        try { global.hideLoading?.(); } catch { /* as above */ }
    };
    const say = (): void => {
        try {
            global.showLoading?.({
                title: `${bootSays(done)} ${bootPercent(done)}%`,
                mask: true,
                complete: () => { if (finished) hide(); },
            });
        } catch { /* an indicator must not take the boot down with it */ }
    };
    say();
    return {
        reach(stage: BootStage): void {
            if (finished || done.includes(stage)) return;
            done.push(stage);
            say();
        },
        /** Some hosts apply a queued show after the hide. Dismiss each show that
         *  reports completion after boot ends, independently of earlier calls. */
        finish(): void {
            if (finished) return;
            finished = true;
            hide();
        },
    };
}

/** What a GLX context carries (WeChat's "EmscriptenGLX 原生引擎接入"). */
export interface GlxContext { isWebGL2: boolean; platform: number; ctxid: number }
export type GlxModule = { ccall(name: string, ret: string | null, args: string[], values: unknown[]): unknown; wxContextGlobal?: GlxContext };

type ContextEvents = {
    addEventListener?(type: string, listener: (event: { preventDefault?(): void }) => void): void;
    removeEventListener?(type: string, listener: (event: { preventDefault?(): void }) => void): void;
};

export interface ScreenIdent extends IdentRun {
    usable(timeoutMs?: number): Promise<void>;
}

export function startIdent(canvas: { width: number; height: number; getContext(type: string, attributes?: unknown): unknown } & ContextEvents): ScreenIdent | null {
    try {
        const gl = canvas.getContext('webgl2', glContextAttributes()) as WebGL2RenderingContext | null;
        if (!gl) return null;
        const host = globalThis as { requestAnimationFrame?: (step: () => void) => unknown };
        const size = (): { width: number; height: number } => ({ width: canvas.width, height: canvas.height });
        const frame = (step: () => void): void => {
            if (typeof host.requestAnimationFrame === 'function') host.requestAnimationFrame(step);
            else setTimeout(step, 16);
        };
        let run = playIdent(gl, size, frame);
        if (!run) return null;
        let stopped = false;
        const waiting: (() => void)[] = [];
        const onLost = (event: { preventDefault?(): void }): void => {
            event.preventDefault?.();
            run?.stop();
            run = null;
        };
        const onRestored = (): void => {
            if (!stopped) run = playIdent(gl, size, frame);
            for (const resolve of waiting.splice(0)) resolve();
        };
        canvas.addEventListener?.('webglcontextlost', onLost);
        canvas.addEventListener?.('webglcontextrestored', onRestored);
        const finished = run.finished;
        return {
            finished,
            usable(timeoutMs = 10_000) {
                if (!gl.isContextLost()) return Promise.resolve();
                return new Promise((resolve) => {
                    waiting.push(resolve);
                    setTimeout(resolve, timeoutMs);
                });
            },
            stop() {
                if (stopped) return;
                stopped = true;
                run?.stop();
                run = null;
                canvas.removeEventListener?.('webglcontextlost', onLost);
                canvas.removeEventListener?.('webglcontextrestored', onRestored);
            },
        };
    } catch {
        return null;
    }
}

/** Starts the linked GLX in the order WeChat's guide gives: told whether the host
 *  gave a GLX context at all, then, when it did, its buffers and GL state. */
export function startGlx(module: GlxModule, glx: GlxContext | undefined): void {
    module.ccall('glxInit', null, ['bool'], [!!glx]);
    if (!glx || module.wxContextGlobal !== undefined) return;
    module.wxContextGlobal = { ...glx };
    module.ccall('glxInitBufferDataAndGlState', null, ['number', 'number'], [glx.isWebGL2 ? 2 : 1, glx.platform]);
}

export function initMiniGameRuntime(config: MiniGameRuntimeConfig): Promise<void> {
    return runGameStartup(startup => bootMiniGame(config, startup));
}

async function bootMiniGame(config: MiniGameRuntimeConfig, startup: GameStartup): Promise<void> {
    // Before the engine boots, so a boot that fails is still heard by the editor.
    if (config.debugChannel) startDebugChannel(config.debugChannel);
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
    const canvas = adapter.createScreenCanvas();
    const ident = config.ident ? startIdent(canvas) : null;
    markIdentDone(ident === null);
    if (ident) {
        try { (adapter.host as { hideLoading?: () => void }).hideLoading?.(); } catch (e) { log.warn(tag, `hideLoading threw: ${String(e)}`); }
    }
    const reached: BootStage[] = [];
    let booted = false;
    let toast = hostProgress(ident ? {} : adapter.host);
    const progress = {
        reach(stage: BootStage): void { reached.push(stage); toast.reach(stage); },
        finish(): void { booted = true; toast.finish(); },
    };
    startup.onFailure(() => { progress.finish(); ident?.stop(); });
    if (ident) {
        void ident.finished.then(() => {
            if (booted) return;
            toast = hostProgress(adapter.host);
            for (const stage of reached) toast.reach(stage);
        });
    }
    progress.reach('config');
    progress.reach('scripts');

    // The packaged-realm asset assembly, shared with the native runtime: read the
    // addressable manifest off the device, index it, build the catalog.
    const index = await loadPackagedAssetIndex();
    const { model: manifestModel, catalog } = index;
    progress.reach('manifest');

    const module = await instantiateWasmModule(config.engineFactory, async imports => {
        try { return await platformInstantiateWasm(config.engineWasmPath, imports); }
        catch (error) {
            log.error(tag, `WASM instantiation failed: ${describeError(error)}`);
            throw error;
        }
    }, { canvas });
    const rendererAdopted = startup.onFailure(() => module.shutdownRenderer?.());
    progress.reach('engine');
    if (ident) {
        await ident.finished;
        await ident.usable();
        ident.stop();
    }

    // EmscriptenGLX runs the engine's GL calls inside the wasm and hands them to
    // the host in batches. Asked for only when the engine was linked with it and
    // the host offers it; anything else is the ordinary WebGL2 context.
    const glxLinked = typeof (module as { _glxInit?: unknown })._glxInit === 'function';
    const hostEnv = (adapter.host as { env?: { isSupportEmscriptenGLX?: boolean } }).env;
    const wantGlx = glxLinked && hostEnv?.isSupportEmscriptenGLX === true;
    const gl = canvas.getContext(wantGlx ? 'wxwebgl2' : 'webgl2', glContextAttributes()) as WebGLRenderingContext | null;
    if (!gl) {
        // The renderer is GLSL ES 3.0 throughout, so a WebGL1 context would boot
        // to shader failures and a black screen; this says why instead.
        const offersWebGL1 = canvas.getContext('webgl') !== null;
        throw new Error(offersWebGL1
            ? 'This host offers only WebGL1, and the engine renders on WebGL2 — the game cannot start here'
            : 'Failed to create a WebGL2 context');
    }

    const glx = (gl as { emscriptenGLX?: GlxContext }).emscriptenGLX;
    if (glxLinked) startGlx(module as unknown as GlxModule, glx);
    log.info(tag, glx ? 'rendering through EmscriptenGLX' : `rendering through WebGL2${glxLinked ? ' (this host offers no EmscriptenGLX)' : ''}`);

    hideCoreExtensions(gl);
    const glHandle = module.GL.registerContext(gl, {
        majorVersion: 2,
        minorVersion: 0,
        enableExtensionsByDefault: true,
    });
    if (glx) (module as unknown as GlxModule).ccall('glxUpdateContextId', 'number', ['number'], [glx.ctxid]);

    const app = startup.createApp(() => createWebApp(module, {
        renderSurface: { kind: 'gl-context', handle: glHandle, glx: glx !== undefined },
        ...packagedAppOptions(config),
        getViewportSize: () => ({
            width: canvas.width,
            height: canvas.height,
        }),
        // Physics + spine self-gate off these factories (require()'d in game.js).
        sideModules: config.sideModuleFactories
            ? createMiniGameSideModuleHost(config.sideModuleFactories, config.sideModuleSuffix, config.sideModuleBinaries)
            : undefined,
        ownsSideModules: true,
    }));
    rendererAdopted();

    if (config.runtimeConfig) {
        applyBuildRuntimeConfig(app, config.runtimeConfig);
    }

    // Canonical asset source: the host filesystem backend, host image decode,
    // manifest ref resolution (bare-uuid → build path).
    const source = createPackagedAssetSource(index);
    applyAssetRefResolvers(app, source.resolveRef!);

    // The first scene loads eagerly (the game boots into it); every other
    // registers lazily by path — SceneManager fetches the packaged scene
    // through the runtime Assets (host fs backend) on the first switchTo.
    const scenes: Array<{ name: string; data?: SceneData; path?: string }> = [];
    const sceneFiles = config.sceneFiles ?? config.sceneNames.map(name => ({ name, path: `scenes/${name}.json` }));
    for (const { name, path } of sceneFiles) {
        if (name === config.firstScene) {
            const sceneText = await platformReadTextFile(path);
            scenes.push({ name, data: JSON.parse(sceneText) as SceneData });
        } else {
            scenes.push({ name, path });
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
        projectPlugin: config.projectPlugin,
        module,
        source,
        manifest: manifestModel,
        catalog,
        scenes,
        firstScene: config.firstScene,
        ...runtimeProjectSettings(config),
        aspectRatio: canvas.width / canvas.height,
        ...(config.aot ? { aot: config.aot } : {}),
        ...(config.debugChannel ? { debugChannel: config.debugChannel } : {}),
        remoteRoot: config.hotUpdate?.remoteRoot,
        persistUpdateKey: config.hotUpdate?.persistUpdateKey,
    });

    progress.reach('ready');
    // Before run(), which may hand control to the engine's loop and not return.
    progress.finish();
    reportFirstFrame(app, adapter.host as { launchSuccess?: () => void });
    if (ident) {
        const drawn = countDraws(gl);
        startup.onFailure(() => drawn.release());
        let seen = 0, frames = 0;
        const off = app.onFrameEnd(() => {
            if (drawn.count === seen) return;
            seen = drawn.count;
            if (++frames < 3) return;
            off();
            drawn.release();
            markIdentDone(true);
        });
    }
    await app.run();
}

const DRAWS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear', 'blitFramebuffer'] as const;

export function countDraws(gl: object): { readonly count: number; release(): void } {
    const target = gl as Record<string, unknown>;
    const own = new Map<string, unknown>();
    const counter = {
        count: 0,
        release(): void {
            for (const name of DRAWS) {
                if (own.has(name)) target[name] = own.get(name);
                else delete target[name];
            }
        },
    };
    for (const name of DRAWS) {
        const original = target[name];
        if (typeof original !== 'function') continue;
        if (Object.prototype.hasOwnProperty.call(target, name)) own.set(name, original);
        target[name] = (...args: unknown[]): unknown => {
            counter.count++;
            return (original as (...a: unknown[]) => unknown).apply(gl, args);
        };
    }
    return counter;
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
