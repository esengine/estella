// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonbones/loadDragonBonesScene.ts
 * @brief   Turning DragonBonesAnimation components into posed armatures.
 *
 * @details The counterpart of `spine/loadSpineScene.ts`, and split for the same
 *          reason: the builder runtime and the editor must load a scene's
 *          skeletons by ONE implementation, or the viewport and the shipped game
 *          disagree about what the scene contains.
 *
 *          Two phases, because entity ids do not exist until the scene spawns.
 *          Phase 1 fetches bytes and uploads the atlas page; phase 2 binds them to
 *          entities. The split is what lets the runtime loader interleave the fetch
 *          with everything else it preloads.
 *
 *          Where this differs from Spine is the atlas. A Spine `.atlas` lists its
 *          pages inside itself; a DragonBones `_tex.json` is a JSON object naming
 *          exactly one, in `imagePath`. So there is no page loop here — one image,
 *          resolved against the atlas's AUTHORED directory, because a cook renames
 *          the atlas and the image independently and neither ends up beside the
 *          other by accident.
 */
import type { ESEngineModule } from '../wasm';
import type { Entity } from '../types';
import { getComponentSkeletalFieldDescriptor, type SceneData } from '../scene/scene';
import { discoverSceneAssets } from '../asset/discoverAssets';
import { assetPairKey } from '../asset/assetPairKey';
import { getAssetTypeEntry } from '../assetTypes';
import { requireResourceManager } from '../wasm/resourceManager';
import { log } from '../util/logger';
import type { RuntimeAssetSource } from '../runtime/runtimeAssets';
import type { Assets } from '../asset/Assets';
import type { AssetLease, AssetScope } from '../asset/AssetLease';
import { atlasPagePath, withAtlasPages, type AcquireAtlasPage } from '../runtime/atlasPages';
import type { BasisTranscoder } from '../asset/compressed';
import type { DragonBonesManager } from './DragonBonesManager';
import { ownAtlas, bindAtlasTexture, releaseUnusedAtlases } from './atlasOwnership';

/** Lazily yields the realm's Basis transcoder, or null where a cook cannot have
 *  produced a compressed page (editor, uncooked dev). Same seam as Spine's. */
export type TranscoderProvider = () => Promise<BasisTranscoder | null>;

/**
 * The in-place editable props from a DragonBonesAnimation component's data — the
 * SINGLE extraction the scene loader and the editor's live-sync both feed to
 * `setEntityProps`, so a prop added to the component is carried by both paths from
 * one place instead of being hand-listed twice.
 */
export function dragonBonesEntityProps(d: Record<string, unknown>): {
    skeletonScale: number; flipX: boolean; flipY: boolean; layer: number;
    timeScale: number; playing: boolean;
    color: { r: number; g: number; b: number; a: number };
} {
    const num = (v: unknown, dflt: number): number => (typeof v === 'number' ? v : dflt);
    const color = d.color;
    return {
        skeletonScale: num(d.skeletonScale, 1),
        flipX: d.flipX === true,
        flipY: d.flipY === true,
        layer: num(d.layer, 0),
        timeScale: num(d.timeScale, 1),
        playing: d.playing !== false,
        // Opaque white rather than undefined, so CLEARING the field in the editor
        // resets the tint instead of leaving the last colour applied (setEntityProps
        // only writes a colour it was given). Same reasoning as spineEntityProps.
        color: color && typeof color === 'object'
            ? (color as { r: number; g: number; b: number; a: number })
            : { r: 1, g: 1, b: 1, a: 1 },
    };
}

/** What phase 1 fetched for one skeleton/atlas pair. */
export interface DragonBonesAssetInfo {
    skeletonData: Uint8Array | string;
    atlasJson: string;
    /** The uploaded page's id, or -1 when the image could not be loaded — the
     *  armature still poses, it just draws untextured, which is visible. */
    textureId: number;
}

/** The image a `_tex.json` names, or '' when it names none. */
function atlasImageName(atlasJson: string): string {
    try {
        const parsed: unknown = JSON.parse(atlasJson);
        const path = (parsed as { imagePath?: unknown } | null)?.imagePath;
        return typeof path === 'string' ? path : '';
    } catch {
        return '';
    }
}

