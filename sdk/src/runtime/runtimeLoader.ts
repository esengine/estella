// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

import { SceneOwner } from '../ecs/component';
import { SceneEntityBatch } from '../scene/sceneHierarchy';
import { SceneAssetProgress } from '../scene/sceneAssetProgress';
import { bakesOf } from './bakes';
import { migrateOwnedSceneData, spawnAndLoadEntities, spawnAndLoadEntitiesJob, revealStagedEntities,
         updateCameraAspectRatio, sceneHasPrefabEntries, expandScenePrefabAssets, type SceneData, type StagedSpawn,
         type SceneLoadProgressCallback, applySceneTextureMetadata } from '../scene/scene';
import { RENAMED_COMPONENT_TYPES } from '../scene/legacyComponents';
import { registerDeferredInstances } from '../scene/deferredInstances';
import { runSceneLoad, scenePhaseRunner, SceneLoadAttempt } from '../scene/sceneLoadAttempt';
import { prepareSpawnOwnership, type PreparedSpawnOwnership } from '../prefab/preparedAssetOwnership';
import { recordSceneOrigins, enableSceneOrigins } from '../scene/sceneOrigins';
import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';
import { switchTheme, resolveThemeTokens, type ThemeOverrides } from '../ui';
import type { SceneAssetRefs } from '../asset/discoverAssets';
import type { ESEngineModule } from '../wasm';
import type { SpineWasmModule } from '../spine/SpineModuleLoader';
import type { SpineManager } from '../spine/SpineManager';
import type { PhysicsWasmModule } from '../physics/PhysicsModuleLoader';
import type { Physics2DPluginConfig } from '../physics/PhysicsTypes';
import type { Physics3DWasmModule } from '../physics3d/Physics3DModule';
import { applyAudioProjectConfig } from '../audio/AudioProjectConfig';
import type { RuntimeProjectSettings } from './projectSettings';
import type { App } from '../app/app';
import { Assets as AssetsClass } from '../asset/Assets';
import { Assets as AssetsResource } from '../asset/AssetPlugin';
import { bindAssetReferenceTracking } from '../asset/assetReferenceTracking';
import { basisTranscoderFor } from '../asset/basisWorkers';
import type { BasisTranscoder } from '../asset/compressed';
import type { TextureImportSettings } from '../asset/loaders/TextureLoader';
import { SceneLoadCancelled, SceneManager, type SceneConfig, type SceneContext, type SceneRetirement } from '../scene/sceneManager';
import { readyMeshPrograms } from '../render/meshProgramReadiness';
import { shadersCompiled } from '../render/shaderWarmup';
import type { RenderReadiness } from '../render/renderReadiness';
import { WorldStreaming } from '../residency/WorldStreamer';
import { persistentEntityRows } from '../residency/identity';
import { WorldMemoryRes } from '../residency/worldMemory';
import type { WorldManifest } from '../residency/cells';
import type { CutWorld } from '../residency/cutWorld';
import { DEFAULT_GRAVITY, DEFAULT_FIXED_TIMESTEP, applyBuildRuntimeConfig } from '../defaults';
import { SpriteAnimation } from '../animation/SpriteAnimator';
import { Audio } from '../audio/Audio';
import { Achievements } from '../services/achievements';
import { getPlatform } from '../platform/base';
import { Localization, matchLocale } from '../i18n/Localization';
import { LocalizationPlugin } from '../i18n/LocalizationPlugin';
import { platformLanguage } from '../platform';
import { flushPendingRegistrations, type Plugin } from '../app/app';
import { installHotUpdateRebind } from '../hotUpdateRebind';
import { log } from '../util/logger';
import { startDebugChannel, attachDebugChannel } from './debugChannelHook';
import type { DebugChannelConfig } from './debugChannelProtocol';
import type { AotModuleConfig } from '../ecs/aot/AotSystems';
import { type RuntimeAssetSource, type TextureParams } from './runtimeAssets';
import type { SpineAssetInfo } from '../spine/loadSpineScene';
import type { SceneAssetResult } from '../asset/Assets';
import type { DragonBonesManager } from '../dragonbones/DragonBonesManager';
import {
    spineSupport, dragonBonesSupport, physicsSupport, physics3dSupport, videoSupport,
} from './sceneOptionals';
import type { DragonBonesAssetInfo } from '../dragonbones/loadDragonBonesScene';
import type { AddressableManifest, ManifestModel } from '../asset/AddressableManifest';
import type { Catalog } from '../asset/Catalog';
import { physics3dModuleId, type Physics3DBackend } from '../sideModules/registry';
import { physics3DInstallConfig, type Physics3DWorldConfig } from '../physics3d/worldConfig';
import { setWorldUnitsPerMeter, setWorldGravity, REFERENCE_UNITS_PER_METER, STANDARD_GRAVITY } from '../ecs/worldUnits';

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
 * App is expected to keep one asset source for its lifetime. Reference tracking
 * shares the same World observer as AssetPlugin, including native runtimes.
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
        activateManifest: source.activateManifest?.bind(source),
        module,
        catalog,
        getAudio: () => (app.hasResource(Audio) ? app.getResource(Audio) : null),
        getSpriteAnimation: () => (app.hasResource(SpriteAnimation) ? app.getResource(SpriteAnimation) : null),
        getLocalization: () => (app.hasResource(Localization) ? app.getResource(Localization) : null),
    });
    if (source.resolveRef) assets.setAssetRefResolver(source.resolveRef);
    if (source.resolveRef && app.hasResource(Audio)) {
        app.getResource(Audio).setRefResolver(
            ref => source.backend.resolveUrl(assets.resolveLoadPath(ref)),
            source.resolveAddress ?? source.resolveRef,
            assets.backend.prepareFile,
        );
    }

    const loader = assets.getTextureLoader();
    loader.setPixelDecoder((path, flip, maxEdge) => source.decodePixels(path, flip, maxEdge));
    if (source.compressedTexture) loader.setCompressedSource((path) => source.compressedTexture!(path));
    // KTX2 transcoder, self-gated off app.sideModules — identical wiring to
    // AssetPlugin.build so eager + on-demand loads transcode the same way.
    loader.setTranscoderProvider(() => basisTranscoderFor(app.sideModules));

    // Two suppliers, one resolver, in precedence order:
    //   - the REALM's asset source describes the ASSET (the editor's database, a
    //     cooked build's manifest) and is authoritative;
    //   - the per-scene map below is the embedder's channel for a scene that
    //     carries its own `textureImporterSettings`.
    // Asset-level wins: a stale copy inside a scene must not override what the
    // asset actually says today.
    const settings: Record<string, TextureImportSettings> = Object.create(null);
    assets.setTextureImportSettingsResolver(
        (ref) => source.textureImportSettings?.(ref) ?? settings[ref] ?? settings[assets.sceneAssetRef(ref) ?? ref],
    );
    runtimeImportSettings.set(assets, settings);

    bindAssetReferenceTracking(app.world, assets,
        () => app.hasResource(AssetsResource) ? app.getResource(AssetsResource) : null);

    app.insertResource(AssetsResource, assets);
    return assets;
}

