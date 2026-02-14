/**
 * @file    runtimeLoader.ts
 * @brief   Runtime scene loader for builder targets (WeChat, Playable, etc.)
 */

import { Sprite, SpineAnimation, BitmapText, WorldTransform, type SpineAnimationData, type WorldTransformData } from './component';
import { Material } from './material';
import { loadSceneData, type SceneData } from './scene';
import type { ESEngineModule } from './wasm';
import { wrapSpineModule, type SpineWasmModule, type SpineWrappedAPI } from './spine/SpineModuleLoader';
import type { PhysicsWasmModule } from './physics/PhysicsModuleLoader';
import { PhysicsPlugin, type PhysicsPluginConfig } from './physics/PhysicsPlugin';
import type { App } from './app';
import type { Entity, Vec2 } from './types';
import type { AddressableManifest } from './asset/AssetServer';
import { Assets } from './asset/AssetPlugin';

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

function createTextureFromPixels(
    module: ESEngineModule,
    result: { width: number; height: number; pixels: Uint8Array },
    flipY: boolean = true,
): number {
    const rm = module.getResourceManager();
    const ptr = module._malloc(result.pixels.length);
    module.HEAPU8.set(result.pixels, ptr);
    const handle = rm.createTexture(result.width, result.height, ptr, result.pixels.length, 1, flipY);
    module._free(ptr);
    return handle;
}

async function loadTextures(
    module: ESEngineModule,
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
): Promise<Record<string, number>> {
    const cache: Record<string, number> = {};
    for (const entity of sceneData.entities) {
        for (const comp of entity.components) {
            if (comp.type === 'Sprite' && comp.data.texture && typeof comp.data.texture === 'string') {
                const ref = comp.data.texture as string;
                if (cache[ref] !== undefined) continue;
                try {
                    cache[ref] = createTextureFromPixels(module, await provider.loadPixels(ref));
                } catch {
                    cache[ref] = 0;
                }
            }
        }
    }
    return cache;
}

function applyTextureMetadata(
    module: ESEngineModule,
    sceneData: SceneData,
    textureCache: Record<string, number>,
): void {
    if (!sceneData.textureMetadata) return;
    const rm = module.getResourceManager();
    for (const ref in sceneData.textureMetadata) {
        const handle = textureCache[ref];
        if (handle && handle > 0) {
            const metadata = sceneData.textureMetadata[ref];
            if (metadata?.sliceBorder) {
                const b = metadata.sliceBorder;
                rm.setTextureMetadata(handle, b.left, b.right, b.top, b.bottom);
            }
        }
    }
}

