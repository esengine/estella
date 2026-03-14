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
import { SpineManager, type SpineVersion } from './spine/SpineManager';
import { SpinePlugin } from './spine/SpinePlugin';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import type { SceneData } from './scene';
import { Audio } from './audio/Audio';

declare const ESPhysicsModule: ((opts: unknown) => Promise<PhysicsWasmModule>) | undefined;

export interface SpineModuleEntry {
    factory: (opts: unknown) => Promise<SpineWasmModule>;
    wasmBase64: string;
}

export interface PlayableRuntimeConfig {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    assets: Record<string, string>;
    scenes: Array<{ name: string; data: SceneData }>;
    firstScene: string;
    spineModules?: Record<string, SpineModuleEntry>;
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
        const opts: Record<string, unknown> = {
            instantiateWasm(imports: WebAssembly.Imports, cb: Function) {
                const response = new Response(wasmBytes.buffer as ArrayBuffer, {
                    headers: { 'Content-Type': 'application/wasm' },
                });
                WebAssembly.instantiateStreaming(response, imports).then(
                    r => cb(r.instance, r.module),
                    () => {
                        WebAssembly.instantiate(wasmBytes.buffer as ArrayBuffer, imports).then(
                            r => cb((r as WebAssembly.WebAssemblyInstantiatedSource).instance,
                                    (r as WebAssembly.WebAssemblyInstantiatedSource).module),
                        ).catch(e => {
                            console.error('[Playable] WASM instantiation fallback failed:', e);
                        });
                    },
                );
                return {};
            },
        };
        return await factory(opts);
    } catch (e) {
        console.error('[Playable] WASM module init failed:', e);
        return null;
    }
}

async function initPhysicsModule(wasmBase64: string): Promise<PhysicsWasmModule | null> {
    if (typeof ESPhysicsModule === 'undefined') return null;
    const mod = await instantiateWasmModule(ESPhysicsModule, wasmBase64);
    if (!mod) console.warn('Physics module not available');
    return mod as PhysicsWasmModule | null;
}

function buildSpineManager(
    module: ESEngineModule,
    spineModules: Record<string, SpineModuleEntry>,
): SpineManager {
    const factories = new Map<SpineVersion, () => Promise<SpineWasmModule>>();
    for (const [version, entry] of Object.entries(spineModules)) {
        const ver = version as SpineVersion;
        factories.set(ver, async () => {
            const wasmBytes = decodeBase64ToWasm(entry.wasmBase64);
            return entry.factory({
                instantiateWasm(imports: WebAssembly.Imports, cb: Function) {
                    const response = new Response(wasmBytes.buffer as ArrayBuffer, {
                        headers: { 'Content-Type': 'application/wasm' },
                    });
                    WebAssembly.instantiateStreaming(response, imports).then(
                        r => cb(r.instance, r.module),
                        () => {
                            WebAssembly.instantiate(wasmBytes.buffer as ArrayBuffer, imports).then(
                                r => cb((r as WebAssembly.WebAssemblyInstantiatedSource).instance,
                                        (r as WebAssembly.WebAssemblyInstantiatedSource).module),
                            ).catch(e => {
                                console.error('[Playable] Spine WASM instantiation fallback failed:', e);
                            });
                        },
                    );
                    return {};
                },
            }) as Promise<SpineWasmModule>;
        });
    }
    return new SpineManager(module, factories);
}

export async function initPlayableRuntime(config: PlayableRuntimeConfig): Promise<void> {
    const { app, module, assets, scenes, firstScene } = config;

    // Embedded assets are handled by EmbeddedBackend in the new Assets architecture
    // The old registerEmbeddedAssets/setEmbeddedOnly calls are no longer needed

    let spineManager: SpineManager | null = null;
    if (config.spineModules && Object.keys(config.spineModules).length > 0) {
        spineManager = buildSpineManager(module, config.spineModules);
        const spinePlugin = app.getPlugin(SpinePlugin);
        if (spinePlugin) {
            spinePlugin.setSpineManager(spineManager);
        }
    }

    const physicsModule = config.physicsWasmBase64
        ? await initPhysicsModule(config.physicsWasmBase64)
        : null;

    const provider = new EmbeddedAssetProvider(assets);

    Audio.setAssetResolver((url: string) => {
        const dataUrl = assets[url];
        if (!dataUrl) return null;
        return decodeDataUrlBinary(dataUrl).buffer as ArrayBuffer;
    });

    await initRuntime({
        app,
        module,
        provider,
        scenes,
        firstScene,
        spineManager,
        physicsModule,
        physicsConfig: config.physicsConfig,
        manifest: config.manifest,
        aspectRatio: config.canvas.width / config.canvas.height,
    });

    app.run();
}