/** Keep scene-supplied sampling settings under the authored spelling and the key used for its handle. */
function mergeSceneTextureImportSettings(
    assets: AssetsClass, sceneData: SceneData, resolveRef: (ref: string) => string,
): void {
    const settings = runtimeImportSettings.get(assets);
    const rawSettings = (sceneData as { textureImporterSettings?: Record<string, TextureParams> })
        .textureImporterSettings;
    if (!settings || !rawSettings) return;
    for (const [ref, s] of Object.entries(rawSettings)) {
        settings[ref] = settings[resolveRef(ref)] = {
            filter: s.filterMode as TextureImportSettings['filter'],
            wrap: s.wrapMode as TextureImportSettings['wrap'],
            srgb: s.srgb,
        };
    }
}

// =============================================================================
// Public API
// =============================================================================

export interface LoadRuntimeSceneOptions {
    /** Completed asset preparations and their total, reported as this scene is read. */
    onProgress?: SceneLoadProgressCallback;
    /**
     * Awaited between the pieces of a preparation (a streamed cell's): resolves when a frame has time for the next piece, so
     * what runs after a fetch answers runs inside a frame's budget and not whenever the network answers. Absent: at once.
     */
    gate?: () => Promise<void>;
    /**
     * One of the many scenes a streamed world brings in (a cell, a far proxy): the line saying what its preload took is a
     * debug line, since a world says it hundreds of times and the residency report (`delivery`) holds the same numbers.
     */
    streamedPiece?: boolean;
    /** Authored ids this scene may reference in ANOTHER document — the persistent
     *  rows a streamed cell names. See {@link SceneLoadOptions.externalEntities}. */
    externalEntities?: ReadonlyMap<number, Entity>;
    /** Where this load spent its time. See {@link SceneLoadOptions.onPhase}. */
    onPhase?: (phase: string, ms: number) => void;
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
    physicsConfig?: Physics2DPluginConfig;
    /** The 3D physics backend; selects the side module the 3D world is acquired from. Absent ⇒ Jolt. */
    physics3dBackend?: Physics3DBackend;
    /** The project's 3D world: scene units per metre and gravity (Project Settings → Physics → 3D). Absent ⇒ centimetre units, Earth gravity. */
    physics3dWorld?: Partial<Physics3DWorldConfig>;
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
    'RigidBody2D', 'BoxCollider2D', 'CircleCollider2D', 'CapsuleCollider2D',
    'SegmentCollider2D', 'PolygonCollider2D', 'ChainCollider2D',
]);

