/**
 * @file    playableRuntime.ts
 * @brief   Playable ad runtime initialization (single-HTML builds)
 */

import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { initRuntime } from './runtimeLoader';
import type { RuntimeAssetProvider } from './runtimeLoader';
import { Assets } from './asset/AssetPlugin';
import type { AddressableManifest } from './asset/AssetServer';
import type { Vec2 } from './types';
import type { SpineWasmModule } from './spine/SpineModuleLoader';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import type { SceneData } from './scene';

declare const ESSpineModule: ((opts: unknown) => Promise<SpineWasmModule>) | undefined;
declare const ESPhysicsModule: ((opts: unknown) => Promise<PhysicsWasmModule>) | undefined;

export interface PlayableRuntimeConfig {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    assets: Record<string, string>;
    sceneData: SceneData;
    sceneName: string;
    spineWasmBase64?: string;
    physicsWasmBase64?: string;
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number };
    manifest?: AddressableManifest | null;
}

class EmbeddedAssetProvider implements RuntimeAssetProvider {
    private readonly assets_: Record<string, string>;

    constructor(assets: Record<string, string>) {
        this.assets_ = assets;
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        const dataUrl = this.getAsset(ref);
        return loadImagePixels(dataUrl);
    }

    readText(ref: string): string {
        const dataUrl = this.getAsset(ref);
        return decodeDataUrlText(dataUrl);
    }

    readBinary(ref: string): Uint8Array {
        const dataUrl = this.getAsset(ref);
        return decodeDataUrlBinary(dataUrl);
    }

    resolvePath(ref: string): string {
        return ref;
    }

    private getAsset(ref: string): string {
        const d = this.assets_[ref];
        if (!d) throw new Error(`Asset not found: ${ref}`);
        return d;
    }
}

function decodeDataUrlText(dataUrl: string): string {
    return atob(dataUrl.split(',')[1]);
}

function decodeDataUrlBinary(dataUrl: string): Uint8Array {
    const raw = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

function loadImagePixels(dataUrl: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = img.width;
            cv.height = img.height;
            const ctx = cv.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const id = ctx.getImageData(0, 0, img.width, img.height);
            resolve({ width: img.width, height: img.height, pixels: new Uint8Array(id.data.buffer) });
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

function decodeBase64ToWasm(base64: string): Uint8Array {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

async function instantiateWasmModule(
    factory: (opts: unknown) => Promise<unknown>,
    wasmBase64: string,
): Promise<unknown | null> {
    try {
        const wasmBytes = decodeBase64ToWasm(wasmBase64);
        return await factory({
            instantiateWasm(imports: WebAssembly.Imports, cb: Function) {
                (WebAssembly.instantiate(wasmBytes.buffer as ArrayBuffer, imports) as
                    Promise<WebAssembly.WebAssemblyInstantiatedSource>).then(r => {
                    cb(r.instance, r.module);
                });
                return {};
            },
        });
    } catch (e) {
        return null;
    }
}

async function initSpineModule(wasmBase64: string): Promise<SpineWasmModule | null> {
    if (typeof ESSpineModule === 'undefined') return null;
    const mod = await instantiateWasmModule(ESSpineModule, wasmBase64);
    if (!mod) console.warn('Spine module not available');
    return mod as SpineWasmModule | null;
}

async function initPhysicsModule(wasmBase64: string): Promise<PhysicsWasmModule | null> {
    if (typeof ESPhysicsModule === 'undefined') return null;
    const mod = await instantiateWasmModule(ESPhysicsModule, wasmBase64);
    if (!mod) console.warn('Physics module not available');
    return mod as PhysicsWasmModule | null;
}

export async function initPlayableRuntime(config: PlayableRuntimeConfig): Promise<void> {
    const { app, module, assets, sceneData, sceneName } = config;

    const assetServer = app.getResource(Assets);
    if (assetServer) {
        assetServer.registerEmbeddedAssets(assets);
        assetServer.setEmbeddedOnly(true);
    }

    const spineModule = config.spineWasmBase64
        ? await initSpineModule(config.spineWasmBase64)
        : null;

    const physicsModule = config.physicsWasmBase64
        ? await initPhysicsModule(config.physicsWasmBase64)
        : null;

    const provider = new EmbeddedAssetProvider(assets);

    await initRuntime({
        app,
        module,
        provider,
        scenes: [{ name: sceneName, data: sceneData }],
        firstScene: sceneName,
        spineModule,
        physicsModule,
        physicsConfig: config.physicsConfig,
        manifest: config.manifest,
        aspectRatio: config.canvas.width / config.canvas.height,
    });

    app.run();
}
