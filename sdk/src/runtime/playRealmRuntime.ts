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
import type { App } from '../app/app';
import type { ESEngineModule } from '../wasm';
import { Audio } from '../audio/Audio';
import { VideoPlayer } from '../video/VideoAPI';
import { initRuntime } from './runtimeLoader';
import type { ThemeOverrides } from '../ui';
import type { RuntimeAssetSource } from './runtimeAssets';
import { HttpBackend } from '../asset/Backend';
import { Catalog, type CatalogData } from '../asset/Catalog';
import { ManifestModel, type AddressableManifest } from '../asset/AddressableManifest';
import type { SceneData } from '../scene/scene';
import type { PhysicsPluginConfig } from '../physics/PhysicsPlugin';
import type { AudioProjectConfig } from '../audio/AudioProjectConfig';
import { fetchDecodePixels } from '../asset/imageDecode';
import { applyAssetRefResolvers } from './packagedRuntime';
import { extractUuid, UUID_REF_PREFIX } from '../asset/AssetRegistry';

export interface PlayRealmRuntimeConfig {
    app: App;
    module: ESEngineModule;
    canvas: HTMLCanvasElement;
    /** The current scene as RAW (`@uuid:`) SceneData — handles are realm-local. */
    sceneData: SceneData;
    /** Additional switchable scenes beyond the entry (SceneManager targets).
     *  `path` entries load lazily through the runtime Assets on first switch. */
    extraScenes?: Array<{ name: string; data?: SceneData; path?: string }>;
    /** SceneManager name of the entry `sceneData` (default '__play'). Shipped
     *  builds pass the real scene name so game code can switch back to it. */
    entrySceneName?: string;
    /** Lowercased uuid → fetchable URL (e.g. `estella://project/<path>`). */
    assetManifest: Record<string, string>;
    /**
     * Logical (source) path → fetchable staged path, for cooked builds whose
     * content-addressed staging renamed the physical files. Path-style refs
     * (a scene's "assets/x.esmaterial") resolve through this BEFORE extension
     * sniffing, exactly like uuid refs — so a .png staged as .ktx2 transcodes.
     * Omit when files are served at their logical paths (the editor realm).
     */
    assetPathMap?: Record<string, string>;
    /**
     * Logical path → build-path catalog for the same cooked case: loaders fetch
     * their INNER text refs (a material's shader) through Catalog.getBuildPath,
     * which is identity without this. Omit alongside assetPathMap.
     */
    catalogData?: CatalogData | null;
    manifest?: AddressableManifest | null;
    /** CDN root `remote`-group assets resolve against — turns on hot-update delivery. */
    remoteRoot?: string;
    /** Storage key an applied hot-update persists under; boot restores it if present. */
    persistUpdateKey?: string;
    /** Base URL the engine side-modules (physics.wasm, …) are served from — same
     *  dir as esengine.wasm. When set, the realm can load physics on demand. */
    wasmBaseUrl?: string;
    /** Project-root URL for path-addressed runtime assets. Textures resolve
     *  through the uuid manifest, but the audio channel takes plain project-relative
     *  paths (`audio.playSFX('assets/…')`), so it needs this base to fetch from the
     *  project rather than the play-realm subdir. */
    assetBaseUrl?: string;
    /** Project-declared physics enable (`.uproject` features analog) — installs
     *  physics even for runtime-spawned bodies the static scene doesn't show. */
    physicsEnabled?: boolean;
    /** Project-declared physics world config (gravity, solver tuning, collision-layer
     *  masks, sleep/continuous) from the editor's Project Settings. */
    physicsConfig?: PhysicsPluginConfig;
    /** Project-declared UI theme; 'light' re-skins ThemeStyle-tagged widgets at boot. */
    uiTheme?: 'dark' | 'light';
    /** Project-declared theme token overrides (partial re-skin over the base). */
    uiThemeOverrides?: ThemeOverrides;
    /** Project-declared mixer state (bus volumes / effects / duck rules). */
    audioConfig?: AudioProjectConfig;
    /** The project's declared achievement ids — Play checks an unlock against the
     *  same set a shipped build does, so a typo is found here. */
    achievements?: string[];
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
/**
 * Resolve a play-realm asset ref to a fetchable URL. UUID refs go through the
 * editor-supplied manifest — a `@uuid:` prefix is explicit intent (any body), and
 * a BARE uuid-shaped ref counts too ({@link extractUuid}'s canonical forms):
 * `.esanim` flipbook frames serialize bare uuids, and the old prefix-only check
 * dropped those into the path branch → guaranteed 404s, blank sprite animation
 * in play. Any other ref is a project-relative path (spine skel/atlas, …) and
 * resolves against the project root, not the `.esengine/play/` subdir the realm
 * runs from. Pure.
 */
export function resolvePlayAssetRef(
    ref: string,
    manifest: Record<string, string>,
    assetBaseUrl?: string,
    pathMap?: Record<string, string>,
): string {
    const uuid = ref.startsWith(UUID_REF_PREFIX)
        ? ref.slice(UUID_REF_PREFIX.length).toLowerCase()
        : extractUuid(ref);
    if (uuid !== null) {
        const url = manifest[uuid];
        if (!url) throw new Error(`asset not in play manifest: ${ref}`);
        return url;
    }
    // Cooked builds: a logical path maps to its staged file (content-addressed
    // rename + possible extension swap) — resolved here so the result is the
    // extension-bearing physical path, same contract as the uuid branch.
    if (pathMap) {
        const staged = pathMap[ref] ?? pathMap[ref.replace(/^\.?\//, '')];
        if (staged) return staged;
    }
    const base = (assetBaseUrl ?? '').replace(/\/$/, '');
    // Idempotent, like HttpBackend.resolveUrl: an already-resolved absolute URL or
    // base-prefixed path must not be prefixed again. Preload resolves a ref once to
    // bucket it by type, then the loader resolves it a second time — without this
    // guard a plain path would gain the base twice (estella://…/estella://…/404).
    if (ref.includes('://') || (base && ref.startsWith(`${base}/`))) return ref;
    return base ? `${base}/${ref.replace(/^\//, '')}` : ref;
}

function createPlayRealmSource(
    manifest: Record<string, string>,
    assetBaseUrl?: string,
    pathMap?: Record<string, string>,
    addressable?: AddressableManifest | null,
): RuntimeAssetSource {
    const backend = new HttpBackend({ baseUrl: '' });
    return {
        backend,
        decodePixels: (path) => fetchDecodePixels(backend.resolveUrl(path)),
        resolveRef: (ref) => resolvePlayAssetRef(ref, manifest, assetBaseUrl, pathMap),
        // Cooked builds: logical paths (the pathMap keys). Editor play: the
        // manifest's resolved URLs — both keep the real extension, which is all
        // the .eslocale discovery filters on.
        listAssetPaths: () => (pathMap ? Object.keys(pathMap) : Object.values(manifest)),
        // Sampling and the 9-slice border come off the addressable manifest, the
        // same field a cooked build reads — Play and ship cannot disagree about
        // an asset when they are looking at one description of it.
        ...(addressable
            ? { textureImportSettings: ManifestModel.fromJson(addressable).textureImportLookup() }
            : {}),
    };
}

/**
 * Boot the shipping runtime against a single in-memory scene snapshot. The host
 * page has already created `app` (createWebApp) + bound a GL context; here we
 * register the snapshot as the sole scene, wire a fetch-backed source, and run.
 */
export async function initPlayRealmRuntime(config: PlayRealmRuntimeConfig): Promise<void> {
    const { app, module, canvas, sceneData, assetManifest, assetBaseUrl } = config;
    const source = createPlayRealmSource(assetManifest, assetBaseUrl, config.assetPathMap, config.manifest);
    applyAssetRefResolvers(app, (ref) => resolvePlayAssetRef(ref, assetManifest, assetBaseUrl, config.assetPathMap));
    const entryName = config.entrySceneName ?? '__play';
    await initRuntime({
        app,
        module,
        source,
        manifest: config.manifest,
        remoteRoot: config.remoteRoot,
        persistUpdateKey: config.persistUpdateKey,
        catalog: config.catalogData ? Catalog.fromJson(config.catalogData) : undefined,
        scenes: [
            { name: entryName, data: sceneData },
            ...(config.extraScenes ?? []).filter((s) => s.name !== entryName),
        ],
        firstScene: entryName,
        aspectRatio: canvas.width / canvas.height,
        physicsEnabled: config.physicsEnabled,
        physicsConfig: config.physicsConfig,
        uiTheme: config.uiTheme,
        uiThemeOverrides: config.uiThemeOverrides,
        audioConfig: config.audioConfig,
        achievements: config.achievements,
        // Physics (and spine) are acquired from app.sideModules — the fetch host
        // createWebApp built from this realm's wasmBaseUrl.
    });
    // Per-phase / per-system frame timing for the editor profiler (enabled before
    // the loop starts so the runner instruments from frame zero).
    if (config.enableStats) app.enableStats();
    app.run();
}