/** The same question for the 3D world, which is a different module entirely. */
const PHYSICS3D_COMPONENT_TYPES = new Set([
    'RigidBody3D', 'BoxCollider3D', 'SphereCollider3D', 'CapsuleCollider3D',
    'MeshCollider3D', 'ConvexCollider3D', 'CharacterController3D',
    'CompoundCollider3D', 'Ragdoll',
    'PointJoint3D', 'HingeJoint3D', 'SliderJoint3D', 'DistanceJoint3D', 'FixedJoint3D', 'SwingTwistJoint3D', 'SixDOFJoint3D',
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

/** True if any Text or TextInput hint binds to a localization key — the scene needs
 *  the Localization resource + the project's `.eslocale` tables to render as
 *  authored (an unbound key would show as the raw key string). */
export function sceneUsesI18n(sceneData: SceneData): boolean {
    for (const entity of sceneData.entities ?? []) {
        for (const comp of entity.components ?? []) {
            const data = comp.data as { i18nKey?: unknown; placeholderI18nKey?: unknown } | undefined;
            const key = comp.type === 'Text' ? data?.i18nKey
                : comp.type === 'TextInput' ? data?.placeholderI18nKey : undefined;
            if (typeof key === 'string' && key.length > 0) return true;
        }
    }
    return false;
}

/**
 * Subsystem installs already in flight for this app.
 *
 * Every self-gating install below is a check, then an await for the module, then
 * an addPlugin — and two scenes arriving in one tick both pass the check. World
 * streaming makes that ordinary rather than rare.
 */
const SubsystemInstalls = defineResource<{ lifetime: symbol; pending: Map<string, Promise<void>> }>(null!, 'SubsystemInstalls');

/**
 * Run `install` with no other caller for `key` inside it.
 *
 * The loop, rather than awaiting once: what finished was ANOTHER scene's
 * install, and this one still has to decide against the world that left behind.
 */
async function installOnce(app: App, key: string, attempt: SceneLoadAttempt, install: () => Promise<void>): Promise<void> {
    attempt.assertCurrent();
    let state = app.hasResource(SubsystemInstalls) ? app.getResource(SubsystemInstalls) : undefined;
    if (!state || state.lifetime !== attempt.lifetime) {
        state = { lifetime: attempt.lifetime, pending: new Map() };
        app.insertResource(SubsystemInstalls, state);
    }
    const inFlight = state.pending;
    let running = inFlight.get(key);
    while (running) { await running; running = inFlight.get(key); }
    attempt.assertCurrent();
    const started = install().finally(() => { inFlight.delete(key); });
    inFlight.set(key, started);
    await started;
}

/** True if any entity carries a physics component, or a TilemapLayer that may spawn
 *  colliders at runtime — either baked collidable tile ids (legacy scenes) or a
 *  `.estileset` reference, whose collision shapes derive live at load and are
 *  invisible to a component scan. A visual-only tileset costs one unused physics
 *  module load; missing real tile colliders would break the scene. */
export function sceneUsesPhysics(sceneData: SceneData): boolean {
    for (const entity of sceneData.entities ?? []) {
        for (const comp of entity.components ?? []) {
            if (PHYSICS_COMPONENT_TYPES.has(RENAMED_COMPONENT_TYPES.get(comp.type) ?? comp.type)) return true;
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

/**
 * A cell's load, done as far as it can go without the world seeing anything.
 *
 * Preparation may speculate about future residency and may own data and assets;
 * only publication may create runtime entities. That is the whole contract, and
 * it is what makes "prepared" impossible to observe: there is nothing to see.
 *
 * @experimental
 */
export interface PreparedRuntimeScene {
    readonly name: string | undefined;
    /** @internal The world that acquired the prepared handles. */
    readonly lifetime?: symbol;
    /** What publication still needs; nothing here is in the world. */
    readonly options: LoadRuntimeSceneOptions;
    readonly sceneData: SceneData;
    readonly assetResult: SceneAssetResult;
    readonly retainEntityAssets?: () => PreparedSpawnOwnership;
    readonly spineManager: SpineManager | null;
    readonly spineAssetInfo: Map<string, SpineAssetInfo>;
    readonly dragonBonesManager: DragonBonesManager | null;
    readonly dragonBonesAssetInfo: Map<string, DragonBonesAssetInfo>;
    readonly discovered: SceneAssetRefs;
}

/** Apps already told that physics is not installed (see prepareRuntimeScene). */
const saidNoPhysics = new WeakSet<App>();

/**
 * Everything a scene load can do before the world can tell: fetch, expand,
 * acquire, install the subsystems it needs. Creates no entities.
 *
 * The receipts are OWNED by what this returns — publishing moves them to the
 * scene, discarding gives them back. Never both, never acquired twice.
 *
 * @experimental
 */
export function prepareRuntimeScene(options: LoadRuntimeSceneOptions, sceneOwned = false): Promise<PreparedRuntimeScene> {
    const attempt = new SceneLoadAttempt(options.app.world, options.sceneName ?? options.sceneData.name);
    return runSceneLoad(attempt, () => readRuntimeScene(options, attempt, sceneOwned));
}

async function readRuntimeScene(
    options: LoadRuntimeSceneOptions, attempt: SceneLoadAttempt, sceneOwned: boolean,
): Promise<PreparedRuntimeScene> {
    const { app, module, source, physicsConfig, physicsEnabled, sceneName } = options;
    const onPhase = attempt.observe(options.onPhase);
    const timed = scenePhaseRunner(onPhase);
    // Waiting for a turn is not work: a phase is charged its own time and not the frames it waited (`wait`).
    const gate = options.gate;
    const turn = async (): Promise<void> => {
        if (gate) {
            const began = onPhase ? performance.now() : 0;
            await gate();
            if (onPhase) onPhase('wait', performance.now() - began);
        }
        attempt.assertCurrent();
    };

    // The SpineManager is owned by SpinePlugin (built from the realm's
    // app.sideModules host); read it from there so every realm — play / playable /
    // wechat — loads spine assets through one manager. An explicit option still
    // wins for headless/tests.
    const spine = spineSupport();
    const spineManager = options.spineManager ?? spine?.manager(app) ?? null;

    // A cooked scene keeps prefab refs and overrides. Expand them through the
    // same loader as authoring before discovery walks the resulting entities.
    const runtimeAssets = ensureRuntimeAssets(app, module, source);
    // A private copy: resolution below writes handles over the asset refs, and the
    // document given here is the one a registered scene loads from every time. A
    // reload of the mutated one found no ref to acquire and spawned the handles the
    // outgoing scene had just released, so a restarted scene drew its images white.
    const copyBegan = onPhase ? performance.now() : 0;
    let sceneData = JSON.parse(JSON.stringify(options.sceneData)) as SceneData;
    const copyMs = onPhase ? performance.now() - copyBegan : 0;
    if (sceneHasPrefabEntries(sceneData)) {
        await turn();
        sceneData = await timed('prefab', () => expandScenePrefabAssets(sceneData, runtimeAssets));
        attempt.assertCurrent();
    }
    // A streamed world's cell, as the world remembers it: what was destroyed taken out, what was left set back, before anything
    // of it spawns.
    if (app.hasResource(WorldMemoryRes)) sceneData = app.getResource(WorldMemoryRes).adapt(sceneName ?? '', sceneData);

    // Prefabs and remembered components can also carry older names. Discovery,
    // subsystem selection and spawn all consume the same normalized document.
    const migrationBegan = onPhase ? performance.now() : 0;
    migrateOwnedSceneData(sceneData);
    if (onPhase) onPhase('migrate', copyMs + performance.now() - migrationBegan);

    await turn();
    const discoverBegan = onPhase ? performance.now() : 0;

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
    if (source.resolveRef) {
        const backend = sceneAssets.backend;
        videoSupport()?.setRefResolver(app, ref => backend.resolveUrl(sceneAssets.resolveLoadPath(ref)), backend);
    }
    const sceneRef = (ref: string) => sceneAssets.sceneAssetRef(ref) ?? ref;
    mergeSceneTextureImportSettings(sceneAssets, sceneData, sceneRef);
    const dragonBones = dragonBonesSupport();
    let discovered!: SceneAssetRefs;
    let pairCount = 0;
    let assetsBegan: number | undefined;
    const report = options.onProgress;
    let completed = 0, total = 0;
    const regularProgress: SceneLoadProgressCallback | undefined = report && ((loaded, regularTotal) => {
        attempt.assertCurrent();
        completed = loaded;
        total = regularTotal + pairCount;
        report(completed, total);
    });
    const finishPairs = report && ((count = 1) => {
        attempt.assertCurrent();
        completed += count;
        report(completed, total);
    });
    try {
        attempt.assets = await sceneAssets.preloadSceneAssets(sceneData, regularProgress, {
            skipSpine: true, summary: options.streamedPiece ? 'debug' : 'info',
            entityOwnership: !sceneOwned,
            onDiscover(authored) {
                // Both skeletal runtimes bind by the spelling still on the component.
                discovered = authored;
                if (app.sideModules) pairCount = (spine ? authored.spines.length : 0)
                    + (dragonBones ? authored.dragonBones.length : 0);
                if (onPhase) {
                    onPhase('discover', performance.now() - discoverBegan);
                    assetsBegan = performance.now();
                }
            },
        });
    } finally {
        if (onPhase && assetsBegan !== undefined) onPhase('assets', performance.now() - assetsBegan);
    }
    const assetResult = attempt.assets;
    await turn();
    attempt.assertCurrent();
    const retainEntityAssets = sceneOwned ? undefined
        : prepareSpawnOwnership(sceneData, assetResult, sceneAssets.entityScopes, sceneRef);
    sceneAssets.resolveSceneAssetPaths(sceneData, assetResult);
    applySceneTextureMetadata(sceneData, assetResult);

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
    const transcoderProvider = (): Promise<BasisTranscoder | null> => basisTranscoderFor(app.sideModules);
    const subsystemsBegan = onPhase ? performance.now() : 0;
    // Prepared by the realm, owned by the scene: the receipts join the scope
    // this scene gives back, and a second scene of one spine asset joins its era
    // instead of uploading its pages again.
    if (discovered.spines.length > 0 && !spine) {
        log.warn('scene', `${discovered.spines.length} Spine asset(s) skipped — this build ships`
            + ' without the Spine runtime');
    }
    const spineAssetInfo = app.sideModules && spine
        ? await spine.load(module, source, spineManager, discovered.spines, transcoderProvider,
                           { assets: sceneAssets, scope: assetResult.scope }, finishPairs)
        : new Map<string, SpineAssetInfo>();
    attempt.assertCurrent();

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
            dragonBonesManager = (await dragonBones?.acquire(app)) ?? null;
            attempt.assertCurrent();
            if (!dragonBonesManager) {
                log.warn('scene', dragonBones
                    ? 'DragonBones assets present but the runtime could not be loaded'
                    : 'DragonBones assets present but this build ships without the runtime');
                if (dragonBones) finishPairs?.(discovered.dragonBones.length);
            } else {
                dragonBonesAssetInfo = await dragonBones!.load(
                    module, source, discovered.dragonBones, transcoderProvider, sceneAssets, assetResult.scope, finishPairs);
                attempt.assertCurrent();
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
        // Once per game: said per scene, a streamed world said it for every cell it brought in.
        if (!saidNoPhysics.has(app)) {
            saidNoPhysics.add(app);
            log.info('physics', 'not installed — not declared (features.physics) and scene has no physics components');
        }
    } else {
        await installOnce(app, 'physics', attempt, async () => {
            if (!physicsModule && app.sideModules) {
                physicsModule = (await app.sideModules.acquire('physics')) as PhysicsWasmModule | null;
                attempt.assertCurrent();
            }
            if (!physicsModule) {
                log.warn('physics', `wanted (declared=${!!physicsEnabled}) but no module loaded — this realm has no side-module host or physics.wasm failed to load`);
            } else if (!physicsSupport()) {
                log.warn('physics', 'wanted, but this build ships without the 2D physics runtime');
            } else if (!physicsSupport()!.installed(app)) {
                const gravity = physicsConfig?.gravity ?? { ...DEFAULT_GRAVITY };
                const config: Physics2DPluginConfig = {
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
                physicsSupport()!.install(app, config, physicsModule);
                log.info('physics', `installed (gravity ${gravity.x}, ${gravity.y})`);
            }
        });
    }

    // The 3D world gates itself the same way, on its own components and its own
    // module: the two never share a solver, so a scene wanting one is not asking
    // for the other.
    if (sceneUses3DPhysics(sceneData)) {
        await installOnce(app, 'physics3d', attempt, async () => {
            const p3d = physics3dSupport();
            if (!p3d) {
                log.warn('physics3d', 'scene has 3D physics components but this build ships'
                    + ' without the 3D physics runtime');
                return;
            }
            if (p3d.installed(app)) return;
            const module3d = options.physics3dModule
                ?? (app.sideModules
                    ? (await app.sideModules.acquire(physics3dModuleId(options.physics3dBackend))) as Physics3DWasmModule | null
                    : null);
            attempt.assertCurrent();
            if (!module3d) {
                log.warn('physics3d', 'scene has 3D physics components but no module loaded —'
                    + ` this realm has no side-module host or the ${options.physics3dBackend ?? 'jolt'} module failed to load`);
                return;
            }
            const config3d = physics3DInstallConfig(options.physics3dWorld, physicsConfig);
            p3d.install(app, module3d, config3d);
            log.info('physics3d', `installed (${config3d.pixelsPerUnit ?? 100} units per metre)`);
        });
    }

    // Self-gating i18n, mirroring physics: a scene that binds Text.i18nKey needs
    // the Localization resource + the shipped `.eslocale` tables — installed and
    // loaded here so no runtime entry can forget. Tables come from the realm's
    // OWN asset list (they're loaded by key, never referenced by the scene).
    // Idempotent across scene switches: the resource persists, table loads hit
    // the Assets cache, addCatalog merges. Awaited so the first frame renders
    // words, not raw keys.
    attempt.assertCurrent();
    if (sceneUsesI18n(sceneData)) {
        const autoInstalled = !app.hasResource(Localization);
        if (autoInstalled) app.addPlugin(new LocalizationPlugin());
        const tables = (source.listAssetPaths?.() ?? []).filter((p) => p.toLowerCase().endsWith('.eslocale'));
        if (tables.length === 0) {
            log.warn('i18n', 'scene binds a localization key but this realm lists no .eslocale tables — keys will render raw');
        } else {
            await Promise.all(tables.map((p) => sceneAssets.loadLocaleTable(p).catch((e: unknown) => {
                log.error('i18n', `locale table ${p} failed to load: ${e instanceof Error ? e.message : String(e)}`);
            })));
            attempt.assertCurrent();
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

    // Loading the runtimes a cell's content needs, and the tables it binds. All
    // of it self-gating and installed once, so the first cell of a world pays
    // for the world and the ones after it pay for their own content only.
    if (onPhase) onPhase('subsystems', performance.now() - subsystemsBegan);

    // The one place a packaged scene's entities come into being. `externalEntities`
    // is what lets a streamed cell name the persistent world: without it a cross
    // document reference resolves to nothing, quietly.

    return {
        name: sceneName, lifetime: attempt.lifetime, options, sceneData, assetResult, retainEntityAssets,
        spineManager, spineAssetInfo, dragonBonesManager, dragonBonesAssetInfo, discovered,
    };
}


interface PublicationTarget {
    externalEntities?: ReadonlyMap<number, Entity> | (() => ReadonlyMap<number, Entity> | undefined);
    context?: SceneContext | null;
}

type SpreadSceneSpawn = (job: Generator<number, StagedSpawn, void>) => Promise<StagedSpawn>;

function assertSceneContext(app: App, context?: SceneContext | null): void {
    if (!context || !app.hasResource(SceneManager)) return;
    const manager = app.getResource(SceneManager);
    if (manager.getScene(context.name) !== context || manager.getSceneStatus(context.name) === 'unloading') {
        throw new SceneLoadCancelled(context.name);
    }
}

function guardedAssetProgress(
    assertCurrent: () => void, observer?: SceneLoadProgressCallback, scene?: SceneLoadProgressCallback,
): SceneLoadProgressCallback | undefined {
    if (!observer && !scene) return undefined;
    return (loaded, total) => {
        assertCurrent();
        observer?.(loaded, total);
        if (scene !== observer) scene?.(loaded, total);
    };
}

/**
 * Bring a prepared scene into the world.
 *
 * The publication boundary: before this returns no system has seen a single one
 * of the cell's entities, because none of them existed. Nothing downstream has
 * to learn to ignore a half-arrived cell.
 *
 * @experimental
 */
export function publishRuntimeScene(
    prepared: PreparedRuntimeScene,
    // Resolve the current scene and external references at publication. Prepared
    // native resources belong to the registry in which they were acquired.
    now?: PublicationTarget,
    /**
     * Spread the spawn over frames (a streamed cell): handed the staged spawn as a job, it runs it under the frame's budget.
     * The scene's roots stay switched off until the end of this call and are switched on whole, so nothing sees it half
     * arrived — time-sliced, with the level visible only once it returns true.
     */
    spread?: SpreadSceneSpawn,
): Promise<void> {
    const attempt = new SceneLoadAttempt(prepared.options.app.world, prepared.name ?? prepared.sceneData.name);
    return runSceneLoad(attempt, () =>
        publishPreparedScene(prepared, attempt, now, spread), prepared.assetResult);
}

async function publishPreparedScene(
    prepared: PreparedRuntimeScene, attempt: SceneLoadAttempt,
    now?: PublicationTarget, spread?: SpreadSceneSpawn,
): Promise<void> {
    const { sceneData, assetResult, spineManager, spineAssetInfo,
            dragonBonesManager, dragonBonesAssetInfo } = prepared;
    const { app, module, uiTheme, uiThemeOverrides, sceneName } = prepared.options;
    if (prepared.lifetime !== undefined && prepared.lifetime !== attempt.lifetime) {
        throw new SceneLoadCancelled(sceneName ?? sceneData.name);
    }
    const onPhase = attempt.observe(prepared.options.onPhase);
    assertSceneContext(app, now?.context);
    const links = now?.externalEntities;
    const externalEntities = (typeof links === 'function' ? links() : links) ?? prepared.options.externalEntities;
    attempt.assertCurrent();
    const timed = scenePhaseRunner(onPhase);
    const hasSceneManager = !!sceneName && app.hasResource(SceneManager);
    const ctx = now?.context !== undefined ? now.context
        : hasSceneManager ? app.getResource(SceneManager).getScene(sceneName) : null;
    const assertScene = ctx ? () => assertSceneContext(app, ctx) : undefined;
    const assertCurrent = () => { assertScene?.(); attempt.assertCurrent(); };
    /**
     * The synchronous sibling of `timed`, for the steps that ARE synchronous.
     *
     * `timed` is `async`, so measuring these with it opens a microtask gap per
     * step through which another cell's publication could interleave — an
     * instrument that changed the thing it measures.
     */
    const mark = <T>(phase: string, run: () => T): T => {
        assertCurrent();
        if (!onPhase) return run();
        const began = performance.now();
        try { return run(); } finally { onPhase(phase, performance.now() - began); }
    };
    let staged: StagedSpawn | null = null;
    let entityMap: Map<number, Entity>;
    if (spread) {
        const spawning: StagedSpawn = { entities: new Map(), hidden: [] };
        const job = spawnAndLoadEntitiesJob(app.world, sceneData, externalEntities, onPhase, true, spawning, assertScene, attempt);
        try { staged = await spread(job); }
        finally { job.return(spawning); }
        entityMap = staged.entities;
    } else {
        entityMap = await timed('spawn', () =>
            spawnAndLoadEntities(app.world, sceneData, externalEntities, onPhase, assertScene, attempt));
    }
    assertCurrent();
    app.getResource(AssetsResource).trackSceneAssetReferences(sceneData, entityMap, app.world);
    registerDeferredInstances(app.world, sceneData.deferredInstances, entityMap);
    // Which document row each entity came from, when someone is keeping track
    // (an editor inspecting its own running game). No-op otherwise.
    mark('origins', () => recordSceneOrigins(app, entityMap));

    // Apply the project theme over the freshly instantiated scene: prefabs bake
    // the default dark palette, so a light base or any token override re-resolves
    // every ThemeStyle tag.
    if (uiTheme === 'light' || uiThemeOverrides) {
        mark('theme', () => switchTheme(app.world, resolveThemeTokens(uiTheme ?? 'dark', uiThemeOverrides)));
    }

    const cppRegistry = app.world.getCppRegistry();
    // Fold the loaded transforms into world matrices once, before the first frame.
    // Native hosts run their own TransformSystem each frame instead.
    if (cppRegistry && module) {
        mark('transform', () => module.transform_update(cppRegistry));
    }

    const spine = spineSupport();
    if (spineManager && cppRegistry && spine) {
        await timed('spine', () => spine.apply({ spineManager, sceneData, entityMap, registry: cppRegistry, assetInfo: spineAssetInfo }));
        assertCurrent();
    }

    if (dragonBonesManager) {
        mark('dragonbones', () => dragonBonesSupport()!.apply({
            manager: dragonBonesManager, sceneData, entityMap, assetInfo: dragonBonesAssetInfo,
        }));
    }

    if (hasSceneManager) {
        // Adopt into the SceneManager's instance set so unload/switchTo actually
        // despawns these entities — SceneOwner alone is only the persistence tag.
        mark('adopt', () => {
            for (const entity of entityMap.values()) {
                assertCurrent();
                if (ctx) ctx.adopt(entity);
                else app.world.insert(entity, SceneOwner, { scene: sceneName, persistent: false });
            }
        });
    }

    // Last, once everything about it is in place: a staged scene is switched on whole.
    if (staged) {
        const whole = staged;
        mark('reveal', () => revealStagedEntities(app.world, whole));
    }
    assertCurrent();
    if (ctx) {
        ctx.trackAssetScope(assetResult.scope);
    } else {
        const ownership = prepared.retainEntityAssets?.();
        try { ownership?.attach(app.world, entityMap); }
        finally { ownership?.release(); }
        assetResult.scope.releaseAll();
    }
}

/**
 * Prepare a scene and publish it. What every caller outside residency wants, and
 * the shape the two halves are defined against.
 */
export async function loadRuntimeScene(options: LoadRuntimeSceneOptions): Promise<void> {
    const { app, sceneName } = options;
    const context = sceneName && app.hasResource(SceneManager) ? app.getResource(SceneManager).getScene(sceneName) : null;
    const onProgress = guardedAssetProgress(() => assertSceneContext(app, context), options.onProgress, context?.reportAssetProgress);
    const prepared = await prepareRuntimeScene({ ...options, onProgress }, !!context);
    await publishRuntimeScene(prepared, { context });
}


/** A streamed cell's scene: brought in and taken out over frames, under the frame's budget (see `createRuntimeSceneConfig`). */
export interface StreamedSceneOptions {
    /** What the work is called where work in hand is shown (the editor's status bar, a loading screen). */
    label?: string;
}

/** Despawns `doomed` one entity a step, yielding how far along it is. */
function* despawnJob(retirement: SceneRetirement, doomed: readonly Entity[]): Generator<number, void, void> {
    for (let i = 0; i < doomed.length; i++) {
        retirement.despawn(doomed[i]!);
        yield (i + 1) / doomed.length;
    }
}

export function createRuntimeSceneConfig(
    name: string,
    sceneData: SceneData | undefined,
    options: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'> & {
        prepareDocument?: (data: SceneData, assertActive: () => void) => Promise<SceneData>;
    },
    scenePath?: string,
    /** Present for a streamed cell: its publication and its unload are spread over frames (see {@link StreamedSceneOptions}). */
    streamed?: StreamedSceneOptions,
): SceneConfig {
    // Built first and closed over, so whoever sets `externalEntities` / `onPhase`
    // on the CONFIG is honoured here too: declared in one place and read in
    // another, a cell's reference to the persistent world resolved to nothing.
    // Held by the config, which IS the per-scene object: a prepared cell has one
    // place to live and one owner to release it.
    interface Preparation {
        done: Promise<PreparedRuntimeScene>;
        progress: SceneAssetProgress;
        ready?: PreparedRuntimeScene;
        discarded: boolean;
        assertOwner?: () => void;
    }
    let preparation: Preparation | undefined;
    // A streamed cell's work over frames: the one job in hand (its arrival or its departure), and whether a player would
    // see it missing. Urgency is said to the budget only while there is work for it to speed.
    let spreading: { finish: () => void } | null = null;
    let urgent = false;
    // Rushed before its job began (the load still awaiting what comes before the spawn): the job is finished the moment
    // it starts. Forgotten once the scene is no longer urgent.
    let rushed = false;
    const label = streamed?.label ?? name;
    const overFrames = async <T>(what: string, job: Generator<number, T, void>): Promise<T> => {
        const bakes = bakesOf(options.app);
        const handle = bakes.run(`${what} ${label}`, job);
        spreading = handle;
        bakes.urge(config, urgent);
        if (rushed) { rushed = false; handle.finish(); }
        try {
            return await handle.done;
        } finally {
            spreading = null;
            bakes.urge(config, false);
        }
    };
    // A streamed cell's preparation takes its pieces in a frame's turns (`Bakes.turn`); urgent, it is let through at once.
    // Rushed (`rush`), it waits for no turn at all until it is no longer wanted at once: the frames may have stopped.
    let hurried = false;
    const gate = streamed
        ? (): Promise<void> => (urgent || hurried ? Promise.resolve() : bakesOf(options.app).turn(config))
        : undefined;
    const readied = async (
        sceneOwned: boolean | undefined, assertActive: () => void,
        observer?: SceneLoadProgressCallback, sceneProgress?: SceneLoadProgressCallback,
    ): Promise<PreparedRuntimeScene> => {
        assertActive();
        const nextTurn = gate && (async () => { assertActive(); await gate(); assertActive(); });
        let data = sceneData;
        if (!data) {
            // Lazy scene: fetched by path through the per-App runtime Assets, so
            // the data arrives via the realm's own backend — http on web, wx fs
            // on WeChat — and only when something asks for the scene.
            if (!scenePath) throw new Error(`scene "${name}" registered with neither data nor path`);
            const began = performance.now();
            const text = await options.app.getResource(AssetsResource).fetchText(scenePath);
            assertActive();
            config.onPhase?.('fetch', performance.now() - began);
            // Parsed in a frame's turn: a cell's document is the largest single piece of its preparation.
            if (nextTurn) {
                const waited = performance.now();
                await nextTurn();
                config.onPhase?.('wait', performance.now() - waited);
            }
            const parsed = performance.now();
            data = JSON.parse(text) as SceneData;
            config.onPhase?.('parse', performance.now() - parsed);
        }
        if (options.prepareDocument) {
            data = await options.prepareDocument(data, assertActive);
            assertActive();
        }
        return prepareRuntimeScene({
            ...options, sceneData: data, sceneName: name, onPhase: config.onPhase, gate: nextTurn,
            onProgress: guardedAssetProgress(assertActive, observer, sceneProgress),
        }, sceneOwned ?? options.app.hasResource(SceneManager));
    };
    const discard = (pending: Preparation): number => {
        pending.discarded = true;
        pending.progress.close();
        if (streamed) bakesOf(options.app).release(config);
        const scope = pending.ready?.assetResult.scope;
        const owed = scope?.size ?? 0;
        scope?.releaseAll();
        return owed;
    };
    const config: SceneConfig = {
        name,
        async prepare() {
            if (!preparation) {
                // Install the slot before a read or observer can reenter. Setup takes this
                // same promise even when the assets it needs are still arriving.
                const pending: Preparation = {
                    discarded: false,
                    progress: new SceneAssetProgress(),
                    done: Promise.resolve().then(async () => {
                        const assertActive = (): void => {
                            if (pending.discarded) throw new SceneLoadCancelled(name);
                            pending.assertOwner?.();
                        };
                        const ready = await readied(undefined, assertActive, pending.progress.report);
                        if (pending.discarded) {
                            ready.assetResult.scope.releaseAll();
                            throw new SceneLoadCancelled(name);
                        }
                        pending.ready = ready;
                        return ready;
                    }).catch(error => {
                        pending.progress.close();
                        if (preparation === pending) preparation = undefined;
                        throw error;
                    }),
                };
                preparation = pending;
                pending.progress.observe(options.onProgress);
            }
            await preparation.done;
        },
        // The second obligation. It runs on what `prepare` decoded, so the mesh
        // references are already handles; readying from an unprepared scene would
        // describe requirements for geometry nothing has acquired.
        async readyRenderPrograms() {
            const prepared = preparation?.ready;
            if (!prepared) return { applicable: false } as RenderReadiness;
            if (gate) await gate();
            if (preparation?.ready !== prepared) return { applicable: false } as RenderReadiness;
            const result = readyMeshPrograms(options.module, prepared.sceneData);
            // Queued compiles are not ready programs: where shaders compile in the background, the claim waits for them.
            if (result.applicable) await shadersCompiled(options.module);
            return preparation?.ready === prepared ? result : { applicable: false };
        },
        discardPrepared() {
            // Speculation is not authority: what nobody asked for is given back,
            // receipts included, rather than published because it was ready.
            const pending = preparation;
            preparation = undefined;
            hurried = false;
            return pending ? discard(pending) : 0;
        },
        async setup(context) {
            const pending = preparation;
            preparation = undefined;
            const assertOwner = () => assertSceneContext(options.app, context);
            let ready: PreparedRuntimeScene;
            if (pending) {
                pending.assertOwner = assertOwner;
                try { pending.progress.observe(context?.reportAssetProgress); }
                catch (error) {
                    discard(pending);
                    await pending.done.catch(() => undefined);
                    throw error;
                }
                ready = await pending.done;
                pending.progress.close();
            } else {
                ready = await readied(!!context, assertOwner, options.onProgress, context?.reportAssetProgress);
            }
            await publishRuntimeScene(ready, { externalEntities: () => config.externalEntities?.(), context },
                streamed ? (job) => overFrames('Bringing in', job) : undefined);
        },
    };
    if (streamed) {
        // Hidden at once, every top of the doomed set switched off in this frame, then destroyed under the budget:
        // incremental unregistration (`s.LevelStreamingUnregisterComponentsTimeLimit`), with the place gone the moment it goes.
        config.retire = async (doomed, retirement = new SceneEntityBatch(options.app.world, doomed)) => {
            retirement.hideRoots();
            await overFrames('Taking out', despawnJob(retirement, doomed));
        };
        config.rush = () => {
            // Its preparation waits for no more turns either: rushed is wanted now, or the frames have stopped.
            hurried = true;
            bakesOf(options.app).release(config);
            if (spreading) spreading.finish();
            else rushed = true;
        };
        config.urge = (now) => {
            urgent = now;
            if (!now) { rushed = false; hurried = false; }
            if (now) bakesOf(options.app).release(config);
            if (spreading) bakesOf(options.app).urge(config, now);
        };
    }
    return config;
}

export interface RuntimeInitConfig extends RuntimeProjectSettings {
    app: App;
    /** Declarations captured from a project the host evaluated once for multiple game sessions. */
    projectPlugin?: Plugin;
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
    scenes: Array<{ name: string; data?: SceneData; path?: string; worldPath?: string }>;
    /** Preloaded world manifests keyed by their persistent scene's registered name. */
    worlds?: WorldManifest[];
    /** Cut an authored scene on first use when the host serves source documents (editor Play). */
    prepareWorld?: (scene: SceneData, name: string) => Promise<Pick<CutWorld, 'persistent' | 'manifest' | 'documents'> | null>;
    /**
     * Cell name → its document, for a host that already holds them: an editor
     * Play session cuts the unsaved scene in memory and has nowhere to fetch a
     * cell FROM. A package leaves this out and every cell arrives by its path;
     * the manifest is the same either way, cell paths included.
     */
    cellDocuments?: ReadonlyMap<string, SceneData>;
    firstScene: string;
    spineModule?: SpineWasmModule | null;
    spineManager?: SpineManager | null;
    physicsModule?: PhysicsWasmModule | null;
    /** The design resolution and camera fit. A desktop window opens at the design
     *  size; the fit itself is applied by createWebApp/createNativeApp. */
    screenFit?: { designWidth: number; designHeight: number; scaleMode: number; matchWidthOrHeight: number };
    /** The Steam application id; present ⇒ try to bring a Steam client up and let
     *  it answer for achievements. Absent or unavailable keeps the local one. */
    steamAppId?: number;
    aspectRatio?: number;
    /**
     * The compiled twins a build produced (docs/REARCH_AOT.md): bytes, because
     * fetching them is the transport's job — http here, `wx` there. Installed
     * before the first scene registers, the only moment where no component
     * exists yet to be left behind in the wrong memory.
     */
    aot?: AotModuleConfig<string | BufferSource>;
    debugChannel?: DebugChannelConfig;
}

/**
 * Sets the app's FixedUpdate step to the project's, whether or not physics is installed: a game that steps its own logic at a fixed rate
 * sets it in the same place (Project Settings > Physics > Fixed timestep). Before, only the physics plugins handed it to the app, so
 * without physics it stayed 1/60 whatever the project said. A missing or unusable step leaves the app's own.
 * @internal
 */
export function applyFixedTimestep(app: Pick<App, 'setFixedTimestep'>, physics: { fixedTimestep?: number } | undefined): void {
    const step = physics?.fixedTimestep;
    if (typeof step === 'number' && Number.isFinite(step) && step > 0) app.setFixedTimestep(step);
}

/** Prepare the persistent document and its world together, then hand its cells to the streamer only while it is active. */
function registerRuntimeScenes(config: RuntimeInitConfig, options: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'>): void {
    const { app } = config;
    const manager = app.getResource(SceneManager);
    const worlds = new Map<string, { manifest: WorldManifest; documents?: ReadonlyMap<string, SceneData> }>();
    for (const manifest of config.worlds ?? []) worlds.set(manifest.scene, { manifest, documents: config.cellDocuments });
    if (worlds.size > 0) enableSceneOrigins(app);
    for (const scene of config.scenes) {
        const { worldPath } = scene;
        const prepareDocument = async (data: SceneData, assertActive: () => void): Promise<SceneData> => {
            if (worldPath) {
                if (!worlds.has(scene.name)) {
                    const manifest = JSON.parse(await app.getResource(AssetsResource).backend.fetchText(worldPath)) as WorldManifest;
                    assertActive();
                    if (manifest?.version !== 1 || manifest.scene !== scene.name || !Array.isArray(manifest.cells)
                        || !Array.isArray(manifest.persistentRefs)) {
                        throw new Error(`Invalid world manifest "${worldPath}" for scene "${scene.name}"`);
                    }
                    worlds.set(scene.name, { manifest, documents: config.cellDocuments });
                }
            } else if (config.prepareWorld) {
                const cut = await config.prepareWorld(data, scene.name);
                assertActive();
                if (!cut) {
                    worlds.delete(scene.name);
                    return data;
                }
                worlds.set(scene.name, { manifest: cut.manifest, documents: cut.documents });
                data = cut.persistent;
            }
            // Authored ids are recorded when persistent entities are published, before a cell needs to resolve them.
            enableSceneOrigins(app);
            return data;
        };
        const sceneOptions = worldPath || config.prepareWorld ? { ...options, prepareDocument } : options;
        const registration = createRuntimeSceneConfig(scene.name, scene.data, sceneOptions, scene.path);
        if (config.prepareWorld && !worldPath) registration.cleanup = () => { worlds.delete(scene.name); };
        manager.register(registration);
    }
    if (!app.hasResource(WorldStreaming) || !(worlds.size || config.prepareWorld || config.scenes.some(scene => scene.worldPath))) return;

    const streamer = app.getResource(WorldStreaming);
    let ownsWorld = false;
    streamer.sourceSceneAllowed = scene => !ownsWorld || !worlds.has(scene) || scene === streamer.manifest?.scene;
    manager.setActiveSceneHandler(name => {
        const world = name === null ? undefined : worlds.get(name);
        if (!world) {
            if (!ownsWorld) return;
            return streamer.loadManifest(null).then(() => { if (!streamer.manifest) ownsWorld = false; });
        }
        ownsWorld = true;
        const { manifest, documents } = world;
        const piece = { ...options, streamedPiece: true };
        return streamer.loadManifest(manifest, cell => {
            const scene = createRuntimeSceneConfig(cell.name, documents?.get(cell.name), piece, cell.path, { label: cell.name });
            scene.externalEntities = () => persistentEntityRows(app, manifest);
            scene.onPhase = (phase, ms) => streamer.recordPhase(cell.name, phase, ms);
            return scene;
        }, (_cell, name, path) => createRuntimeSceneConfig(name, documents?.get(name), piece, path));
    });
}

export async function initRuntime(config: RuntimeInitConfig): Promise<void> {
    const { app, firstScene, aspectRatio } = config;
    // The App this bring-up is for. Quit while it awaits, it stops at the next step instead of
    // loading a scene into, and handing a loop to, an App that was released under it.
    const life = app.signal;

    if (config.projectPlugin) app.addPlugin(config.projectPlugin);
    else flushPendingRegistrations(app);

    // Before any scene: what a component's default fills in is in the project's units (ecs/worldUnits.ts).
    setWorldUnitsPerMeter(config.physics3dWorld?.unitsPerMeter ?? REFERENCE_UNITS_PER_METER);
    // And how hard it pulls: what falls with no physics body (waves, a waterfall) falls as a body does.
    const g = config.physics3dWorld?.gravity;
    setWorldGravity(g ? Math.hypot(g.x, g.y, g.z) : STANDARD_GRAVITY);

    applyFixedTimestep(app, config.physicsConfig);

    // First: the asset timeouts and cache budgets are read by the very first load below.
    if (config.runtime) applyBuildRuntimeConfig(app, config.runtime);

    // After the project's components are registered (the manifest names them)
    // and before any exists (its rows must be in the memory the module reads).
    // A module that disagrees with this engine or project throws here.
    if (config.aot) {
        const { module, sharedModule, manifest } = config.aot;
        const useShared = sharedModule !== undefined && typeof SharedArrayBuffer !== 'undefined'
            && app.wasmModule?.wasmMemory?.buffer instanceof SharedArrayBuffer;
        const installed = await app.installCompiledSystems(useShared ? sharedModule : module, manifest);
        life.throwIfAborted();
        log.info('runtime', `AOT: ${installed} compiled system(s) installed`);
    }

    if (config.debugChannel) startDebugChannel(config.debugChannel);

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
    // Once the content it runs is known, so the editor is told which revision it is.
    attachDebugChannel(app);
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
        physics3dBackend: config.physics3dBackend,
        physics3dWorld: config.physics3dWorld,
        physicsEnabled: config.physicsEnabled,
        uiTheme: config.uiTheme,
        uiThemeOverrides: config.uiThemeOverrides,
    };

    registerRuntimeScenes(config, sceneOpts);

    if (firstScene) {
        const mgr = app.getResource(SceneManager);
        mgr.setInitial(firstScene);
        await mgr.load(firstScene);
        life.throwIfAborted();
    }

    if (aspectRatio !== undefined) {
        updateCameraAspectRatio(app.world, aspectRatio);
    }
}