/**
 * Phase 1 — fetch each pair's skeleton and atlas and upload the atlas image.
 * Keyed by the authored pair for {@link applyDragonBonesEntities}.
 */
export async function loadDragonBonesAssets(
    /** The wasm engine module, or null on a core with no heap — the upload goes
     *  through the ResourceManager's byte path there. */
    module: ESEngineModule | null,
    source: RuntimeAssetSource,
    pairs: ReadonlyArray<{ skeleton: string; atlas: string }>,
    transcoderProvider?: TranscoderProvider,
    assets?: Pick<Assets, 'acquireTexture'> & Partial<Pick<Assets, 'fetchText' | 'fetchBinary'>>,
    /** Holds each page until an armature takes it or the prepared scene is discarded. */
    scope?: AssetScope,
    /** Runs after each attempted pair, including a pair that failed to read. */
    onPairSettled?: () => void,
): Promise<Map<string, DragonBonesAssetInfo>> {
    return withAtlasPages(module, source, transcoderProvider,
        acquire => readDragonBonesPairs(source, pairs, acquire, assets, scope, onPairSettled), assets);
}

async function readDragonBonesPairs(
    source: RuntimeAssetSource, pairs: ReadonlyArray<{ skeleton: string; atlas: string }>,
    acquire: AcquireAtlasPage, assets?: Partial<Pick<Assets, 'fetchText' | 'fetchBinary'>>, scope?: AssetScope,
    onPairSettled?: () => void,
): Promise<Map<string, DragonBonesAssetInfo>> {
    const assetInfo = new Map<string, DragonBonesAssetInfo>();
    const resolveRef = source.resolveRef ?? ((r: string) => r);
    const text = (ref: string) => assets?.fetchText?.(ref) ?? source.backend.fetchText(resolveRef(ref));
    const binary = (ref: string) => assets?.fetchBinary?.(ref) ?? source.backend.fetchBinary(resolveRef(ref));

    for (const pair of pairs) {
        const cacheKey = assetPairKey(pair.skeleton, pair.atlas);
        if (assetInfo.has(cacheKey)) continue;

        try {
            const atlasJson = await text(pair.atlas);

            const skelPath = resolveRef(pair.skeleton);
            const skeletonData: Uint8Array | string =
                getAssetTypeEntry(skelPath)?.contentType === 'binary'
                    ? new Uint8Array(await binary(pair.skeleton))
                    : await text(pair.skeleton);

            const logicalAtlas = source.resolveAddress?.(pair.atlas) ?? resolveRef(pair.atlas);
            const page = await acquireAtlasImage(logicalAtlas, atlasJson, acquire);
            const info = {
                skeletonData,
                atlasJson,
                textureId: page.textureId,
            };
            if (page.lease) ownAtlas(info, page.lease, scope);
            assetInfo.set(cacheKey, info);
        } catch (err) {
            log.warn('runtime',
                `Failed to load DragonBones asset: skeleton=${pair.skeleton} atlas=${pair.atlas}`, err);
        }
        try { onPairSettled?.(); }
        catch (error) { releaseUnusedAtlases(assetInfo.values()); throw error; }
    }
    return assetInfo;
}

/** Acquire the page a `_tex.json` names; its release follows the skeleton's lifetime. */
async function acquireAtlasImage(
    logicalAtlas: string, atlasJson: string, acquire: AcquireAtlasPage,
): Promise<{ textureId: number; lease?: AssetLease }> {
    const image = atlasImageName(atlasJson);
    if (!image) {
        log.warn('runtime', `DragonBones atlas names no image: ${logicalAtlas}`);
        return { textureId: -1 };
    }
    const path = atlasPagePath(logicalAtlas, image);
    try {
        const lease = await acquire(path);
        try { return { textureId: requireResourceManager().getTextureGLId(lease.value.handle), lease }; }
        catch (error) { lease.release(); throw error; }
    } catch (err) {
        log.warn('runtime', `Failed to load DragonBones atlas image: ${path}`, err);
        return { textureId: -1 };
    }
}

