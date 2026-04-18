/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

import { SceneOwner } from './component';
import { Material } from './material';
import { loadSceneData, getComponentAssetFieldDescriptors, getComponentSpineFieldDescriptor, type AssetFieldType, type SceneData } from './scene';
import { discoverSceneAssets, getAssetPathsByType } from './asset/discoverAssets';
import type { ESEngineModule } from './wasm';
import type { SpineWasmModule } from './spine/SpineModuleLoader';
import { SpineManager, type SpineVersion } from './spine/SpineManager';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import { PhysicsPlugin, type PhysicsPluginConfig } from './physics/PhysicsPlugin';
import type { App } from './app';
import type { Vec2 } from './types';
import type { AddressableManifest } from './asset/AddressableManifest';
import { Assets } from './asset/AssetPlugin';
import { getAssetTypeEntry } from './assetTypes';
import { SceneManager, type SceneConfig } from './sceneManager';
import { DEFAULT_GRAVITY, DEFAULT_FIXED_TIMESTEP } from './defaults';
import { type AnimClipAssetData, extractAnimClipTexturePaths, parseAnimClipData } from './animation/AnimClipLoader';
import { registerAnimClip } from './animation/SpriteAnimator';
import { Audio } from './audio/Audio';
import { flushPendingSystems } from './app';
import { updateCameraAspectRatio } from './scene';
import { requireResourceManager } from './resourceManager';
import { parseTmjJson, resolveRelativePath } from './tilemap/tiledLoader';
import { registerTilemapSource } from './tilemap/tilesetCache';
import { log } from './logger';

// =============================================================================
// Public Interface
// =============================================================================

export interface RuntimeAssetProvider {
    loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }>;
    loadPixelsRaw?(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }>;
    readText(ref: string): string | Promise<string>;
    readBinary(ref: string): Uint8Array | Promise<Uint8Array>;
    resolvePath(ref: string): string;
}

// =============================================================================
// Texture Helpers
// =============================================================================

const FILTER_MODE_MAP: Record<string, number> = { 'nearest': 0, 'linear': 1 };
const WRAP_MODE_MAP: Record<string, number> = { 'repeat': 0, 'clamp': 1, 'mirror': 2 };

interface TextureParams {
    filterMode?: string;
    wrapMode?: string;
}

function createTextureFromPixels(
    module: ESEngineModule,
    result: { width: number; height: number; pixels: Uint8Array },
    flipY: boolean = true,
    params?: TextureParams,
): number {
    const rm = requireResourceManager();
    const ptr = module._malloc(result.pixels.length);
    module.HEAPU8.set(result.pixels, ptr);

    let handle: number;
    if (params && (params.filterMode || params.wrapMode) && rm.createTextureEx) {
        const filter = FILTER_MODE_MAP[params.filterMode ?? 'linear'] ?? 1;
        const wrap = WRAP_MODE_MAP[params.wrapMode ?? 'clamp'] ?? 1;
        handle = rm.createTextureEx(result.width, result.height, ptr, result.pixels.length, 1, flipY, filter, wrap);
    } else {
        handle = rm.createTexture(result.width, result.height, ptr, result.pixels.length, 1, flipY);
    }
    module._free(ptr);
    return handle;
}

async function loadTextures(
    module: ESEngineModule,
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
    texturePaths: Set<string>,
): Promise<Record<string, number>> {
    const cache: Record<string, number> = {};
    const texSettings = (sceneData as any).textureImporterSettings as Record<string, TextureParams> | undefined;
    for (const ref of texturePaths) {
        try {
            const params = texSettings?.[ref];
            const pixelData = await provider.loadPixels(ref);
            const handle = createTextureFromPixels(module, pixelData, true, params);
            cache[ref] = handle;
        } catch (e) {
            log.warn('runtime', `Failed to load texture: ${ref}`, e);
            cache[ref] = 0;
        }
    }
    return cache;
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
// Spine Helpers
// =============================================================================

function parseAtlasTextures(content: string): string[] {
    const textures: string[] = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.includes(':') && (/\.png$/i.test(trimmed) || /\.jpg$/i.test(trimmed))) {
            textures.push(trimmed);
        }
    }
    return textures;
}

