// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

import { SceneOwner } from '../ecs/component';
import { loadSceneData, updateCameraAspectRatio, sceneHasPrefabEntries, expandScenePrefabs, type SceneData } from '../scene/scene';
import { recordSceneOrigins } from '../scene/sceneOrigins';
import type { PrefabData } from '../prefab/types';
import { switchTheme, resolveThemeTokens, type ThemeOverrides } from '../ui';
import { discoverSceneAssets } from '../asset/discoverAssets';
import type { ESEngineModule } from '../wasm';
import type { SpineWasmModule } from '../spine/SpineModuleLoader';
import { SpineManager } from '../spine/SpineManager';
import type { PhysicsWasmModule } from '../physics/PhysicsModuleLoader';
import { PhysicsPlugin, type PhysicsPluginConfig } from '../physics/PhysicsPlugin';
import type { Physics3DWasmModule } from '../physics3d/Physics3DModule';
import { Physics3DPlugin } from '../physics3d/Physics3DPlugin';
import { applyAudioProjectConfig, type AudioProjectConfig } from '../audio/AudioProjectConfig';
import { SpinePlugin } from '../spine/SpinePlugin';
import type { App } from '../app/app';
import { Assets as AssetsClass } from '../asset/Assets';
import { Assets as AssetsResource } from '../asset/AssetPlugin';
import { transcoderFromModule, type BasisWasmModule } from '../asset/basisTranscoder';
import type { BasisTranscoder } from '../asset/compressed';
import type { TextureImportSettings } from '../asset/loaders/TextureLoader';
import { SceneManager, type SceneConfig } from '../scene/sceneManager';
import { DEFAULT_GRAVITY, DEFAULT_FIXED_TIMESTEP } from '../defaults';
import { SpriteAnimation } from '../animation/SpriteAnimator';
import { Audio } from '../audio/Audio';
import { Achievements } from '../services/achievements';
import { getPlatform } from '../platform/base';
import { VideoPlayer } from '../video/VideoAPI';
import { Localization, matchLocale } from '../i18n/Localization';
import { LocalizationPlugin } from '../i18n/LocalizationPlugin';
import { platformLanguage } from '../platform';
import { flushPendingRegistrations } from '../app/app';
import { installHotUpdateRebind } from '../hotUpdateRebind';
import { requireResourceManager } from '../wasm/resourceManager';
import { log } from '../util/logger';
import { type RuntimeAssetSource, type TextureParams } from './runtimeAssets';
import { loadSpineAssets, applySpineEntities, type SpineAssetInfo } from '../spine/loadSpineScene';
import { DragonBonesPlugin } from '../dragonbones/DragonBonesPlugin';
import type { DragonBonesManager } from '../dragonbones/DragonBonesManager';
import { loadDragonBonesAssets, applyDragonBonesEntities, type DragonBonesAssetInfo } from '../dragonbones/loadDragonBonesScene';
import type { AddressableManifest, ManifestModel } from '../asset/AddressableManifest';
import type { Catalog } from '../asset/Catalog';

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
    app: App, module: ESEngineModule | null, source: RuntimeAssetSource, catalog?: Catalog,
): AssetsClass {
    if (app.hasResource(AssetsResource)) {
        const existing = app.getResource(AssetsResource);
        if (runtimeImportSettings.has(existing)) return existing;
    }

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

    // Two suppliers, one resolver, in precedence order:
    //   - the REALM's asset source describes the ASSET (the editor's database, a
    //     cooked build's manifest) and is authoritative;
    //   - the per-scene map below is the embedder's channel for a scene that
    //     carries its own `textureImporterSettings`.
    // Asset-level wins: a stale copy inside a scene must not override what the
    // asset actually says today.
    const settings: Record<string, TextureImportSettings> = {};
    assets.setTextureImportSettingsResolver(
        (ref) => source.textureImportSettings?.(ref) ?? settings[ref],
    );
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
            srgb: s.srgb,
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
    /** The wasm module, or null on a native host — the engine core is arm64 there,
     *  so there is no Module to reach through. */
    module: ESEngineModule | null;
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
    /** An already-resolved 3D physics module, for tests and headless hosts. */
    physics3dModule?: Physics3DWasmModule;
    /** Project-declared UI theme (Project Settings → UI). Dark is the default;
     *  'light' switches the token set AND re-resolves already-instantiated
     *  ThemeStyle-tagged widgets (prefab instances carry dark baked values). */
    uiTheme?: 'dark' | 'light';
    /** Project-declared partial re-skin over the base theme (Project Settings →
     *  UI theme colors); merged via {@link resolveThemeTokens}. */
    uiThemeOverrides?: ThemeOverrides;
    sceneName?: string;
}

