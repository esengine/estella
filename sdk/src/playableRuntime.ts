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
    /**
     * Logical (source) path → embedded-asset key (`@uuid:<id>`), so path-style
     * refs (a scene's "assets/x.esmaterial", a material's rewritten logical
     * refs) resolve to the inlined data. Applied as in-memory ALIASES onto the
     * assets map — every channel (fetch, image decode, audio) reads that one
     * map, and aliases share the data-URL strings (no payload duplication).
     */
    assetPathMap?: Record<string, string>;
    scenes: Array<{ name: string; data: SceneData }>;
    firstScene: string;
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number };
    /** Bitmask of render layers (0..31) that y-sort within the layer (Project Settings → Rendering). */
    ySortLayers?: number;
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
    const { app, module, scenes, firstScene } = config;

    // The playable boot pre-creates the app, so the project's y-sort layers are
    // applied here rather than through createWebApp options.
    if (config.ySortLayers) module.renderer_setYSortLayers?.(config.ySortLayers >>> 0);

    // Alias logical paths onto the embedded map (both spellings the cook may
    // emit) — the aliases point at the SAME data-URL strings, so path refs cost
    // nothing and every consumer below resolves through one map.
    const assets = { ...config.assets };
    for (const [logical, key] of Object.entries(config.assetPathMap ?? {})) {
        const data = assets[key];
        if (!data) continue;
        assets[logical] ??= data;
        assets[`/${logical}`] ??= data;
    }

    // Canonical asset source: the shared EmbeddedBackend (data-URLs) + a DOM image
    // decode over the same data-URL. Refs are the map keys (resolveRef = identity).
    const backend = new EmbeddedBackend(assets);
    const source: RuntimeAssetSource = {
        backend,
        decodePixels: (path) => loadImagePixels(backend.resolveUrl(path)),
        // Map keys are the shippable paths (logical aliases included) — the
        // .eslocale discovery filters on extension, so aliases resolve fine.
        listAssetPaths: () => Object.keys(assets),
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
