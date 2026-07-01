// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    playRealmRuntime.ts
 * @brief   Editor play-realm runtime entry — the SAME shipping runtime
 *          (`initRuntime`) the playable/wechat paths use, but driven from a live
 *          scene SNAPSHOT + a uuid→url asset manifest fetched over the realm
 *          origin. So what the editor "plays" is literally the shipping runtime
 *          (play == ship). Mirrors {@link initPlayableRuntime} minus the
 *          base64/embedded asset packing.
 *
 *          Builtin components/systems run as-is. Project-defined components/systems
 *          are already registered by the time this runs: the host imports the project
 *          bundle (esengine external + import map → the shared instance) BEFORE booting,
 *          so its defineComponent/defineSystem populate the registry this drains. This
 *          entry only owns the runtime + snapshot + asset fetch.
 */
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { initRuntime } from './runtimeLoader';
import type { RuntimeAssetSource } from './runtimeAssets';
import { HttpBackend } from './asset/Backend';
import type { AddressableManifest } from './asset/AddressableManifest';
import type { SceneData } from './scene';
import type { PhysicsPluginConfig } from './physics/PhysicsPlugin';
import { fetchDecodePixels } from './asset/imageDecode';

const UUID_PREFIX = '@uuid:';

export interface PlayRealmRuntimeConfig {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    /** The current scene as RAW (`@uuid:`) SceneData — handles are realm-local. */
    sceneData: SceneData;
    /** Lowercased uuid → fetchable URL (e.g. `estella://project/<path>`). */
    assetManifest: Record<string, string>;
    manifest?: AddressableManifest | null;
    /** Base URL the engine side-modules (physics.wasm, …) are served from — same
     *  dir as esengine.wasm. When set, the realm can load physics on demand. */
    wasmBaseUrl?: string;
    /** Project-declared physics enable (`.uproject` features analog) — installs
     *  physics even for runtime-spawned bodies the static scene doesn't show. */
    physicsEnabled?: boolean;
    /** Project-declared physics world config (gravity, solver tuning, collision-layer
     *  masks, sleep/continuous) from the editor's Project Settings. */
    physicsConfig?: PhysicsPluginConfig;
    /** Turn on per-phase / per-system frame timing (editor profiler; off in shipped games). */
    enableStats?: boolean;
}

/**
 * Build the realm's asset source: `@uuid:` refs resolve through the editor-supplied
 * manifest (`resolveRef`), fetch goes over the realm origin via `HttpBackend`, and
 * images go fetch → blob → decode (NOT `<img crossorigin>`: Chromium refuses
 * CORS-mode images for custom schemes like `estella://`, and a non-CORS `<img>`
 * taints the canvas so getImageData throws — fetch+blob sidesteps both).
 * `estella://` is fetchable because it's a privileged supportFetchAPI scheme; the
 * editor returns `access-control-allow-origin: *`.
 */
function createPlayRealmSource(manifest: Record<string, string>): RuntimeAssetSource {
    const backend = new HttpBackend({ baseUrl: '' });
    const resolveRef = (ref: string): string => {
        if (!ref.startsWith(UUID_PREFIX)) return ref;
        const url = manifest[ref.slice(UUID_PREFIX.length).toLowerCase()];
        if (!url) throw new Error(`asset not in play manifest: ${ref}`);
        return url;
    };
    return {
        backend,
        decodePixels: (path) => fetchDecodePixels(backend.resolveUrl(path)),
        resolveRef,
    };
}

/**
 * Boot the shipping runtime against a single in-memory scene snapshot. The host
 * page has already created `app` (createWebApp) + bound a GL context; here we
 * register the snapshot as the sole scene, wire a fetch-backed source, and run.
 */
export async function initPlayRealmRuntime(config: PlayRealmRuntimeConfig): Promise<void> {
    const { app, module, canvas, sceneData, assetManifest } = config;
    const source = createPlayRealmSource(assetManifest);
    await initRuntime({
        app,
        module,
        source,
        scenes: [{ name: '__play', data: sceneData }],
        firstScene: '__play',
        aspectRatio: canvas.width / canvas.height,
        physicsEnabled: config.physicsEnabled,
        physicsConfig: config.physicsConfig,
        // Physics (and spine) are acquired from app.sideModules — the fetch host
        // createWebApp built from this realm's wasmBaseUrl.
    });
    // Per-phase / per-system frame timing for the editor profiler (enabled before
    // the loop starts so the runner instruments from frame zero).
    if (config.enableStats) app.enableStats();
    app.run();
}