/** Component types whose presence means a scene needs the physics subsystem. */
const PHYSICS_COMPONENT_TYPES = new Set([
    'RigidBody', 'BoxCollider', 'CircleCollider', 'CapsuleCollider',
    'SegmentCollider', 'PolygonCollider', 'ChainCollider',
]);

/** The same question for the 3D world, which is a different module entirely. */
const PHYSICS3D_COMPONENT_TYPES = new Set([
    'RigidBody3D', 'BoxCollider3D', 'SphereCollider3D', 'CapsuleCollider3D',
    'MeshCollider3D', 'CharacterController3D',
    'PointJoint3D', 'HingeJoint3D', 'SliderJoint3D', 'DistanceJoint3D', 'FixedJoint3D',
]);

/** True if any entity carries a 3D physics component. */
export function sceneUses3DPhysics(sceneData: SceneData): boolean {
    for (const entity of sceneData.entities ?? []) {
        for (const comp of entity.components ?? []) {
            if (PHYSICS3D_COMPONENT_TYPES.has(comp.type)) return true;
        }
    }
    return false;
}

/** True if any Text binds its content to a localization key — the scene needs
 *  the Localization resource + the project's `.eslocale` tables to render as
 *  authored (an unbound key would show as the raw key string). */
export function sceneUsesI18n(sceneData: SceneData): boolean {
    for (const entity of sceneData.entities ?? []) {
        for (const comp of entity.components ?? []) {
            if (comp.type !== 'Text') continue;
            const key = (comp.data as { i18nKey?: unknown } | undefined)?.i18nKey;
            if (typeof key === 'string' && key.length > 0) return true;
        }
    }
    return false;
}

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
    const { app, module, source, physicsConfig, physicsEnabled, uiTheme, uiThemeOverrides, sceneName } = options;

    // The SpineManager is owned by SpinePlugin (built from the realm's
    // app.sideModules host); read it from there so every realm — play / playable /
    // wechat — loads spine assets through one manager. An explicit option still
    // wins for headless/tests.
    const spineManager = options.spineManager ?? app.getPlugin(SpinePlugin)?.spineManager ?? null;

    // Expand prefab instances up front: an exported scene keeps them as a prefab
    // ref + overrides (the cook does not flatten them), and the rest of this
    // pipeline — discovery, preload, the synchronous loadSceneData spawn — operates
    // on plain entities and skips a prefab entry. This is the same expansion
    // loadSceneWithAssets runs for the editor's play realm, so a packaged game
    // spawns prefab instances exactly as Play does (play == ship), instead of
    // silently dropping them.
    const runtimeAssets = ensureRuntimeAssets(app, module, source);
    let sceneData = options.sceneData;
    if (sceneHasPrefabEntries(sceneData)) {
        sceneData = await expandScenePrefabs(sceneData, async (ref) => {
            try {
                return ((await runtimeAssets.loadPrefab(ref))?.data as PrefabData) ?? null;
            } catch (e) {
                log.warn('scene', `Failed to load prefab "${ref}": ${e instanceof Error ? e.message : String(e)}`);
                return null;
            }
        });
    }

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
    const sceneAssets = runtimeAssets;
    // Video source refs resolve through the SAME channel as every other asset
    // (the editor's play realm wires this too) — a cooked build maps the
    // authored logical ref (clip.mp4 / @uuid) to its staged .esv. The staged path
    // then goes through the realm's backend, because what a video element needs is
    // a URL it can open: identity for http/filesystem realms, the inlined data URL
    // for the single-file playable (where there is no file to fetch at all).
    if (source.resolveRef && app.hasResource(VideoPlayer)) {
        const resolveRef = source.resolveRef;
        const backend = source.backend;
        app.getResource(VideoPlayer).setRefResolver((ref) => backend.resolveUrl(resolveRef(ref)));
    }
    mergeSceneTextureImportSettings(sceneAssets, sceneData, source.resolveRef ?? ((r) => r));
    const assetResult = await sceneAssets.preloadSceneAssets(sceneData, undefined, { skipSpine: true });
    sceneAssets.resolveSceneAssetPaths(sceneData, assetResult);
    applyTextureMetadata(sceneData, assetResult.textureHandles, source.resolveRef ?? ((ref) => ref));

    // KTX2 atlas pages transcode through the realm's basis module, acquired the
    // same lazy way the TextureLoader's provider does (AssetPlugin). Spine itself
    // rides `app.sideModules` — a fetched wasm module on the web, the runtime
    // compiled into the binary on a device — so what decides here is whether the
    // realm has an acquirer at all, not whether it has a wasm engine module (the
    // atlas upload takes bytes without one).
    if (!app.sideModules && discovered.spines.length > 0) {
        log.warn('scene', `${discovered.spines.length} spine asset(s) skipped — `
            + 'this realm has no optional-module host to load a Spine runtime from');
    }
    const transcoderProvider = async (): Promise<BasisTranscoder | null> => {
        const host = app.sideModules;
        if (!host) return null;
        const mod = await host.acquire('basis');
        return mod ? transcoderFromModule(mod as unknown as BasisWasmModule) : null;
    };
    const spineAssetInfo = app.sideModules
        ? await loadSpineAssets(module, source, spineManager, discovered.spines, transcoderProvider)
        : new Map<string, SpineAssetInfo>();

    // DragonBones, the same two phases. The manager is acquired only when the
    // scene actually holds an armature — the plugin fetches its wasm on the first
    // ask, so a scene without one costs nothing.
    let dragonBonesManager: DragonBonesManager | null = null;
    let dragonBonesAssetInfo = new Map<string, DragonBonesAssetInfo>();
    if (discovered.dragonBones.length > 0) {
        if (!app.sideModules) {
            log.warn('scene', `${discovered.dragonBones.length} DragonBones asset(s) skipped — `
                + 'this realm has no optional-module host to load the DragonBones runtime from');
        } else {
            dragonBonesManager = (await app.getPlugin(DragonBonesPlugin)?.acquire()) ?? null;
            if (!dragonBonesManager) {
                log.warn('scene', 'DragonBones assets present but the runtime could not be loaded');
            } else {
                dragonBonesAssetInfo = await loadDragonBonesAssets(
                    module, source, discovered.dragonBones, transcoderProvider);
            }
        }
    }

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

    // The 3D world gates itself the same way, on its own components and its own
    // module: the two never share a solver, so a scene wanting one is not asking
    // for the other.
    if (sceneUses3DPhysics(sceneData) && !app.getPlugin(Physics3DPlugin)) {
        const module3d = options.physics3dModule
            ?? (app.sideModules
                ? (await app.sideModules.acquire('physics3d')) as Physics3DWasmModule | null
                : null);
        if (!module3d) {
            log.warn('physics3d', 'scene has 3D physics components but no module loaded —'
                + ' this realm has no side-module host or physics3d.wasm failed to load');
        } else {
            const mod = module3d;
            app.addPlugin(new Physics3DPlugin('', {}, () => Promise.resolve(mod)));
            log.info('physics3d', 'installed');
        }
    }

    // Self-gating i18n, mirroring physics: a scene that binds Text.i18nKey needs
    // the Localization resource + the shipped `.eslocale` tables — installed and
    // loaded here so no runtime entry can forget. Tables come from the realm's
    // OWN asset list (they're loaded by key, never referenced by the scene).
    // Idempotent across scene switches: the resource persists, table loads hit
    // the Assets cache, addCatalog merges. Awaited so the first frame renders
    // words, not raw keys.
    if (sceneUsesI18n(sceneData)) {
        const autoInstalled = !app.hasResource(Localization);
        if (autoInstalled) app.addPlugin(new LocalizationPlugin());
        const tables = (source.listAssetPaths?.() ?? []).filter((p) => p.toLowerCase().endsWith('.eslocale'));
        if (tables.length === 0) {
            log.warn('i18n', 'scene binds Text.i18nKey but this realm lists no .eslocale tables — keys will render raw');
        } else {
            await Promise.all(tables.map((p) => sceneAssets.loadLocaleTable(p).catch((e: unknown) => {
                log.error('i18n', `locale table ${p} failed to load: ${e instanceof Error ? e.message : String(e)}`);
            })));
            log.info('i18n', `installed — ${tables.length} locale table(s)`);
        }
        if (autoInstalled) {
            // Auto-installed ⇒ nobody configured a locale: follow the player's
            // system language when a shipped table matches. A game that installs
            // the plugin itself (or calls setLocale later) is never overridden.
            const i18n = app.getResource(Localization);
            const picked = matchLocale(platformLanguage(), i18n.availableLocales());
            if (picked) i18n.setLocale(picked);
        }
    }

    const entityMap = loadSceneData(app.world, sceneData);
    // Which document row each entity came from, when someone is keeping track
    // (an editor inspecting its own running game). No-op otherwise.
    recordSceneOrigins(app, entityMap);

    // Apply the project theme over the freshly instantiated scene: prefabs bake
    // the default dark palette, so a light base or any token override re-resolves
    // every ThemeStyle tag.
    if (uiTheme === 'light' || uiThemeOverrides) {
        switchTheme(app.world, resolveThemeTokens(uiTheme ?? 'dark', uiThemeOverrides));
    }

    const cppRegistry = app.world.getCppRegistry();
    // Fold the loaded transforms into world matrices once, before the first frame.
    // Native hosts run their own TransformSystem each frame instead.
    if (cppRegistry && module) {
        module.transform_update(cppRegistry);
    }

    if (spineManager && cppRegistry) {
        await applySpineEntities({ spineManager, sceneData, entityMap, registry: cppRegistry, assetInfo: spineAssetInfo });
    }

    if (dragonBonesManager) {
        applyDragonBonesEntities({
            manager: dragonBonesManager, sceneData, entityMap, assetInfo: dragonBonesAssetInfo,
        });
    }

    if (sceneName && app.hasResource(SceneManager)) {
        // Adopt into the SceneManager's instance set so unload/switchTo actually
        // despawns these entities — SceneOwner alone is only the persistence tag.
        const ctx = app.getResource(SceneManager).getScene(sceneName);
        for (const entity of entityMap.values()) {
            if (ctx) ctx.adopt(entity);
            else app.world.insert(entity, SceneOwner, { scene: sceneName, persistent: false });
        }
        // And the assets, for the same reason: a packaged scene carries no
        // `data`, so the manager's preload never ran and these references are
        // ones only this function knows about.
        ctx?.trackAssets(discovered.byType);
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
    /** The wasm module, or null on a native host (see LoadRuntimeSceneOptions). */
    module: ESEngineModule | null;
    source: RuntimeAssetSource;
    /**
     * Addressable manifest for the app's Assets, enabling `Assets.loadGroup`
     * (on-demand groups / subpackages) from game code. Set here — on the
     * per-App runtime instance — rather than on whatever Assets resource
     * existed before initRuntime, which the runtime instance replaces.
     */
    manifest?: AddressableManifest | ManifestModel | null;
    /** CDN root that `remote`-group assets resolve against ({@link Assets.setRemoteRoot}) —
     *  enables hot-update delivery from a remote origin. */
    remoteRoot?: string;
    /** Storage key an applied hot-update persists the manifest under. When set,
     *  initRuntime restores any manifest a prior run persisted there — a returning
     *  player boots on the updated content ({@link Assets.restorePersistedUpdate}). */
    persistUpdateKey?: string;
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
    /** Project-declared mixer state (bus volumes / custom buses / effects / duck
     *  rules) — threaded from the editor's audio config, applied once at boot. */
    audioConfig?: AudioProjectConfig;
    /** Project-declared UI theme; see {@link LoadRuntimeSceneOptions.uiTheme}. */
    uiTheme?: 'dark' | 'light';
    /** Project-declared theme token overrides; see {@link LoadRuntimeSceneOptions.uiThemeOverrides}. */
    uiThemeOverrides?: ThemeOverrides;
    /** The design resolution and camera fit. A desktop window opens at the design
     *  size; the fit itself is applied by createWebApp/createNativeApp. */
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
    /** The achievement ids the project declares — the set an unlock is checked
     *  against, since a store would take an unknown one and do nothing. */
    achievements?: string[];
    /** The Steam application id; present ⇒ try to bring a Steam client up and let
     *  it answer for achievements. Absent or unavailable keeps the local one. */
    steamAppId?: number;
    aspectRatio?: number;
}

