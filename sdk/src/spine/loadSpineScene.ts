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
import { getComponentSkeletalFieldDescriptor, type SceneData } from '../scene/scene';
import { discoverSceneAssets } from '../asset/discoverAssets';
import { getAssetTypeEntry } from '../assetTypes';
import { log } from '../util/logger';
import { SpineManager, type SpineVersion } from './SpineManager';
import { prepareSpine, spinePairKey, type SpineAssetValue, type SpineIO } from './prepareSpine';
import { createAtlasPageTexture, type RuntimeAssetSource } from '../runtime/runtimeAssets';
import type { BasisTranscoder } from '../asset/compressed';

/**
 * The in-place editable spine props from a SpineAnimation component's data — the
 * SINGLE extraction both the scene loader and the editor's live-sync feed to
 * `setEntityProps`, so a new prop (color/timeScale/playing/...) is carried by both
 * paths from one place instead of being hand-listed twice.
 */
export function spineEntityProps(d: Record<string, unknown>): {
  skeletonScale: number; flipX: boolean; flipY: boolean; layer: number;
  timeScale: number; playing: boolean; color?: { r: number; g: number; b: number; a: number };
} {
  const num = (v: unknown, dflt: number) => (typeof v === 'number' ? v : dflt);
  const color = d.color;
  return {
    skeletonScale: num(d.skeletonScale, 1),
    flipX: d.flipX === true,
    flipY: d.flipY === true,
    layer: num(d.layer, 0),
    timeScale: num(d.timeScale, 1),
    playing: d.playing !== false,
    // Default to opaque white (spine's no-tint identity) rather than undefined, so
    // CLEARING the color field resets the native skeleton tint instead of leaving
    // the last-applied color stuck (setEntityProps only writes a defined color).
    color: color && typeof color === 'object' ? (color as { r: number; g: number; b: number; a: number }) : { r: 1, g: 1, b: 1, a: 1 },
  };
}

/** Lazily yields the realm's Basis transcoder (KTX2 atlas pages), or null where
 *  compressed textures can't occur (editor, uncooked dev). Same seam as the
 *  TextureLoader's transcoder provider. */
export type TranscoderProvider = () => Promise<BasisTranscoder | null>;

/** The opaque C++ registry handle SpineManager.loadEntity expects (app.world.getCppRegistry()). */
type CppRegistry = Parameters<SpineManager['loadEntity']>[4];

/** One prepared pair, plus the runtime version its skeleton document names. */
export type SpineAssetInfo = SpineAssetValue & { version: SpineVersion | null };

/**
 * Phase 1 — fetch + decode each spine pair's skeleton/atlas/textures and detect
 * its runtime version. Keyed by `skeletonRef:atlasRef` for {@link applySpineEntities}.
 */
export async function loadSpineAssets(
    /** The wasm engine module, or null on a core with no heap — the atlas page upload
     *  goes through the ResourceManager's byte path there. */
    module: ESEngineModule | null,
    source: RuntimeAssetSource,
    spineManager: SpineManager | null | undefined,
    spinePairs: ReadonlyArray<{ skeleton: string; atlas: string }>,
    transcoderProvider?: TranscoderProvider,
): Promise<Map<string, SpineAssetInfo>> {
    const assetInfoMap = new Map<string, SpineAssetInfo>();

    for (const pair of spinePairs) {
        try {
            const value = await prepareSpine(
                hostSpineIo(module, source, pair.atlas, transcoderProvider),
                pair.skeleton, pair.atlas,
            );
            const version = spineManager
                ? (typeof value.skelData === 'string'
                    ? SpineManager.detectVersionJson(value.skelData)
                    : SpineManager.detectVersion(value.skelData))
                : null;
            assetInfoMap.set(spinePairKey(pair.skeleton, pair.atlas), { ...value, version });
        } catch (err) {
            log.warn('runtime', `Failed to load spine asset: skel=${pair.skeleton} atlas=${pair.atlas}`, err);
        }
    }
    return assetInfoMap;
}

/**
 * A host's own file access as a spine transport — the editor, and any target
 * driving this loader without an asset layer. Same algorithm as the asset
 * layer's; what differs is where the bytes come from and that a page taken here
 * has no receipt, so the host's own teardown is what ends it.
 */
function hostSpineIo(
    module: ESEngineModule | null,
    source: RuntimeAssetSource,
    atlasRef: string,
    transcoderProvider?: TranscoderProvider,
): SpineIO {
    const resolveRef = source.resolveRef ?? ((r: string) => r);
    // Pages are named relative to the atlas's AUTHORED location, not its staged
    // one — a content-addressed build renamed the atlas to a hash under assets/,
    // so the staged path's directory is not where the pages were.
    const atlasLogical = source.resolveAddress?.(atlasRef) ?? resolveRef(atlasRef);
    const dir = atlasLogical.substring(0, atlasLogical.lastIndexOf('/'));
    return {
        text: (ref) => source.backend.fetchText(resolveRef(ref)),
        binary: (ref) => source.backend.fetchBinary(resolveRef(ref)),
        page: (path) => createAtlasPageTexture(
            resolveRef(path),
            (p) => source.backend.fetchBinary(p),
            (p) => source.decodePixels(p, false),
            transcoderProvider, module,
        ),
        // No dir ⇒ the page name IS the path (never a leading-slash "/page.png",
        // which resolves to nothing).
        pagePath: (name) => (dir ? `${dir}/${name}` : name),
        isBinary: (ref) => getAssetTypeEntry(resolveRef(ref))?.contentType === 'binary',
    };
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
        // Prefab instances carry no inline components; skip them (the async loader
        // expands prefabs before this runs).
        if (!Array.isArray(sceneEntity.components)) continue;
        for (const comp of sceneEntity.components) {
            const spineDesc = getComponentSkeletalFieldDescriptor(comp.type);
            // A skeletal pair is not automatically Spine's — DragonBones carries the
            // same two fields and is applied by its own loader. Without this the
            // DragonBones pair reaches detectVersion, which reports "no version"
            // and drops the entity silently rather than saying it was misrouted.
            if (!spineDesc || spineDesc.runtime === 'dragonbones' || !comp.data) continue;
            const skelRef = comp.data[spineDesc.skeletonField] as string;
            const atlasRef = comp.data[spineDesc.atlasField] as string;
            if (!skelRef || !atlasRef) continue;

            const info = assetInfo.get(spinePairKey(skelRef, atlasRef));
            if (!info || !info.version) continue;

            const entity = entityMap.get(sceneEntity.id);
            if (entity === undefined) continue;

            await spineManager.loadEntity(
                entity, info.skelData, info.atlasText, info.textures, registry,
                `${skelRef}:${atlasRef}`);

            spineManager.setEntityProps(entity, spineEntityProps(comp.data as Record<string, unknown>));
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
    module: ESEngineModule | null;
    source: RuntimeAssetSource;
    spineManager: SpineManager;
    sceneData: SceneData;
    entityMap: Map<number, Entity>;
    registry: CppRegistry;
    transcoderProvider?: TranscoderProvider;
}): Promise<void> {
    const discovered = discoverSceneAssets(opts.sceneData);
    if (discovered.spines.length === 0) return;
    const assetInfo = await loadSpineAssets(opts.module, opts.source, opts.spineManager, discovered.spines, opts.transcoderProvider);
    await applySpineEntities({
        spineManager: opts.spineManager,
        sceneData: opts.sceneData,
        entityMap: opts.entityMap,
        registry: opts.registry,
        assetInfo,
    });
}
