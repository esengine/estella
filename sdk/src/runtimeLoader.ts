// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

import { SceneOwner } from './component';
import { loadSceneData, updateCameraAspectRatio, type SceneData } from './scene';
import { discoverSceneAssets } from './asset/discoverAssets';
import type { ESEngineModule } from './wasm';
import type { SpineWasmModule } from './spine/SpineModuleLoader';
import { SpineManager } from './spine/SpineManager';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import { PhysicsPlugin, type PhysicsPluginConfig } from './physics/PhysicsPlugin';
import { SpinePlugin } from './spine/SpinePlugin';
import type { App } from './app';
import { Assets as AssetsClass } from './asset/Assets';
import { Assets as AssetsResource } from './asset/AssetPlugin';
import { initBuiltinAssetFields } from './asset/AssetFieldRegistry';
import { transcoderFromModule, type BasisWasmModule } from './asset/basisTranscoder';
import type { TextureImportSettings } from './asset/loaders/TextureLoader';
import { SceneManager, type SceneConfig } from './sceneManager';
import { DEFAULT_GRAVITY, DEFAULT_FIXED_TIMESTEP } from './defaults';
import { SpriteAnimation } from './animation/SpriteAnimator';
import { Audio } from './audio/Audio';
import { Localization } from './i18n/Localization';
import { flushPendingSystems } from './app';
import { requireResourceManager } from './resourceManager';
import { log } from './logger';
import { type RuntimeAssetSource, type TextureParams } from './runtimeAssets';
import { loadSpineAssets, applySpineEntities } from './spine/loadSpineScene';
import type { AddressableManifest, ManifestModel } from './asset/AddressableManifest';
import type { Catalog } from './asset/Catalog';

// =============================================================================
// Public Interface
// =============================================================================

// RuntimeAssetSource + createTextureFromPixels live in ./runtimeAssets so the
// spine scene loader can share them without importing this module.
export type { RuntimeAssetSource } from './runtimeAssets';

// =============================================================================
// Per-App runtime Assets channel
// =============================================================================

// Marks Assets instances built here and holds their merged per-scene texture
// import settings, so later scene loads extend the map instead of replacing
// the instance (and so `ensureRuntimeAssets` can tell its own instance apart
// from the default AssetPlugin one it must replace).
const runtimeImportSettings = new WeakMap<AssetsClass, Record<string, TextureImportSettings>>();

/**
 * The per-App runtime `Assets`, loading through the single canonical asset
 * channel driven by the realm's `RuntimeAssetSource`:
 *   - fetch (text/binary, incl. KTX2 containers) → `source.backend`
 *   - texture pixels → `source.decodePixels` (handles `estella://` / WeChat
 *     package files / inlined data-URLs that a URL `<img>` can't)
 *   - KTX2 transcode → the same self-gating Basis side-module the editor wires
 * `source.resolveRef` is the single ref resolver, so refs resolve to their real
 * (extension-bearing) build paths before KTX2 detection and fetch.
 *
 * Created ONCE per App and installed as the app resource, replacing the default
 * AssetPlugin instance (whose HttpBackend/URL `<img>` decode can't read this
 * realm's sources). Every later scene load reuses it, so caches, refcounts and
 * the addressable manifest survive scene switches — `Assets.loadGroup` keeps
 * working after the first scene, and re-entering a scene revives resident
 * textures instead of re-decoding. The first scene load's `source` wins; one
 * App is expected to keep one asset source for its lifetime. No ref counter /
 * catalog is attached (parity with the old runtime loader, which tracked
 * neither and applied no atlas-frame indirection).
 */
function ensureRuntimeAssets(
    app: App, module: ESEngineModule, source: RuntimeAssetSource, catalog?: Catalog,
): AssetsClass {
    if (app.hasResource(AssetsResource)) {
        const existing = app.getResource(AssetsResource);
        if (runtimeImportSettings.has(existing)) return existing;
    }

    initBuiltinAssetFields();
    const assets = AssetsClass.create({
        backend: source.backend,
        module,
        catalog,
        getAudio: () => (app.hasResource(Audio) ? app.getResource(Audio) : null),
        getSpriteAnimation: () => (app.hasResource(SpriteAnimation) ? app.getResource(SpriteAnimation) : null),
        getLocalization: () => (app.hasResource(Localization) ? app.getResource(Localization) : null),
    });
    if (source.resolveRef) assets.setAssetRefResolver(source.resolveRef);

    const loader = assets.getTextureLoader();
    loader.setPixelDecoder((path, flip) => source.decodePixels(path, flip));
    // KTX2 transcoder, self-gated off app.sideModules — identical wiring to
    // AssetPlugin.build so eager + on-demand loads transcode the same way.
    loader.setTranscoderProvider(async () => {
        const host = app.sideModules;
        if (!host) return null;
        const mod = await host.acquire('basis');
        return mod ? transcoderFromModule(mod as unknown as BasisWasmModule) : null;
    });

    const settings: Record<string, TextureImportSettings> = {};
    assets.setTextureImportSettingsResolver((ref) => settings[ref]);
    runtimeImportSettings.set(assets, settings);

    app.insertResource(AssetsResource, assets);
    return assets;
}

