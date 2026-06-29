// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

import { SceneOwner } from './component';
import { Material } from './material';
import { loadSceneData, getComponentAssetFieldDescriptors, type AssetFieldType, type SceneData } from './scene';
import { discoverSceneAssets, getAssetPathsByType } from './asset/discoverAssets';
import type { ESEngineModule } from './wasm';
import type { SpineWasmModule } from './spine/SpineModuleLoader';
import { SpineManager } from './spine/SpineManager';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import { PhysicsPlugin, type PhysicsPluginConfig } from './physics/PhysicsPlugin';
import { SpinePlugin } from './spine/SpinePlugin';
import type { App } from './app';
import type { AddressableManifest } from './asset/AddressableManifest';
import { Assets } from './asset/AssetPlugin';
import { getAssetTypeEntry } from './assetTypes';
import { SceneManager, type SceneConfig } from './sceneManager';
import { DEFAULT_GRAVITY, DEFAULT_FIXED_TIMESTEP } from './defaults';
import { type AnimClipAssetData, extractAnimClipTexturePaths, parseAnimClipData } from './animation/AnimClipLoader';
import { SpriteAnimation } from './animation/SpriteAnimator';
import { Audio } from './audio/Audio';
import { flushPendingSystems } from './app';
import { updateCameraAspectRatio } from './scene';
import { requireResourceManager } from './resourceManager';
import { parseTmjJson, resolveRelativePath } from './tilemap/tiledLoader';
import { registerTilemapSource } from './tilemap/tilesetCache';
import { log } from './logger';
import { createTextureFromPixels, type RuntimeAssetProvider, type TextureParams } from './runtimeAssets';
import { loadSpineAssets, applySpineEntities } from './spine/loadSpineScene';
import { loadCompressedTexture, type CompressedUploadOptions, type BasisTranscoder } from './asset/compressed';
import { transcoderFromModule, type BasisWasmModule } from './asset/basisTranscoder';

// =============================================================================
// Public Interface
// =============================================================================

// RuntimeAssetProvider + createTextureFromPixels live in ./runtimeAssets so the
// spine scene loader can share them without importing this module.
export type { RuntimeAssetProvider } from './runtimeAssets';

// =============================================================================
// Texture Helpers
// =============================================================================

async function loadTextures(
    module: ESEngineModule,
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
    texturePaths: Set<string>,
    transcoder: BasisTranscoder | null,
): Promise<Record<string, number>> {
    const cache: Record<string, number> = {};
    const texSettings = (sceneData as any).textureImporterSettings as Record<string, TextureParams> | undefined;
    const gl = transcoder ? getWebGL2(module) : null;
    for (const ref of texturePaths) {
        try {
            const params = texSettings?.[ref];
            // KTX2 stays GPU-compressed in VRAM: decode to a device format
            // through the SAME compressed.ts core the editor TextureLoader uses, so
            // both paths agree by construction. Non-KTX2 keeps the RGBA upload.
            if (transcoder && gl && provider.resolvePath(ref).toLowerCase().endsWith('.ktx2')) {
                const bytes = await provider.readBinary(ref);
                const r = loadCompressedTexture(gl, module, transcoder, new Uint8Array(bytes), compressedOpts(params));
                cache[ref] = r.handle;
            } else {
                const pixelData = await provider.loadPixels(ref);
                cache[ref] = createTextureFromPixels(module, pixelData, true, params);
            }
        } catch (e) {
            log.warn('runtime', `Failed to load texture: ${ref}`, e);
            cache[ref] = 0;
        }
    }
    return cache;
}

/** WebGL2 context the emscripten module renders into (for JS-side compressed
 *  uploads via gl.compressedTexImage2D), or null. */
function getWebGL2(module: ESEngineModule): WebGL2RenderingContext | null {
    try {
        const ctx = (module.GL as any)?.currentContext?.GLctx;
        return (typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext) ? ctx : null;
    } catch { return null; }
}