function updateSpriteTextures(
    world: App['world'],
    sceneData: SceneData,
    textureCache: Record<string, number>,
    entityMap: Map<number, number>,
): void {
    for (const entityData of sceneData.entities) {
        const entity = entityMap.get(entityData.id);
        if (entity === undefined) continue;
        for (const comp of entityData.components) {
            if (comp.type === 'Sprite' && comp.data.texture && typeof comp.data.texture === 'string') {
                const sprite = world.get(entity, Sprite);
                if (sprite) {
                    sprite.texture = textureCache[comp.data.texture as string] || 0;
                    world.insert(entity, Sprite, sprite);
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

async function loadSpineAssets(
    module: ESEngineModule,
    spineModule: SpineWasmModule,
    spineAPI: SpineWrappedAPI,
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
): Promise<Record<string, number>> {
    const skeletons: Record<string, number> = {};
    for (const entity of sceneData.entities) {
        for (const comp of entity.components) {
            if (comp.type !== 'SpineAnimation' || !comp.data) continue;
            const skelRef = comp.data.skeletonPath as string;
            const atlasRef = comp.data.atlasPath as string;
            if (!skelRef || !atlasRef) continue;

            const skelPath = provider.resolvePath(skelRef);
            const atlasPath = provider.resolvePath(atlasRef);

            try {
                const atlasContent = await provider.readText(atlasRef);
                const isBinary = skelPath.endsWith('.skel');

                let skelDataPtr: number;
                let skelDataLen: number;
                if (isBinary) {
                    const bytes = await provider.readBinary(skelRef);
                    skelDataLen = bytes.length;
                    skelDataPtr = spineModule._malloc(skelDataLen);
                    spineModule.HEAPU8.set(bytes, skelDataPtr);
                } else {
                    const text = await provider.readText(skelRef);
                    const encoder = new TextEncoder();
                    const bytes = encoder.encode(text);
                    skelDataLen = bytes.length;
                    skelDataPtr = spineModule._malloc(skelDataLen + 1);
                    spineModule.HEAPU8.set(bytes, skelDataPtr);
                    spineModule.HEAPU8[skelDataPtr + skelDataLen] = 0;
                }

                const skelHandle = spineAPI.loadSkeleton(
                    skelDataPtr, skelDataLen, atlasContent, atlasContent.length, isBinary);
                spineModule._free(skelDataPtr);
                if (skelHandle < 0) continue;

                skeletons[skelRef] = skelHandle;

                const texNames = parseAtlasTextures(atlasContent);
                const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
                for (let k = 0; k < texNames.length; k++) {
                    const texPath = atlasDir + '/' + texNames[k];
                    try {
                        const result = provider.loadPixelsRaw
                            ? await provider.loadPixelsRaw(texPath)
                            : await provider.loadPixels(texPath);
                        const handle = createTextureFromPixels(module, result, false);
                        const rm = module.getResourceManager();
                        const glId = rm.getTextureGLId(handle);
                        spineAPI.setAtlasPageTexture(skelHandle, k, glId, result.width, result.height);
                    } catch { /* skip missing texture */ }
                }
            } catch { /* skip failed spine asset */ }
        }
    }
    return skeletons;
}

function createSpineInstances(
    spineAPI: SpineWrappedAPI,
    sceneData: SceneData,
    skeletons: Record<string, number>,
    entityMap: Map<number, number>,
): Record<number, number> {
    const instances: Record<number, number> = {};
    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;
        for (const comp of entityData.components) {
            if (comp.type !== 'SpineAnimation' || !comp.data) continue;
            const skelRef = comp.data.skeletonPath as string;
            const skelHandle = skeletons[skelRef];
            if (skelHandle === undefined) continue;

            const instanceId = spineAPI.createInstance(skelHandle);
            if (instanceId < 0) continue;

            const entity = entityMap.get(entityData.id);
            if (entity !== undefined) instances[entity] = instanceId;

            if (comp.data.animation) {
                spineAPI.playAnimation(
                    instanceId, comp.data.animation as string,
                    comp.data.loop !== false, 0);
            }
            if (comp.data.skin) {
                spineAPI.setSkin(instanceId, comp.data.skin as string);
            }
        }
    }
    return instances;
}

function buildTransformMatrix(
    wt: WorldTransformData,
    skeletonScale: number,
    flipX: boolean,
    flipY: boolean,
): Float32Array {
    const sx = wt.scale.x * skeletonScale * (flipX ? -1 : 1);
    const sy = wt.scale.y * skeletonScale * (flipY ? -1 : 1);
    const sz = wt.scale.z;
    const qx = wt.rotation.x, qy = wt.rotation.y, qz = wt.rotation.z, qw = wt.rotation.w;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    return new Float32Array([
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        wt.position.x, wt.position.y, wt.position.z, 1,
    ]);
}

function setupSpineRenderer(
    app: App,
    module: ESEngineModule,
    spineModule: SpineWasmModule,
    spineAPI: SpineWrappedAPI,
    instances: Record<number, number>,
): void {
    let lastElapsed = 0;
    app.setSpineRenderer((_registry: unknown, elapsed: number) => {
        let dt = elapsed - lastElapsed;
        lastElapsed = elapsed;
        if (dt <= 0 || dt > 0.5) dt = 1 / 60;

        const world = app.world;

        for (const entity in instances) {
            const entityId = Number(entity) as Entity;
            const instanceId = instances[entity];

            const spineData = world.has(entityId, SpineAnimation)
                ? world.get(entityId, SpineAnimation) as SpineAnimationData
                : null;

            const playing = spineData?.playing !== false;
            const timeScale = spineData?.timeScale ?? 1;
            if (playing) {
                spineAPI.update(instanceId, dt * timeScale);
            }

            let transformPtr = 0;
            if (world.has(entityId, WorldTransform)) {
                const wt = world.get(entityId, WorldTransform) as WorldTransformData;
                const skeletonScale = spineData?.skeletonScale ?? 1;
                const flipX = spineData?.flipX ?? false;
                const flipY = spineData?.flipY ?? false;
                const mat = buildTransformMatrix(wt, skeletonScale, flipX, flipY);
                transformPtr = module._malloc(64);
                module.HEAPF32.set(mat, transformPtr >> 2);
            }

            const batchCount = spineAPI.getMeshBatchCount(instanceId);
            for (let b = 0; b < batchCount; b++) {
                const vertCount = spineAPI.getMeshBatchVertexCount(instanceId, b);
                const idxCount = spineAPI.getMeshBatchIndexCount(instanceId, b);
                if (!vertCount || !idxCount) continue;

                const vertBytes = vertCount * 8 * 4;
                const idxBytes = idxCount * 2;
                const vertPtr = spineModule._malloc(vertBytes);
                const idxPtr = spineModule._malloc(idxBytes);
                const texIdPtr = spineModule._malloc(4);
                const blendPtr = spineModule._malloc(4);

                spineAPI.getMeshBatchData(instanceId, b, vertPtr, idxPtr, texIdPtr, blendPtr);
                const texId = spineModule.HEAPU32[texIdPtr >> 2];
                const blendMode = spineModule.HEAPU32[blendPtr >> 2];
                const srcVerts = new Float32Array(spineModule.HEAPF32.buffer, vertPtr, vertCount * 8);
                const srcIdx = new Uint16Array(spineModule.HEAPU8.buffer, idxPtr, idxCount);

                const coreVertPtr = module._malloc(vertBytes);
                const coreIdxPtr = module._malloc(idxBytes);
                module.HEAPF32.set(srcVerts, coreVertPtr >> 2);
                new Uint16Array(module.HEAPU8.buffer, coreIdxPtr, idxCount).set(srcIdx);

                module.renderer_submitTriangles(
                    coreVertPtr, vertCount, coreIdxPtr, idxCount,
                    texId, blendMode, transformPtr);

                module._free(coreVertPtr);
                module._free(coreIdxPtr);
                spineModule._free(vertPtr);
                spineModule._free(idxPtr);
                spineModule._free(texIdPtr);
                spineModule._free(blendPtr);
            }

            if (transformPtr) module._free(transformPtr);
        }
    });
}

// =============================================================================
// BitmapFont Helpers
// =============================================================================

async function loadBitmapFonts(
    module: ESEngineModule,
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
): Promise<Record<string, number>> {
    const cache: Record<string, number> = {};
    for (const entity of sceneData.entities) {
        for (const comp of entity.components) {
            if (comp.type !== 'BitmapText' || !comp.data.font || typeof comp.data.font !== 'string') continue;
            const ref = comp.data.font as string;
            if (cache[ref] !== undefined) continue;
            try {
                let fntContent: string;
                let fntDir: string;

                if (ref.endsWith('.bmfont')) {
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

                const rm = module.getResourceManager();
                cache[ref] = rm.loadBitmapFont(fntContent, texHandle, pixels.width, pixels.height);
            } catch {
                cache[ref] = 0;
            }
        }
    }
    return cache;
}

function updateBitmapTextFonts(
    world: App['world'],
    sceneData: SceneData,
    fontCache: Record<string, number>,
    entityMap: Map<number, number>,
): void {
    for (const entityData of sceneData.entities) {
        const entity = entityMap.get(entityData.id);
        if (entity === undefined) continue;
        for (const comp of entityData.components) {
            if (comp.type !== 'BitmapText' || !comp.data.font || typeof comp.data.font !== 'string') continue;
            const handle = fontCache[comp.data.font as string] || 0;
            if (!handle) continue;
            const bt = world.get(entity, BitmapText);
            if (bt) {
                bt.font = handle;
                world.insert(entity, BitmapText, bt);
            }
        }
    }
}

// =============================================================================
// Material Helpers
// =============================================================================

async function loadMaterials(
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
): Promise<Record<string, number>> {
    const materialCache: Record<string, number> = {};
    const shaderCache: Record<string, number> = {};
    for (const entity of sceneData.entities) {
        for (const comp of entity.components) {
            if (!comp.data || typeof comp.data.material !== 'string' || !comp.data.material) continue;
            if (comp.type !== 'Sprite' && comp.type !== 'SpineAnimation') continue;
            const matRef = comp.data.material as string;
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
            } catch {
                materialCache[matRef] = 0;
            }
        }
    }
    return materialCache;
}

function updateMaterials(
    world: App['world'],
    sceneData: SceneData,
    materialCache: Record<string, number>,
    entityMap: Map<number, number>,
): void {
    for (const entityData of sceneData.entities) {
        const entity = entityMap.get(entityData.id);
        if (entity === undefined) continue;
        for (const comp of entityData.components) {
            if (!comp.data || typeof comp.data.material !== 'string' || !comp.data.material) continue;
            const handle = materialCache[comp.data.material as string] || 0;
            if (!handle) continue;
            if (comp.type === 'Sprite') {
                const sprite = world.get(entity, Sprite);
                if (sprite) {
                    sprite.material = handle;
                    world.insert(entity, Sprite, sprite);
                }
            } else if (comp.type === 'SpineAnimation') {
                const spine = world.get(entity, SpineAnimation);
                if (spine) {
                    spine.material = handle;
                    world.insert(entity, SpineAnimation, spine);
                }
            }
        }
    }
}

// =============================================================================
// Public API
// =============================================================================

export async function loadRuntimeScene(
    app: App,
    module: ESEngineModule,
    sceneData: SceneData,
    provider: RuntimeAssetProvider,
    spineModule?: SpineWasmModule | null,
    physicsModule?: PhysicsWasmModule | null,
    physicsConfig?: { gravity?: Vec2; fixedTimestep?: number; subStepCount?: number },
    manifest?: AddressableManifest | null,
): Promise<void> {
    const textureCache = await loadTextures(module, sceneData, provider);
    applyTextureMetadata(module, sceneData, textureCache);

    let spineSkeletons: Record<string, number> = {};
    let spineAPI: SpineWrappedAPI | null = null;
    if (spineModule) {
        spineAPI = wrapSpineModule(spineModule);
        spineSkeletons = await loadSpineAssets(module, spineModule, spineAPI, sceneData, provider);
    }

    if (physicsModule) {
        const config: PhysicsPluginConfig = {
            gravity: physicsConfig?.gravity ?? { x: 0, y: -9.81 },
            fixedTimestep: physicsConfig?.fixedTimestep ?? 1 / 60,
            subStepCount: physicsConfig?.subStepCount ?? 4,
        };
        const physicsPlugin = new PhysicsPlugin('', config, () => Promise.resolve(physicsModule));
        physicsPlugin.build(app);
    }

    const fontCache = await loadBitmapFonts(module, sceneData, provider);
    const materialCache = await loadMaterials(sceneData, provider);
    const entityMap = loadSceneData(app.world, sceneData);

    updateSpriteTextures(app.world, sceneData, textureCache, entityMap);
    updateBitmapTextFonts(app.world, sceneData, fontCache, entityMap);
    updateMaterials(app.world, sceneData, materialCache, entityMap);

    if (spineModule && spineAPI) {
        const instances = createSpineInstances(spineAPI, sceneData, spineSkeletons, entityMap);
        setupSpineRenderer(app, module, spineModule, spineAPI, instances);
    }

    if (manifest) {
        const assetServer = app.getResource(Assets);
        if (assetServer) {
            assetServer.setAddressableManifest(manifest);
        }
    }
}