/**
 * Phase 2 — for each DragonBonesAnimation entity, parse its pair into the manager
 * (shared per pair, so ten of the same armature parse the file once), bind the
 * uploaded page, and apply the component's armature, props and animation.
 */
export function applyDragonBonesEntities(opts: {
    manager: DragonBonesManager;
    sceneData: SceneData;
    entityMap: Map<number, Entity>;
    assetInfo: Map<string, DragonBonesAssetInfo>;
}): void {
    const { manager, sceneData, entityMap, assetInfo } = opts;
    if (assetInfo.size === 0) return;
    const touched = new Set<string>();
    try {
        for (const sceneEntity of sceneData.entities) {
            // Prefab instances carry no inline components; the loader expands them
            // before this runs.
            if (!Array.isArray(sceneEntity.components)) continue;

            for (const comp of sceneEntity.components) {
                const desc = getComponentSkeletalFieldDescriptor(comp.type);
                if (!desc || desc.runtime !== 'dragonbones' || !comp.data) continue;

                const data = comp.data as Record<string, unknown>;
                const skeletonRef = data[desc.skeletonField];
                const atlasRef = data[desc.atlasField];
                if (typeof skeletonRef !== 'string' || typeof atlasRef !== 'string') continue;
                if (!skeletonRef || !atlasRef) continue;

                const assetKey = assetPairKey(skeletonRef, atlasRef);
                const info = assetInfo.get(assetKey);
                if (!info) continue;

                const entity = entityMap.get(sceneEntity.id);
                if (entity === undefined) continue;

                const handle = manager.loadSkeleton(info.skeletonData, info.atlasJson, assetKey);
                if (handle < 0) continue;
                touched.add(assetKey);
                bindAtlasTexture(info, manager, handle);

                // An unspecified armature selects the file's first armature.
                const named = typeof data.armature === 'string' ? data.armature : '';
                const armature = named || manager.getArmatures(handle)[0];
                if (!armature) {
                    log.warn('runtime', `DragonBones file holds no armature: ${skeletonRef}`);
                    continue;
                }

                const props = dragonBonesEntityProps(data);
                const added = manager.addEntity(entity, handle, {
                    armature,
                    assetKey,
                    skeletonScale: props.skeletonScale,
                    flipX: props.flipX,
                    flipY: props.flipY,
                    layer: props.layer,
                });
                if (!added) continue;

                manager.setEntityProps(entity, props);

                const animation = typeof data.animation === 'string' ? data.animation : '';
                if (animation) {
                    const fade = typeof data.fadeInTime === 'number' ? data.fadeInTime : 0;
                    const loop = data.loop !== false;
                    // fadeInTime is what this component has instead of Spine's mix
                    // table, so an authored fade belongs to the FIRST play too.
                    if (fade > 0) manager.fadeIn(entity, animation, fade, loop);
                    else manager.play(entity, animation, loop);
                }
            }
        }
    } finally {
        for (const key of touched) manager.discardUnboundSkeleton(key);
        releaseUnusedAtlases(assetInfo.values());
    }
}

/**
 * Combined convenience: discover this scene's DragonBones pairs, load them, and
 * bind them to the spawned entities. What the editor's viewport calls.
 */
export async function loadDragonBonesSceneEntities(opts: {
    module: ESEngineModule | null;
    source: RuntimeAssetSource;
    manager: DragonBonesManager;
    sceneData: SceneData;
    entityMap: Map<number, Entity>;
    transcoderProvider?: TranscoderProvider;
    assets?: Pick<Assets, 'acquireTexture'>;
}): Promise<void> {
    const discovered = discoverSceneAssets(opts.sceneData);
    if (discovered.dragonBones.length === 0) return;
    const lifetime = opts.manager.bindingLifetime;
    const assetInfo = await loadDragonBonesAssets(
        opts.module, opts.source, discovered.dragonBones, opts.transcoderProvider, opts.assets);
    if (opts.manager.bindingLifetime !== lifetime) {
        releaseUnusedAtlases(assetInfo.values());
        return;
    }
    applyDragonBonesEntities({
        manager: opts.manager,
        sceneData: opts.sceneData,
        entityMap: opts.entityMap,
        assetInfo,
    });
}