/** Map runtime TextureParams (filterMode/wrapMode) → compressed upload options. */
function compressedOpts(params?: TextureParams): CompressedUploadOptions {
    const filter = params?.filterMode === 'nearest' ? 'nearest' : 'linear';
    const wrap = params?.wrapMode === 'repeat' ? 'repeat' : params?.wrapMode === 'mirror' ? 'mirror' : 'clamp';
    return { filter, wrap };
}

/** Acquire the Basis transcoder iff the scene uses any KTX2 texture — self-gating
 *  off app.sideModules, the same way physics/spine acquire their modules. */
async function acquireBasisIfNeeded(
    app: App, provider: RuntimeAssetProvider, texturePaths: Set<string>,
): Promise<BasisTranscoder | null> {
    if (!app.sideModules) return null;
    let needs = false;
    for (const ref of texturePaths) {
        if (provider.resolvePath(ref).toLowerCase().endsWith('.ktx2')) { needs = true; break; }
    }
    if (!needs) return null;
    const mod = await app.sideModules.acquire('basis');
    return mod ? transcoderFromModule(mod as unknown as BasisWasmModule) : null;
}

function applyTextureMetadata(
    sceneData: SceneData,
    textureCache: Record<string, number>,
): void {
    if (!sceneData.textureMetadata) return;
    const rm = requireResourceManager();
    for (const ref in sceneData.textureMetadata) {
        const handle = textureCache[ref];
        if (handle) {
            const metadata = sceneData.textureMetadata[ref];
            if (metadata?.sliceBorder) {
                const b = metadata.sliceBorder;
                rm.setTextureMetadata(handle, b.left, b.right, b.top, b.bottom);
            }
        }
    }
}

function resolveSceneAssetPaths(
    sceneData: SceneData,
    textureCache: Record<string, number>,
    fontCache: Record<string, number>,
    materialCache: Record<string, number>,
): void {
    const cacheByType: Partial<Record<AssetFieldType, Record<string, number>>> = {
        texture: textureCache,
        material: materialCache,
        font: fontCache,
    };
    for (const entity of sceneData.entities) {
        for (const comp of entity.components) {
            const descriptors = getComponentAssetFieldDescriptors(comp.type);
            if (descriptors.length === 0) continue;

            const data = comp.data as Record<string, unknown>;
            for (const desc of descriptors) {
                const cache = cacheByType[desc.type];
                if (cache && typeof data[desc.field] === 'string') {
                    data[desc.field] = cache[data[desc.field] as string] || 0;
                }
            }
        }
    }
}

// =============================================================================
// BitmapFont Helpers
// =============================================================================

async function loadBitmapFonts(
    module: ESEngineModule,
    provider: RuntimeAssetProvider,
    fontPaths: Set<string>,
): Promise<Record<string, number>> {
    const cache: Record<string, number> = {};
    for (const ref of fontPaths) {
        if (cache[ref] !== undefined) continue;
        try {
            let fntContent: string;
            let fntDir: string;

            const fontEntry = getAssetTypeEntry(ref);
            if (fontEntry?.editorType === 'bitmap-font' && fontEntry.contentType === 'json') {
                const json = JSON.parse(await provider.readText(ref));
                const fntFile = json.type === 'label-atlas' ? json.generatedFnt : json.fntFile;
                if (!fntFile) { cache[ref] = 0; continue; }
                const dir = ref.substring(0, ref.lastIndexOf('/'));
                const fntRef = dir ? `${dir}/${fntFile}` : fntFile;
                fntContent = await provider.readText(fntRef);
                fntDir = fntRef.substring(0, fntRef.lastIndexOf('/'));
            } else {
                fntContent = await provider.readText(ref);
                fntDir = ref.substring(0, ref.lastIndexOf('/'));
            }

            const pageMatch = fntContent.match(/file="([^"]+)"/);
            if (!pageMatch) { cache[ref] = 0; continue; }

            const texRef = fntDir ? `${fntDir}/${pageMatch[1]}` : pageMatch[1];
            const pixels = provider.loadPixelsRaw
                ? await provider.loadPixelsRaw(texRef)
                : await provider.loadPixels(texRef);
            const texHandle = createTextureFromPixels(module, pixels, false);

            const rm = requireResourceManager();
            cache[ref] = rm.loadBitmapFont(fntContent, texHandle, pixels.width, pixels.height);
        } catch (e) {
            log.warn('runtime', `Failed to load bitmap font: ${ref}`, e);
            cache[ref] = 0;
        }
    }
    return cache;
}

