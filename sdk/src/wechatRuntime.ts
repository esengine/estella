// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wechatRuntime.ts
 * @brief   WeChat MiniGame runtime initialization
 */

/// <reference types="minigame-api-typings" />

import { createWebApp } from './webAppFactory';
import type { ESEngineModule } from './wasm';
import type { RuntimeAssetProvider } from './runtimeLoader';
import { initRuntime } from './runtimeLoader';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from './defaults';
import { platformReadTextFile, platformReadFile, platformInstantiateWasm, platformLoadImagePixels } from './platform';
import { toBuildPath } from './assetTypes';
import type { AddressableManifest } from './asset/AddressableManifest';
import { createWeChatSideModuleHost, type WeChatSideModuleFactories } from './sideModules';
import type { Vec2 } from './types';
import type { SceneData } from './scene';
import { log } from './logger';

// =============================================================================
// WeChat Asset Provider
// =============================================================================

export class WeChatAssetProvider implements RuntimeAssetProvider {
    private readonly resolvePath_: (ref: string) => string;

    constructor(resolvePath: (ref: string) => string) {
        this.resolvePath_ = resolvePath;
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        return platformLoadImagePixels(this.resolvePath_(ref));
    }

    async readText(ref: string): Promise<string> {
        return platformReadTextFile(this.resolvePath_(ref));
    }

    async readBinary(ref: string): Promise<Uint8Array> {
        const buffer = await platformReadFile(this.resolvePath_(ref));
        return new Uint8Array(buffer);
    }

    resolvePath(ref: string): string {
        return this.resolvePath_(ref);
    }
}

// =============================================================================
// Manifest Utilities
// =============================================================================

interface ManifestIndex {
    assetIndex: Record<string, { path: string }>;
    pathIndex: Record<string, { path: string }>;
}

function buildManifestIndex(manifest: AddressableManifest): ManifestIndex {
    const assetIndex: Record<string, { path: string }> = {};
    const pathIndex: Record<string, { path: string }> = {};
    for (const groupName in manifest.groups) {
        const group = manifest.groups[groupName];
        for (const uuid in group.assets) {
            const entry = group.assets[uuid];
            assetIndex[uuid] = entry;
            pathIndex[entry.path] = entry;
        }
    }
    return { assetIndex, pathIndex };
}

function createPathResolver(index: ManifestIndex): (ref: string) => string {
    const { assetIndex, pathIndex } = index;
    return (ref: string): string => {
        const resolved = toBuildPath(ref);
        const entry = assetIndex[ref] || assetIndex[resolved]
            || pathIndex[resolved] || pathIndex[ref];
        return entry ? entry.path : resolved;
    };
}

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
    const manifestIndex = buildManifestIndex(manifest);
    const resolvePath = createPathResolver(manifestIndex);

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

    const provider = new WeChatAssetProvider(resolvePath);

    const scenes: Array<{ name: string; data: SceneData }> = [];
    for (const name of config.sceneNames) {
        const sceneText = await platformReadTextFile(`scenes/${name}.json`);
        scenes.push({ name, data: JSON.parse(sceneText) });
    }

    await initRuntime({
        app,
        module,
        provider,
        scenes,
        firstScene: config.firstScene,
        physicsConfig: config.physicsConfig,
        manifest,
        aspectRatio: canvas.width / canvas.height,
    });

    app.run();
}
