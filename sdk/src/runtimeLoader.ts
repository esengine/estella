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
import { initBuiltinAssetFields } from './asset/AssetFieldRegistry';
import type { TextureImportSettings } from './asset/loaders/TextureLoader';
import { SceneManager, type SceneConfig } from './sceneManager';
import { DEFAULT_GRAVITY, DEFAULT_FIXED_TIMESTEP } from './defaults';
import { SpriteAnimation } from './animation/SpriteAnimator';
import { Audio } from './audio/Audio';
import { flushPendingSystems } from './app';
import { requireResourceManager } from './resourceManager';
import { log } from './logger';
import { type RuntimeAssetSource, type TextureParams } from './runtimeAssets';
import { loadSpineAssets, applySpineEntities } from './spine/loadSpineScene';
import { transcoderFromModule, type BasisWasmModule } from './asset/basisTranscoder';

// =============================================================================
// Public Interface
// =============================================================================

// RuntimeAssetSource + createTextureFromPixels live in ./runtimeAssets so the
// spine scene loader can share them without importing this module.
export type { RuntimeAssetSource } from './runtimeAssets';

// =============================================================================
// Scene-local Assets channel
// =============================================================================

/**
 * Build a scene-local `Assets` that loads this realm's scene through the single
 * canonical asset channel, driven by the realm's `RuntimeAssetSource`:
 *   - fetch (text/binary, incl. KTX2 containers) → `source.backend`
 *   - texture pixels → `source.decodePixels` (handles `estella://` / WeChat
 *     package files / inlined data-URLs that a URL `<img>` can't)
 *   - KTX2 transcode → the same self-gating Basis side-module the editor wires
 * `source.resolveRef` is the single ref resolver, so refs resolve to their real
 * (extension-bearing) build paths before KTX2 detection and fetch. No ref
 * counter / catalog is attached (parity with the old runtime loader, which
 * tracked neither and applied no atlas-frame indirection).
 */
function createSceneAssets(
    app: App, module: ESEngineModule, source: RuntimeAssetSource, sceneData: SceneData,
): AssetsClass {
    initBuiltinAssetFields();
    const assets = AssetsClass.create({
        backend: source.backend,
        module,
        getAudio: () => (app.hasResource(Audio) ? app.getResource(Audio) : null),
        getSpriteAnimation: () => (app.hasResource(SpriteAnimation) ? app.getResource(SpriteAnimation) : null),
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

    // Per-texture import settings (filter/wrap) keyed by the scene's stored ref:
    // normalize keys through resolveRef so they match the resolved path the
    // TextureLoader sees, and map the stored {filterMode,wrapMode} shape to the
    // loader's {filter,wrap}.
    const resolveRef = source.resolveRef ?? ((r: string) => r);
    const rawSettings = (sceneData as { textureImporterSettings?: Record<string, TextureParams> })
        .textureImporterSettings;
    if (rawSettings) {
        const resolved: Record<string, TextureImportSettings> = {};
        for (const [ref, s] of Object.entries(rawSettings)) {
            resolved[resolveRef(ref)] = {
                filter: s.filterMode as TextureImportSettings['filter'],
                wrap: s.wrapMode as TextureImportSettings['wrap'],
            };
        }
        assets.setTextureImportSettingsResolver((ref) => resolved[ref]);
    }

    return assets;
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

/** True if any entity carries a physics component, or a TilemapLayer that will spawn
 *  colliders at runtime (its baked collidable tiles are invisible to a component scan). */
function sceneUsesPhysics(sceneData: SceneData): boolean {
    for (const entity of sceneData.entities ?? []) {
        for (const comp of entity.components ?? []) {
            if (PHYSICS_COMPONENT_TYPES.has(comp.type)) return true;
            if (comp.type === 'TilemapLayer') {
                const ids = (comp.data as Record<string, unknown> | undefined)?.collidableTileIds;
                if (Array.isArray(ids) && ids.length > 0) return true;
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
    // provider. Spine stays a two-phase load+apply below (skipSpine).
    const sceneAssets = createSceneAssets(app, module, source, sceneData);
    const assetResult = await sceneAssets.preloadSceneAssets(sceneData, undefined, { skipSpine: true });
    sceneAssets.resolveSceneAssetPaths(sceneData, assetResult);
    applyTextureMetadata(sceneData, assetResult.textureHandles, source.resolveRef ?? ((ref) => ref));

    const spineAssetInfo = await loadSpineAssets(module, source, spineManager, discovered.spines);

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
    sceneData: SceneData,
    options: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'>,
): SceneConfig {
    return {
        name,
        async setup() {
            await loadRuntimeScene({ ...options, sceneData, sceneName: name });
        },
    };
}

export interface RuntimeInitConfig {
    app: App;
    module: ESEngineModule;
    source: RuntimeAssetSource;
    scenes: Array<{ name: string; data: SceneData }>;
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
        mgr.register(createRuntimeSceneConfig(scene.name, scene.data, sceneOpts));
    }

    if (firstScene) {
        mgr.setInitial(firstScene);
        await mgr.load(firstScene);
    }

    if (aspectRatio !== undefined) {
        updateCameraAspectRatio(app.world, aspectRatio);
    }
}