// =============================================================================
// Material Helpers
// =============================================================================

async function loadMaterials(
    provider: RuntimeAssetProvider,
    materialPaths: Set<string>,
): Promise<Record<string, number>> {
    const materialCache: Record<string, number> = {};
    const shaderCache: Record<string, number> = {};
    for (const matRef of materialPaths) {
        if (materialCache[matRef] !== undefined) continue;
        try {
            const matData = JSON.parse(await provider.readText(matRef));
            if (!matData.vertexSource || !matData.fragmentSource) {
                materialCache[matRef] = 0;
                continue;
            }
            const shaderKey = matData.vertexSource + matData.fragmentSource;
            let shaderHandle = shaderCache[shaderKey];
            if (!shaderHandle) {
                shaderHandle = Material.createShader(matData.vertexSource, matData.fragmentSource);
                shaderCache[shaderKey] = shaderHandle;
            }
            materialCache[matRef] = Material.createFromAsset(matData, shaderHandle);
        } catch (e) {
            log.warn('runtime', `Failed to load material: ${matRef}`, e);
            materialCache[matRef] = 0;
        }
    }
    return materialCache;
}

// =============================================================================
// Audio Helpers
// =============================================================================

async function preloadAudioClips(app: App, provider: RuntimeAssetProvider, audioPaths: Set<string>): Promise<void> {
    if (audioPaths.size === 0) return;
    if (!app.hasResource(Audio)) {
        log.warn('runtime', 'No Audio resource; skipping audio preload (AudioPlugin not installed?)');
        return;
    }
    const audio = app.getResource(Audio);

    const paths = [...audioPaths];

    if (provider) {
        await Promise.all(paths.map(async (path) => {
            try {
                const binary = await provider.readBinary(path);
                await audio.preloadFromData(path, binary.buffer as ArrayBuffer);
            } catch (err) {
                log.warn('runtime', `Failed to preload audio: ${path}`, err);
            }
        }));
    } else {
        await audio.preloadAll(paths).catch(err => {
            log.warn('runtime', 'Failed to preload audio assets', err);
        });
    }
}

// =============================================================================
// Anim-Clip Helpers
// =============================================================================

async function loadAnimClips(
    app: App,
    module: ESEngineModule,
    provider: RuntimeAssetProvider,
    animClipPaths: Set<string>,
): Promise<void> {
    const anim = app.hasResource(SpriteAnimation) ? app.getResource(SpriteAnimation) : null;
    for (const clipPath of animClipPaths) {
        try {
            const clipText = await provider.readText(clipPath);
            const clipData: AnimClipAssetData = JSON.parse(clipText);
            const texturePaths = extractAnimClipTexturePaths(clipData);
            const textureHandles = new Map<string, number>();

            for (const texPath of texturePaths) {
                try {
                    const result = await provider.loadPixels(texPath);
                    textureHandles.set(texPath, createTextureFromPixels(module, result));
                } catch (e) {
                    log.warn('runtime', `Failed to load anim texture: ${texPath}`, e);
                    textureHandles.set(texPath, 0);
                }
            }

            const clip = parseAnimClipData(clipPath, clipData, textureHandles);
            anim?.registerClip(clip);
        } catch (err) {
            log.warn('runtime', `Failed to load animation clip: ${clipPath}`, err);
        }
    }
}