function ensureVirtualDir(module: ESEngineModule, virtualPath: string): void {
    const fs = module.FS;
    if (!fs) return;
    const dir = virtualPath.substring(0, virtualPath.lastIndexOf('/'));
    if (!dir) return;
    const parts = dir.split('/').filter(p => p);
    let currentPath = '';
    for (const part of parts) {
        currentPath += '/' + part;
        try { fs.mkdir(currentPath); } catch { /* already exists */ }
    }
}

function writeToVirtualFS(module: ESEngineModule, virtualPath: string, data: string | Uint8Array): boolean {
    const fs = module.FS;
    if (!fs) return false;
    try {
        ensureVirtualDir(module, virtualPath);
        fs.writeFile(virtualPath, data);
        return true;
    } catch (e) {
        log.warn('runtime', `Failed to write virtual FS: ${virtualPath}`, e);
        return false;
    }
}

interface SpineAssetInfo {
    version: SpineVersion | null;
    skelData: Uint8Array | string;
    atlasText: string;
    textures: Map<string, { glId: number; w: number; h: number }>;
}

async function loadSpineAssetsToVirtualFS(
    module: ESEngineModule,
    provider: RuntimeAssetProvider,
    spineManager: SpineManager | null | undefined,
    spinePairs: ReadonlyArray<{ skeleton: string; atlas: string }>,
): Promise<Map<string, SpineAssetInfo>> {
    const assetInfoMap = new Map<string, SpineAssetInfo>();

    for (const pair of spinePairs) {
        const skelRef = pair.skeleton;
        const atlasRef = pair.atlas;
        const cacheKey = `${skelRef}:${atlasRef}`;

        const atlasPath = provider.resolvePath(atlasRef);

            try {
                const atlasContent = await provider.readText(atlasRef);

                const skelPath = provider.resolvePath(skelRef);
                const isBinary = getAssetTypeEntry(skelPath)?.contentType === 'binary';
                const skelData = isBinary
                    ? await provider.readBinary(skelRef)
                    : await provider.readText(skelRef);

                const version = spineManager
                    ? (typeof skelData === 'string'
                        ? SpineManager.detectVersionJson(skelData)
                        : SpineManager.detectVersion(skelData))
                    : null;

                const texNames = parseAtlasTextures(atlasContent);
                const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
                const rm = requireResourceManager();
                const textures = new Map<string, { glId: number; w: number; h: number }>();

                for (const texName of texNames) {
                    const texPath = atlasDir + '/' + texName;
                    try {
                        const result = provider.loadPixelsRaw
                            ? await provider.loadPixelsRaw(texPath)
                            : await provider.loadPixels(texPath);
                        const handle = createTextureFromPixels(module, result, false);
                        rm.registerTextureWithPath(handle, texPath);
                        textures.set(texName, {
                            glId: rm.getTextureGLId(handle),
                            w: result.width,
                            h: result.height,
                        });
                    } catch (err) {
                        log.warn('runtime', `Failed to load texture: ${texPath}`, err);
                    }
                }

                const isNative = !version || version === '4.2';
                if (isNative) {
                    writeToVirtualFS(module, atlasPath, atlasContent);
                    writeToVirtualFS(module, skelPath, skelData);
                }

                assetInfoMap.set(cacheKey, { version, skelData, atlasText: atlasContent, textures });
            } catch (err) {
                log.warn('runtime', `Failed to load spine asset: skel=${skelRef} atlas=${atlasRef}`, err);
            }
    }
    return assetInfoMap;
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
    module: ESEngineModule,
    provider: RuntimeAssetProvider,
    animClipPaths: Set<string>,
): Promise<void> {
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
            registerAnimClip(clip);
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
                tilesets.push({ textureHandle, columns: ts.columns });
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
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number; contactHertz?: number; contactDampingRatio?: number; contactSpeed?: number };
    manifest?: AddressableManifest | null;
    sceneName?: string;
}