/**
 * Merge a scene's stored per-texture import settings (filter/wrap) into the
 * runtime Assets' resolver map. Keys normalize through resolveRef so they match
 * the resolved path the TextureLoader sees; the stored {filterMode,wrapMode}
 * shape maps to the loader's {filter,wrap}. Merging (not replacing) keeps
 * settings from previously loaded scenes live — the same texture carries the
 * same .meta-derived settings in every scene, so last-wins is safe.
 */
function mergeSceneTextureImportSettings(
    assets: AssetsClass, sceneData: SceneData, resolveRef: (ref: string) => string,
): void {
    const settings = runtimeImportSettings.get(assets);
    const rawSettings = (sceneData as { textureImporterSettings?: Record<string, TextureParams> })
        .textureImporterSettings;
    if (!settings || !rawSettings) return;
    for (const [ref, s] of Object.entries(rawSettings)) {
        settings[resolveRef(ref)] = {
            filter: s.filterMode as TextureImportSettings['filter'],
            wrap: s.wrapMode as TextureImportSettings['wrap'],
        };
    }
}

/** Apply 9-slice borders to loaded textures. `textureHandles` is keyed by the
 *  resolved build path (Assets discovery resolves refs), so the metadata's
 *  stored ref is resolved the same way before lookup. */
function applyTextureMetadata(
    sceneData: SceneData,
    textureHandles: Map<string, number>,
    resolveRef: (ref: string) => string,
): void {
    if (!sceneData.textureMetadata) return;
    const rm = requireResourceManager();
    for (const [ref, metadata] of Object.entries(sceneData.textureMetadata)) {
        const handle = textureHandles.get(resolveRef(ref));
        if (handle && metadata?.sliceBorder) {
            const b = metadata.sliceBorder;
            rm.setTextureMetadata(handle, b.left, b.right, b.top, b.bottom);
        }
    }
}

// =============================================================================
// Public API
// =============================================================================

export interface LoadRuntimeSceneOptions {
    app: App;
    module: ESEngineModule;
    sceneData: SceneData;
    source: RuntimeAssetSource;
    spineModule?: SpineWasmModule | null;
    spineManager?: SpineManager | null;
    physicsModule?: PhysicsWasmModule | null;
    /** Project-declared physics world config (gravity, solver tuning, collision-layer
     *  masks, sleep/continuous toggles) — threaded from the editor's Project Settings. */
    physicsConfig?: PhysicsPluginConfig;
    /** Project-declared physics enable (`.uproject` features analog) — installs
     *  physics even for runtime-spawned bodies the static scene doesn't show.
     *  OR-combined with a content scan. */
    physicsEnabled?: boolean;
    sceneName?: string;
}

/** Component types whose presence means a scene needs the physics subsystem. */
const PHYSICS_COMPONENT_TYPES = new Set([
    'RigidBody', 'BoxCollider', 'CircleCollider', 'CapsuleCollider',
    'SegmentCollider', 'PolygonCollider', 'ChainCollider',
]);

/** True if any entity carries a physics component, or a TilemapLayer that may spawn
 *  colliders at runtime — either baked collidable tile ids (legacy scenes) or a
 *  `.estileset` reference, whose collision shapes derive live at load and are
 *  invisible to a component scan. A visual-only tileset costs one unused physics
 *  module load; missing real tile colliders would break the scene. */
export function sceneUsesPhysics(sceneData: SceneData): boolean {
    for (const entity of sceneData.entities ?? []) {
        for (const comp of entity.components ?? []) {
            if (PHYSICS_COMPONENT_TYPES.has(comp.type)) return true;
            if (comp.type === 'TilemapLayer') {
                const data = comp.data as Record<string, unknown> | undefined;
                const ids = data?.collidableTileIds;
                if (Array.isArray(ids) && ids.length > 0) return true;
                if (typeof data?.tilesetAsset === 'string' && data.tilesetAsset !== '') return true;
            }
        }
    }
    return false;
}

