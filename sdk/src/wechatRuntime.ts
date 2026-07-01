// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wechatRuntime.ts
 * @brief   WeChat MiniGame runtime initialization
 */

/// <reference types="minigame-api-typings" />

import { createWebApp } from './webAppFactory';
import type { ESEngineModule } from './wasm';
import { initRuntime } from './runtimeLoader';
import type { RuntimeAssetSource } from './runtimeAssets';
import { FileSystemBackend } from './asset/Backend';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from './defaults';
import { platformReadTextFile, platformInstantiateWasm, platformLoadImagePixels } from './platform';
import { toBuildPath } from './assetTypes';
import { ManifestModel, type AddressableManifest } from './asset/AddressableManifest';
import { Assets } from './asset/AssetPlugin';
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
    sceneNames: string[];
    firstScene: string;
    runtimeConfig?: RuntimeBuildConfig;
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number };
    /** id → emscripten factory (`require('./wasm/<file>.js')`); the generated
     *  game.js supplies exactly the modules the scene needs. Physics + spine
     *  self-gate off these via {@link createWeChatSideModuleHost}. */
    sideModuleFactories?: WeChatSideModuleFactories;
}

export async function initWeChatRuntime(config: WeChatRuntimeConfig): Promise<void> {
    const manifestText = await platformReadTextFile('asset-manifest.json');
    const manifest: AddressableManifest = JSON.parse(manifestText);
    // Single manifest model — same query/resolution core the SDK Assets channel
    // uses, instead of a hand-rolled index walk duplicated here.
    const manifestModel = ManifestModel.fromJson(manifest);
    const resolvePath = (ref: string): string => manifestModel.resolvePath(ref, toBuildPath);

    const canvas = wx.createCanvas();
    const info = wx.getSystemInfoSync();
    canvas.width = info.windowWidth * info.pixelRatio;
    canvas.height = info.windowHeight * info.pixelRatio;

    const module = await instantiateModule(config.engineFactory, 'esengine.wasm', { canvas });

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
        glContextHandle: glHandle,
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

    // Hand the manifest to the App's Assets so game code can `Assets.loadGroup(name)`
    // on demand — a lazy (subpackage) group triggers wx.loadSubpackage first, the
    // eager 'main' group loads directly. Eager scene assets still load through the
    // runtime loader below; this enables the on-demand subpackage path.
    if (app.hasResource(Assets)) app.getResource(Assets).setManifest(manifest);

    // Canonical asset source: WeChat filesystem backend, wx image decode, manifest
    // ref resolution (bare-uuid → build path).
    const source: RuntimeAssetSource = {
        backend: new FileSystemBackend(),
        decodePixels: (path) => platformLoadImagePixels(path),
        resolveRef: resolvePath,
    };

    const scenes: Array<{ name: string; data: SceneData }> = [];
    for (const name of config.sceneNames) {
        const sceneText = await platformReadTextFile(`scenes/${name}.json`);
        scenes.push({ name, data: JSON.parse(sceneText) });
    }

    await initRuntime({
        app,
        module,
        source,
        scenes,
        firstScene: config.firstScene,
        physicsConfig: config.physicsConfig,
        aspectRatio: canvas.width / canvas.height,
    });

    app.run();
}
