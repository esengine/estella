// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    loadSpineScene.ts
 * @brief   Shared spine scene loader. For every SpineAnimation entity in a scene
 *          it fetches the skeleton/atlas/textures through the asset provider and
 *          hands them to the SpineManager — the single spine runtime
 *          implementation — then applies the component's props/skin/animation.
 *          Both the builder runtime loader and the editor scene loader call this,
 *          so spine loads identically on every target instead of being
 *          re-implemented per host.
 *
 * Two phases are exposed separately so entity ids exist before binding: phase 1
 * ({@link loadSpineAssets}) fetches + decodes assets and detects each version;
 * phase 2 ({@link applySpineEntities}) loads them into the SpineManager after the
 * scene spawns. Every version routes to its side-module backend — there is no
 * native runtime. {@link loadSpineSceneEntities} is the combined convenience.
 */
import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';
import { getComponentSpineFieldDescriptor, type SceneData } from '../scene';
import { discoverSceneAssets } from '../asset/discoverAssets';
import { getAssetTypeEntry } from '../assetTypes';
import { requireResourceManager } from '../resourceManager';
import { log } from '../logger';
import { SpineManager, type SpineVersion } from './SpineManager';
import { createTextureFromPixels, type RuntimeAssetSource } from '../runtimeAssets';

/** The opaque C++ registry handle SpineManager.loadEntity expects (app.world.getCppRegistry()). */
type CppRegistry = Parameters<SpineManager['loadEntity']>[4];

interface SpineAssetInfo {
    version: SpineVersion | null;
    skelData: Uint8Array | string;
    atlasText: string;
    textures: Map<string, { glId: number; w: number; h: number }>;
}

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

/**
 * Phase 1 — fetch + decode each spine pair's skeleton/atlas/textures and detect
 * its runtime version. Keyed by `skeletonRef:atlasRef` for {@link applySpineEntities}.
 */
export async function loadSpineAssets(
    module: ESEngineModule,
    source: RuntimeAssetSource,
    spineManager: SpineManager | null | undefined,
    spinePairs: ReadonlyArray<{ skeleton: string; atlas: string }>,
): Promise<Map<string, SpineAssetInfo>> {
    const assetInfoMap = new Map<string, SpineAssetInfo>();
    const resolveRef = source.resolveRef ?? ((r: string) => r);

    for (const pair of spinePairs) {
        const skelRef = pair.skeleton;
        const atlasRef = pair.atlas;
        const cacheKey = `${skelRef}:${atlasRef}`;

        // Resolve skeleton/atlas refs (uuid/manifest → build path); the derived
        // texPath below is already a path, so it is NOT re-resolved.
        const atlasPath = resolveRef(atlasRef);

        try {
            const atlasContent = await source.backend.fetchText(atlasPath);

            const skelPath = resolveRef(skelRef);
            const isBinary = getAssetTypeEntry(skelPath)?.contentType === 'binary';
            const skelData: Uint8Array | string = isBinary
                ? new Uint8Array(await source.backend.fetchBinary(skelPath))
                : await source.backend.fetchText(skelPath);

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
                    const result = await source.decodePixels(texPath, false);
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

            assetInfoMap.set(cacheKey, { version, skelData, atlasText: atlasContent, textures });
        } catch (err) {
            log.warn('runtime', `Failed to load spine asset: skel=${skelRef} atlas=${atlasRef}`, err);
        }
    }
    return assetInfoMap;
}

/**
 * Phase 2 — for each SpineAnimation entity, route its loaded asset to the
 * SpineManager (every version loads its side-module backend) and apply the
 * component's props, skin, and animation.
 */
export async function applySpineEntities(opts: {
    spineManager: SpineManager;
    sceneData: SceneData;
    entityMap: Map<number, Entity>;
    registry: CppRegistry;
    assetInfo: Map<string, SpineAssetInfo>;
}): Promise<void> {
    const { spineManager, sceneData, entityMap, registry, assetInfo } = opts;
    if (assetInfo.size === 0) return;

    for (const sceneEntity of sceneData.entities) {
        for (const comp of sceneEntity.components) {
            const spineDesc = getComponentSpineFieldDescriptor(comp.type);
            if (!spineDesc || !comp.data) continue;
            const skelRef = comp.data[spineDesc.skeletonField] as string;
            const atlasRef = comp.data[spineDesc.atlasField] as string;
            if (!skelRef || !atlasRef) continue;

            const info = assetInfo.get(`${skelRef}:${atlasRef}`);
            if (!info || !info.version) continue;

            const entity = entityMap.get(sceneEntity.id);
            if (entity === undefined) continue;

            await spineManager.loadEntity(
                entity, info.skelData, info.atlasText, info.textures, registry,
                `${skelRef}:${atlasRef}`);

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

/**
 * Combined convenience: discover spine pairs in the scene, load their assets, and
 * apply them to the spawned entities. For hosts (the editor) driving the 3.8/4.1
 * JS runtimes, where the native virtual-FS ordering doesn't apply.
 */
export async function loadSpineSceneEntities(opts: {
    module: ESEngineModule;
    source: RuntimeAssetSource;
    spineManager: SpineManager;
    sceneData: SceneData;
    entityMap: Map<number, Entity>;
    registry: CppRegistry;
}): Promise<void> {
    const discovered = discoverSceneAssets(opts.sceneData);
    if (discovered.spines.length === 0) return;
    const assetInfo = await loadSpineAssets(opts.module, opts.source, opts.spineManager, discovered.spines);
    await applySpineEntities({
        spineManager: opts.spineManager,
        sceneData: opts.sceneData,
        entityMap: opts.entityMap,
        registry: opts.registry,
        assetInfo,
    });
}
