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
 *          entry only owns the embedded asset source + the runtime boot.
 */
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { initRuntime } from './runtimeLoader';
import type { RuntimeAssetSource } from './runtimeAssets';
import { EmbeddedBackend } from './asset/Backend';
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

    // Canonical asset source: the shared EmbeddedBackend (data-URLs) + a DOM image
    // decode over the same data-URL. Refs are the map keys (resolveRef = identity).
    const backend = new EmbeddedBackend(assets);
    const source: RuntimeAssetSource = {
        backend,
        decodePixels: (path) => loadImagePixels(backend.resolveUrl(path)),
    };

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
        source,
        scenes,
        firstScene,
        physicsConfig: config.physicsConfig,
        aspectRatio: config.canvas.width / config.canvas.height,
    });

    app.run();
}
