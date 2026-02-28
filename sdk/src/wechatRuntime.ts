/**
 * @file    wechatRuntime.ts
 * @brief   WeChat MiniGame runtime initialization
 */

/// <reference types="minigame-api-typings" />

import { flushPendingSystems } from './app';
import { createWebApp } from './webAppFactory';
import type { ESEngineModule } from './wasm';
import type { RuntimeAssetProvider } from './runtimeLoader';
import { createRuntimeSceneConfig } from './runtimeLoader';
import { updateCameraAspectRatio } from './scene';
import { SceneManager } from './sceneManager';
import { applyBuildRuntimeConfig, type RuntimeBuildConfig } from './defaults';
import { platformReadTextFile, platformReadFile, platformInstantiateWasm, platformLoadImagePixels } from './platform';
import { toBuildPath } from './assetTypes';
import type { AddressableManifest } from './asset/AssetServer';
import type { SpineWasmModule } from './spine/SpineModuleLoader';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import type { Vec2 } from './types';

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

function createWasmInstantiator(wasmPath: string) {
    return (imports: WebAssembly.Imports, successCallback: Function) => {
        platformInstantiateWasm(wasmPath, imports).then((result) => {
            successCallback(result.instance, result.module);
        });
        return {};
    };
}

async function initWasmModule<T>(
    factory: (opts: unknown) => Promise<T>,
    wasmPath: string,
): Promise<T | null> {
    try {
        return await factory({
            instantiateWasm: createWasmInstantiator(wasmPath),
        });
    } catch (e) {
        console.warn(`[ESEngine] Failed to load WASM module: ${wasmPath}`, e);
        return null;
    }
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
    spineFactory?: (opts: unknown) => Promise<SpineWasmModule>;
    physicsFactory?: (opts: unknown) => Promise<PhysicsWasmModule>;
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

    const module = await config.engineFactory({
        canvas,
        instantiateWasm: createWasmInstantiator('esengine.wasm'),
    });

    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
        console.error('[ESEngine] Failed to create WebGL context');
        return;
    }

    const glHandle = (module as any).GL.registerContext(gl, {
        majorVersion: (gl as any).getParameter((gl as any).VERSION).indexOf('WebGL 2') === 0 ? 2 : 1,
        minorVersion: 0,
        enableExtensionsByDefault: true,
    });

    const app = createWebApp(module, {
        glContextHandle: glHandle,
        getViewportSize: () => ({
            width: canvas.width,
            height: canvas.height,
        }),
    });

    if (config.runtimeConfig) {
        applyBuildRuntimeConfig(app, config.runtimeConfig);
    }

    flushPendingSystems(app);

    let spineModule: SpineWasmModule | null = null;
    if (config.spineFactory) {
        spineModule = await initWasmModule(config.spineFactory, 'spine.wasm');
    }

    let physicsModule: PhysicsWasmModule | null = null;
    if (config.physicsFactory) {
        physicsModule = await initWasmModule(config.physicsFactory, 'physics.wasm');
    }

    const provider = new WeChatAssetProvider(resolvePath);
    const sceneOpts = {
        app,
        module,
        provider,
        spineModule,
        physicsModule,
        physicsConfig: config.physicsConfig,
        manifest,
    };

    const mgr = app.getResource(SceneManager);
    for (const name of config.sceneNames) {
        const sceneText = await platformReadTextFile(`scenes/${name}.json`);
        const sceneData = JSON.parse(sceneText);
        mgr.register(createRuntimeSceneConfig(name, sceneData, sceneOpts));
    }

    if (config.firstScene) {
        mgr.setInitial(config.firstScene);
        await mgr.load(config.firstScene);
    }

    const screenAspect = canvas.width / canvas.height;
    updateCameraAspectRatio(app.world, screenAspect);

    app.run();
}