// =============================================================================
// Tilemap Helpers
// =============================================================================

async function loadTilemaps(
    module: ESEngineModule,
    provider: RuntimeAssetProvider,
    tilemapPaths: Set<string>,
): Promise<void> {
    for (const tmjPath of tilemapPaths) {
        try {
            const jsonText = await provider.readText(tmjPath);
            const mapData = parseTmjJson(JSON.parse(jsonText));
            if (!mapData) continue;

            const tilesets = [];
            for (const ts of mapData.tilesets) {
                const imagePath = resolveRelativePath(tmjPath, ts.image);
                let textureHandle = 0;
                try {
                    const result = await provider.loadPixels(imagePath);
                    textureHandle = createTextureFromPixels(module, result);
                } catch (e) {
                    log.warn('runtime', `Failed to load tileset texture: ${imagePath}`, e);
                }
                tilesets.push({ textureHandle, columns: ts.columns, firstId: ts.firstGid });
            }

            registerTilemapSource(tmjPath, {
                tileWidth: mapData.tileWidth,
                tileHeight: mapData.tileHeight,
                layers: mapData.layers.map(l => ({
                    name: l.name,
                    width: l.width,
                    height: l.height,
                    tiles: l.tiles,
                    chunks: l.chunks ?? [],
                    infinite: l.infinite ?? false,
                })),
                tilesets,
            });
        } catch (err) {
            log.warn('runtime', `Failed to load tilemap: ${tmjPath}`, err);
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
    provider: RuntimeAssetProvider;
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
    manifest?: AddressableManifest | null;
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
    const { app, module, sceneData, provider, physicsConfig, physicsEnabled, manifest, sceneName } = options;

    // The SpineManager is owned by SpinePlugin (built from the realm's
    // app.sideModules host); read it from there so every realm — play / playable /
    // wechat — loads spine assets through one manager. An explicit option still
    // wins for headless/tests.
    const spineManager = options.spineManager ?? app.getPlugin(SpinePlugin)?.spineManager ?? null;

    const discovered = discoverSceneAssets(sceneData);

    const texturePaths = getAssetPathsByType(discovered, 'texture');
    const transcoder = await acquireBasisIfNeeded(app, provider, texturePaths);
    const textureCache = await loadTextures(module, sceneData, provider, texturePaths, transcoder);
    applyTextureMetadata(sceneData, textureCache);

    const spineAssetInfo = await loadSpineAssets(module, provider, spineManager, discovered.spines);

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

    const fontCache = await loadBitmapFonts(module, provider, getAssetPathsByType(discovered, 'font'));
    const materialCache = await loadMaterials(provider, getAssetPathsByType(discovered, 'material'));
    await loadAnimClips(app, module, provider, getAssetPathsByType(discovered, 'anim-clip'));
    await loadTilemaps(module, provider, getAssetPathsByType(discovered, 'tilemap'));
    await preloadAudioClips(app, provider, getAssetPathsByType(discovered, 'audio'));

    resolveSceneAssetPaths(sceneData, textureCache, fontCache, materialCache);
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


    if (manifest) {
        // Manifest/Catalog is now set at Assets creation time via Catalog.fromJson
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
    provider: RuntimeAssetProvider;
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
    manifest?: AddressableManifest | null;
    aspectRatio?: number;
}

export async function initRuntime(config: RuntimeInitConfig): Promise<void> {
    const { app, firstScene, aspectRatio } = config;

    flushPendingSystems(app);

    const sceneOpts: Omit<LoadRuntimeSceneOptions, 'sceneData' | 'sceneName'> = {
        app: config.app,
        module: config.module,
        provider: config.provider,
        spineModule: config.spineModule,
        spineManager: config.spineManager,
        physicsModule: config.physicsModule,
        physicsConfig: config.physicsConfig,
        physicsEnabled: config.physicsEnabled,
        manifest: config.manifest,
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
