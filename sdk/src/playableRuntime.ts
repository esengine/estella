// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    playableRuntime.ts
 * @brief   Playable ad runtime initialization (single-HTML builds)
 *
 * @details Side modules (physics, spine) are NOT wired here: the host page builds
 *          an {@link createEmbeddedSideModuleHost} from the exporter-inlined
 *          base64 registry and hands it to `createWebApp`, so physics and spine
 *          self-gate off `app.sideModules` exactly as in every other realm. This
 *          entry only owns the embedded asset provider + the runtime boot.
 */
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { initRuntime } from './runtimeLoader';
import type { RuntimeAssetProvider } from './runtimeLoader';
import type { AddressableManifest } from './asset/AddressableManifest';
import type { Vec2 } from './types';
import type { SceneData } from './scene';
import { Audio } from './audio/Audio';

export interface PlayableRuntimeConfig {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    assets: Record<string, string>;
    scenes: Array<{ name: string; data: SceneData }>;
    firstScene: string;
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number };
    manifest?: AddressableManifest | null;
}

class EmbeddedAssetProvider implements RuntimeAssetProvider {
    private readonly assets_: Record<string, string>;

    constructor(assets: Record<string, string>) {
        this.assets_ = assets;
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        return loadImagePixels(this.getAsset(ref));
    }

    readText(ref: string): string {
        return decodeDataUrlText(this.getAsset(ref));
    }

    readBinary(ref: string): Uint8Array {
        return decodeDataUrlBinary(this.getAsset(ref));
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

export async function initPlayableRuntime(config: PlayableRuntimeConfig): Promise<void> {
    const { app, module, assets, scenes, firstScene } = config;

    const provider = new EmbeddedAssetProvider(assets);

    if (app.hasResource(Audio)) {
        app.getResource(Audio).setAssetResolver((url: string) => {
            const dataUrl = assets[url];
            if (!dataUrl) return null;
            return decodeDataUrlBinary(dataUrl).buffer as ArrayBuffer;
        });
    }

    await initRuntime({
        app,
        module,
        provider,
        scenes,
        firstScene,
        physicsConfig: config.physicsConfig,
        manifest: config.manifest,
        aspectRatio: config.canvas.width / config.canvas.height,
    });

    app.run();
}
