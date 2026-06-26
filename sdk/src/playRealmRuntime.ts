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
import type { RuntimeAssetProvider } from './runtimeLoader';
import type { AddressableManifest } from './asset/AddressableManifest';
import type { SceneData } from './scene';
import type { Vec2 } from './types';
import { decodeImagePixels } from './asset/imageDecode';

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
    /** Optional physics world overrides (e.g. project-declared gravity). */
    physicsGravity?: Vec2;
    /** Turn on per-phase / per-system frame timing (editor profiler; off in shipped games). */
    enableStats?: boolean;
}

/**
 * Fetches scene assets over the realm origin, resolving `@uuid:` refs through the
 * editor-supplied manifest. Images go fetch → blob → the shared `decodeImagePixels`
 * (NOT `<img crossorigin>`: Chromium refuses CORS-mode images for custom schemes
 * like `estella://`, and a non-CORS `<img>` would taint the canvas so getImageData
 * throws — fetch+blob sidesteps both). `estella://` is fetchable because it's a
 * privileged supportFetchAPI scheme; the editor returns `access-control-allow-origin: *`.
 */
class FetchAssetProvider implements RuntimeAssetProvider {
    constructor(private readonly manifest: Record<string, string>) {}

    resolvePath(ref: string): string {
        if (!ref.startsWith(UUID_PREFIX)) return ref;
        const url = this.manifest[ref.slice(UUID_PREFIX.length).toLowerCase()];
        if (!url) throw new Error(`asset not in play manifest: ${ref}`);
        return url;
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        const url = this.resolvePath(ref);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`image fetch failed (${res.status}): ${url}`);
        return decodeImagePixels(await res.blob());
    }

    async readText(ref: string): Promise<string> {
        return (await fetch(this.resolvePath(ref))).text();
    }

    async readBinary(ref: string): Promise<Uint8Array> {
        return new Uint8Array(await (await fetch(this.resolvePath(ref))).arrayBuffer());
    }
}

/**
 * Boot the shipping runtime against a single in-memory scene snapshot. The host
 * page has already created `app` (createWebApp) + bound a GL context; here we
 * register the snapshot as the sole scene, wire a fetch-backed provider, and run.
 */
export async function initPlayRealmRuntime(config: PlayRealmRuntimeConfig): Promise<void> {
    const { app, module, canvas, sceneData, assetManifest, manifest } = config;
    const provider = new FetchAssetProvider(assetManifest);
    await initRuntime({
        app,
        module,
        provider,
        scenes: [{ name: '__play', data: sceneData }],
        firstScene: '__play',
        manifest: manifest ?? null,
        aspectRatio: canvas.width / canvas.height,
        physicsEnabled: config.physicsEnabled,
        physicsConfig: config.physicsGravity ? { gravity: config.physicsGravity } : undefined,
        // Physics (and spine) are acquired from app.sideModules — the fetch host
        // createWebApp built from this realm's wasmBaseUrl.
    });
    // Per-phase / per-system frame timing for the editor profiler (enabled before
    // the loop starts so the runner instruments from frame zero).
    if (config.enableStats) app.enableStats();
    app.run();
}