export async function initRuntime(config: RuntimeInitConfig): Promise<void> {
    const { app, firstScene, aspectRatio } = config;

    flushPendingRegistrations(app);

    // Install the per-App runtime Assets up front (scene loads reuse it) and
    // hand it the manifest so on-demand loadGroup works from the first frame.
    // The catalog rides the same first-creation moment (later ensure calls
    // return the existing instance).
    const assets = ensureRuntimeAssets(app, config.module, config.source, config.catalog);
    if (config.manifest) assets.setManifest(config.manifest);
    if (config.remoteRoot) assets.setRemoteRoot(config.remoteRoot);
    // A persisted update (from a prior applyUpdate) supersedes the shipped manifest
    // + root, so a returning player boots straight onto the already-updated content.
    if (config.persistUpdateKey) assets.restorePersistedUpdate(config.persistUpdateKey);
    // Built-in rebinder: on a hot update, swap the changed texture into live
    // sprites/meshes automatically — a scene @uuid ref updates with no game code.
    installHotUpdateRebind(app, assets);

    if (config.audioConfig && app.hasResource(Audio)) {
        applyAudioProjectConfig(app.getResource(Audio), config.audioConfig);
    }

    // A desktop window opens at the project's design resolution. The host cannot
    // read it for itself — the window exists before any JS does, and the host has
    // no JSON parser — so this is where the two meet.
    if (config.screenFit) {
        getPlatform().setWindowSize?.(config.screenFit.designWidth, config.screenFit.designHeight);
    }

    // The declared achievement ids, so an unlock outside the set is refused here
    // rather than accepted by a store and silently dropped.
    app.getResource(Achievements)?.setKnown(config.achievements ?? null);
    // A store, if there is one behind this build. Everything about the game's code
    // is the same either way — what changes is whether Steam also hears.
    if (config.steamAppId) {
        const provider = getPlatform().steamAchievements?.(config.steamAppId);
        if (provider) app.getResource(Achievements)?.setProvider(provider);
    }

    const sceneOpts: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'> = {
        app: config.app,
        module: config.module,
        source: config.source,
        spineModule: config.spineModule,
        spineManager: config.spineManager,
        physicsModule: config.physicsModule,
        physicsConfig: config.physicsConfig,
        physicsEnabled: config.physicsEnabled,
        uiTheme: config.uiTheme,
        uiThemeOverrides: config.uiThemeOverrides,
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
