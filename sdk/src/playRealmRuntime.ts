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
 *          (a bundle loaded with esengine external + an import map) are a layered
 *          follow-up — this entry only owns the runtime + snapshot + asset fetch.
 */
import type { App } from './app';
import type { ESEngineModule } from './wasm';
import { initRuntime } from './runtimeLoader';
import type { RuntimeAssetProvider } from './runtimeLoader';
import type { AddressableManifest } from './asset/AddressableManifest';
import type { SceneData } from './scene';

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
}

/**
 * Fetches scene assets over the realm origin, resolving `@uuid:` refs through the
 * editor-supplied manifest. Images are decoded via fetch → blob →
 * `createImageBitmap` → canvas → getImageData (NOT `<img crossorigin>`: Chromium
 * refuses CORS-mode images for custom schemes like `estella://`, and a non-CORS
 * `<img>` would taint the canvas so getImageData throws — fetch+blob sidesteps
 * both). `estella://` is fetchable because it's a privileged supportFetchAPI
 * scheme; the editor's handler returns `access-control-allow-origin: *`.
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
        const bitmap = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        try {
            const cv = document.createElement('canvas');
            cv.width = bitmap.width;
            cv.height = bitmap.height;
            const ctx = cv.getContext('2d');
            if (!ctx) throw new Error('2d context unavailable');
            ctx.drawImage(bitmap, 0, 0);
            const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            return { width: bitmap.width, height: bitmap.height, pixels: new Uint8Array(id.data.buffer) };
        } finally {
            bitmap.close();
        }
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
    });
    app.run();
}