export async function loadRuntimeScene(options: LoadRuntimeSceneOptions): Promise<void> {
    const { app, module, sceneData, source, physicsConfig, physicsEnabled, sceneName } = options;

    // The SpineManager is owned by SpinePlugin (built from the realm's
    // app.sideModules host); read it from there so every realm — play / playable /
    // wechat — loads spine assets through one manager. An explicit option still
    // wins for headless/tests.
    const spineManager = options.spineManager ?? app.getPlugin(SpinePlugin)?.spineManager ?? null;

    // Spine pairs (raw refs) for the two-phase spine load+apply below; every
    // other asset type loads through the single canonical Assets channel.
    const discovered = discoverSceneAssets(sceneData);

    // Eager scene assets (textures / fonts / materials / anim-clips / tilemaps /
    // audio) load through the single canonical Assets channel — one per-type
    // loader implementation, shared with the editor — driven by this realm's
    // source. The instance is per-App (installed as the app resource, so plugins
    // that resolve `@uuid:` refs at runtime — e.g. the tilemap plugin — find the
    // SAME resolver the preload keyed the caches with) and persists across scene
    // loads. Spine stays a two-phase load+apply below (skipSpine).
    const sceneAssets = ensureRuntimeAssets(app, module, source);
    mergeSceneTextureImportSettings(sceneAssets, sceneData, source.resolveRef ?? ((r) => r));
    const assetResult = await sceneAssets.preloadSceneAssets(sceneData, undefined, { skipSpine: true });
    sceneAssets.resolveSceneAssetPaths(sceneData, assetResult);
    applyTextureMetadata(sceneData, assetResult.textureHandles, source.resolveRef ?? ((ref) => ref));

    // KTX2 atlas pages transcode through the realm's basis module, acquired the
    // same lazy way the TextureLoader's provider does (AssetPlugin).
    const spineAssetInfo = await loadSpineAssets(module, source, spineManager, discovered.spines, async () => {
        const host = app.sideModules;
        if (!host) return null;
        const mod = await host.acquire('basis');
        return mod ? transcoderFromModule(mod as unknown as BasisWasmModule) : null;
    });

    // Self-gating: install physics when the project declares it OR the scene uses
    // it, so no runtime entry can forget to wire it. The module comes from the
    // realm's side-module host (app.sideModules) — fetch / inlined / WeChat — or
    // an explicit override for tests. Install once via addPlugin (also registers
    // it in the observability surface).
    let physicsModule = options.physicsModule ?? null;
    const wantsPhysics = !!physicsEnabled || sceneUsesPhysics(sceneData);
    if (!wantsPhysics) {
        log.info('physics', 'not installed — not declared (features.physics) and scene has no physics components');
    } else {
        if (!physicsModule && app.sideModules) {
            physicsModule = (await app.sideModules.acquire('physics')) as PhysicsWasmModule | null;
        }
        if (!physicsModule) {
            log.warn('physics', `wanted (declared=${!!physicsEnabled}) but no module loaded — this realm has no side-module host or physics.wasm failed to load`);
        } else if (!app.getPlugin(PhysicsPlugin)) {
            const gravity = physicsConfig?.gravity ?? { ...DEFAULT_GRAVITY };
            const config: PhysicsPluginConfig = {
                gravity,
                fixedTimestep: physicsConfig?.fixedTimestep ?? DEFAULT_FIXED_TIMESTEP,
                subStepCount: physicsConfig?.subStepCount ?? 4,
                contactHertz: physicsConfig?.contactHertz ?? 120,
                contactDampingRatio: physicsConfig?.contactDampingRatio ?? 10,
                contactSpeed: physicsConfig?.contactSpeed ?? 10,
            };
            // Pass through the remaining world config only when the project set it, so
            // the plugin's own defaults still apply otherwise.
            if (physicsConfig?.collisionLayerMasks) config.collisionLayerMasks = physicsConfig.collisionLayerMasks;
            if (physicsConfig?.enableSleep !== undefined) config.enableSleep = physicsConfig.enableSleep;
            if (physicsConfig?.enableContinuous !== undefined) config.enableContinuous = physicsConfig.enableContinuous;
            const mod = physicsModule;
            app.addPlugin(new PhysicsPlugin('', config, () => Promise.resolve(mod)));
            log.info('physics', `installed (gravity ${gravity.x}, ${gravity.y})`);
        }
    }

    const entityMap = loadSceneData(app.world, sceneData);

    const cppRegistry = app.world.getCppRegistry();
    if (cppRegistry) {
        (module as ESEngineModule).transform_update(cppRegistry);
    }

    if (spineManager && cppRegistry) {
        await applySpineEntities({ spineManager, sceneData, entityMap, registry: cppRegistry, assetInfo: spineAssetInfo });
    }

    if (sceneName && app.hasResource(SceneManager)) {
        for (const entity of entityMap.values()) {
            app.world.insert(entity, SceneOwner, { scene: sceneName, persistent: false });
        }
    }
}