export async function loadRuntimeScene(options: LoadRuntimeSceneOptions): Promise<void> {
    const { app, module, sceneData, provider, spineManager, physicsModule, physicsConfig, manifest, sceneName } = options;

    const discovered = discoverSceneAssets(sceneData);

    const textureCache = await loadTextures(module, sceneData, provider, getAssetPathsByType(discovered, 'texture'));
    applyTextureMetadata(sceneData, textureCache);

    const spineAssetInfo = await loadSpineAssetsToVirtualFS(module, provider, spineManager, discovered.spines);

    if (physicsModule) {
        const config: PhysicsPluginConfig = {
            gravity: physicsConfig?.gravity ?? { ...DEFAULT_GRAVITY },
            fixedTimestep: physicsConfig?.fixedTimestep ?? DEFAULT_FIXED_TIMESTEP,
            subStepCount: physicsConfig?.subStepCount ?? 4,
            contactHertz: physicsConfig?.contactHertz ?? 120,
            contactDampingRatio: physicsConfig?.contactDampingRatio ?? 10,
            contactSpeed: physicsConfig?.contactSpeed ?? 10,
        };
        const physicsPlugin = new PhysicsPlugin('', config, () => Promise.resolve(physicsModule));
        physicsPlugin.build(app);
    }

    const fontCache = await loadBitmapFonts(module, provider, getAssetPathsByType(discovered, 'font'));
    const materialCache = await loadMaterials(provider, getAssetPathsByType(discovered, 'material'));
    await loadAnimClips(module, provider, getAssetPathsByType(discovered, 'anim-clip'));
    await loadTilemaps(module, provider, getAssetPathsByType(discovered, 'tilemap'));
    await preloadAudioClips(app, provider, getAssetPathsByType(discovered, 'audio'));

    resolveSceneAssetPaths(sceneData, textureCache, fontCache, materialCache);
    const entityMap = loadSceneData(app.world, sceneData);

    const cppRegistry = app.world.getCppRegistry();
    if (cppRegistry) {
        (module as ESEngineModule).transform_update(cppRegistry);
    }

    if (spineManager && cppRegistry && spineAssetInfo.size > 0) {
        for (const sceneEntity of sceneData.entities) {
            for (const comp of sceneEntity.components) {
                const spineDesc = getComponentSpineFieldDescriptor(comp.type);
                if (!spineDesc || !comp.data) continue;
                const skelRef = comp.data[spineDesc.skeletonField] as string;
                const atlasRef = comp.data[spineDesc.atlasField] as string;
                if (!skelRef || !atlasRef) continue;

                const cacheKey = `${skelRef}:${atlasRef}`;
                const info = spineAssetInfo.get(cacheKey);
                if (!info || !info.version || info.version === '4.2') continue;

                const entity = entityMap.get(sceneEntity.id);
                if (entity === undefined) continue;

                await spineManager.loadEntity(
                    entity, info.skelData, info.atlasText, info.textures, cppRegistry);

                spineManager.setEntityProps(entity, {
                    skeletonScale: (comp.data.skeletonScale as number) ?? 1,
                    flipX: (comp.data.flipX as boolean) ?? false,
                    flipY: (comp.data.flipY as boolean) ?? false,
                    layer: (comp.data.layer as number) ?? 0,
                });
                const skin = comp.data.skin as string;
                if (skin) spineManager.setSkin(entity, skin);
                const animation = comp.data.animation as string;
                if (animation) {
                    spineManager.setAnimation(entity, animation, comp.data.loop !== false);
                }
            }
        }
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
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number; contactHertz?: number; contactDampingRatio?: number; contactSpeed?: number };
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