export function createRuntimeSceneConfig(
    name: string,
    sceneData: SceneData | undefined,
    options: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'>,
    scenePath?: string,
): SceneConfig {
    return {
        name,
        async setup() {
            let data = sceneData;
            if (!data) {
                // Lazy scene: fetch by path through the per-App runtime Assets
                // (installed by initRuntime before any scene loads), so the data
                // arrives via the realm's backend/resolver — http on web, wx fs
                // on WeChat — only when the game actually switches to it.
                if (!scenePath) throw new Error(`scene "${name}" registered with neither data nor path`);
                data = await options.app.getResource(AssetsResource).fetchJson<SceneData>(scenePath);
            }
            await loadRuntimeScene({ ...options, sceneData: data, sceneName: name });
        },
    };
}

export interface RuntimeInitConfig {
    app: App;
    module: ESEngineModule;
    source: RuntimeAssetSource;
    /**
     * Addressable manifest for the app's Assets, enabling `Assets.loadGroup`
     * (on-demand groups / subpackages) from game code. Set here — on the
     * per-App runtime instance — rather than on whatever Assets resource
     * existed before initRuntime, which the runtime instance replaces.
     */
    manifest?: AddressableManifest | ManifestModel | null;
    /**
     * Logical-path → build-path catalog for cooked builds (content-addressed
     * staging renames physical files): loaders route their inner text refs (a
     * material's shader path) through Catalog.getBuildPath, which is identity
     * without one. Applied when the per-App runtime Assets is first created.
     */
    catalog?: Catalog;
    /** Every scene the game can switch to. `data` loads eagerly at register
     *  time; `path` registers a lazy scene fetched through the runtime Assets
     *  on first {@link SceneManagerState.switchTo}/load. One of the two. */
    scenes: Array<{ name: string; data?: SceneData; path?: string }>;
    firstScene: string;
    spineModule?: SpineWasmModule | null;
    spineManager?: SpineManager | null;
    physicsModule?: PhysicsWasmModule | null;
    /** Project-declared physics world config (gravity, solver tuning, collision-layer
     *  masks, sleep/continuous toggles) — threaded from the editor's Project Settings. */
    physicsConfig?: PhysicsPluginConfig;
    /** Project-declared physics enable; see {@link LoadRuntimeSceneOptions.physicsEnabled}. */
    physicsEnabled?: boolean;
    aspectRatio?: number;
}

export async function initRuntime(config: RuntimeInitConfig): Promise<void> {
    const { app, firstScene, aspectRatio } = config;

    flushPendingSystems(app);

    // Install the per-App runtime Assets up front (scene loads reuse it) and
    // hand it the manifest so on-demand loadGroup works from the first frame.
    // The catalog rides the same first-creation moment (later ensure calls
    // return the existing instance).
    const assets = ensureRuntimeAssets(app, config.module, config.source, config.catalog);
    if (config.manifest) assets.setManifest(config.manifest);

    const sceneOpts: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'> = {
        app: config.app,
        module: config.module,
        source: config.source,
        spineModule: config.spineModule,
        spineManager: config.spineManager,
        physicsModule: config.physicsModule,
        physicsConfig: config.physicsConfig,
        physicsEnabled: config.physicsEnabled,
    };

    const mgr = app.getResource(SceneManager);
    for (const scene of config.scenes) {
        mgr.register(createRuntimeSceneConfig(scene.name, scene.data, sceneOpts, scene.path));
    }

    if (firstScene) {
        mgr.setInitial(firstScene);
        await mgr.load(firstScene);
    }

    if (aspectRatio !== undefined) {
        updateCameraAspectRatio(app.world, aspectRatio);
    }
}
