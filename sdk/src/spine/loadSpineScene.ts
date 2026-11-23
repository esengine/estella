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
import { prepareSpine, spineEraOf, spinePairKey,
         type SpineAssetValue, type SpineEraBinding, type SpineEraClaim, type SpineIO,
         type SpinePair } from './prepareSpine';
import type { RuntimeAssetSource } from '../runtime/runtimeAssets';
import { requireResourceManager } from '../wasm/resourceManager';
import { atlasPagePath, withAtlasPages } from '../runtime/atlasPages';
import type { BasisTranscoder } from '../asset/compressed';
import type { AssetsData } from '../asset/AssetPlugin';
import { AssetScope } from '../asset/AssetLease';
import { spineCertificatesFrom } from './spineCertificates';

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
type CppRegistry = Parameters<SpineManager['loadEntity']>[2];

/** One prepared pair: the era to bind entities to, the runtime version its
 *  skeleton document names, and — for a preparation nothing else owns — the
 *  claim this phase took, which the caller gives back once the eras are bound. */
export interface SpineAssetInfo {
    version: SpineVersion | null;
    era: SpineEraBinding;
    /** Null when an owner holds the preparation's claim (the scene's receipt). */
    preparation: SpineEraClaim | null;
}

/**
 * Phase 1 — fetch + decode each spine pair's skeleton/atlas/textures and detect
 * its runtime version. Keyed by `skeletonRef:atlasRef` for {@link applySpineEntities}.
 */
/**
 * Who prepares the pairs, and who owns what the preparation takes. With one,
 * two scenes of a spine asset share its era — one page upload, one native
 * skeleton — and the receipts are the scene's. Without one the same algorithm
 * runs over a host's own file access, and what it uploads is the host's.
 */
export interface SpineAssetOwner {
    assets: AssetsData;
    scope: AssetScope;
}

export async function loadSpineAssets(
    /** The wasm engine module, or null on a core with no heap — the atlas page upload
     *  goes through the ResourceManager's byte path there. */
    module: ESEngineModule | null,
    source: RuntimeAssetSource,
    spineManager: SpineManager | null | undefined,
    spinePairs: ReadonlyArray<{ skeleton: string; atlas: string }>,
    transcoderProvider?: TranscoderProvider,
    owner?: SpineAssetOwner,
): Promise<Map<string, SpineAssetInfo>> {
    if (owner) {
        const certificates = spineCertificatesFrom(source);
        return readSpinePairs(spinePairs, spineManager, async pair => {
            const lease = owner.scope.add(await owner.assets.acquireSpine(pair.skeleton, pair.atlas));
            const culling = certificates.envelopeFor(pair.skeleton, pair.atlas);
            return { era: spineEraOf(pair, lease, culling), preparation: null };
        });
    }
    return withAtlasPages(module, source, transcoderProvider, acquirePage =>
        readSpinePairs(spinePairs, spineManager, async pair => {
            const pages = new AssetScope();
            try {
                const io = hostSpineIo(source, pair.atlas, async path => pages.add(await acquirePage(path)).value);
                const value = await prepareSpine(io, pair.skeleton, pair.atlas);
                return hostEra(pair, value, pages);
            } catch (error) {
                pages.releaseAll();
                throw error;
            }
        }));
}

async function readSpinePairs(
    pairs: ReadonlyArray<SpinePair>, manager: SpineManager | null | undefined,
    prepare: (pair: SpinePair) => Promise<Pick<SpineAssetInfo, 'era' | 'preparation'>>,
): Promise<Map<string, SpineAssetInfo>> {
    const assets = new Map<string, SpineAssetInfo>();
    for (const pair of pairs) {
        const key = spinePairKey(pair.skeleton, pair.atlas);
        if (assets.has(key)) continue;
        let preparation: SpineEraClaim | null = null;
        try {
            const prepared = await prepare(pair);
            preparation = prepared.preparation;
            const { skelData } = prepared.era.value;
            const version = manager
                ? (typeof skelData === 'string'
                    ? SpineManager.detectVersionJson(skelData)
                    : SpineManager.detectVersion(skelData))
                : null;
            assets.set(key, { ...prepared, version });
        } catch (err) {
            preparation?.release();
            log.warn('runtime', `Failed to load spine asset: skel=${pair.skeleton} atlas=${pair.atlas}`, err);
        }
    }
    return assets;
}

/**
 * How many preparations this process has run. An id, not state: what it has to
 * be is distinct, so that entities of one preparation share a skeleton and
 * entities of two never do.
 */
let preparations = 0;

/**
 * An era prepared by a host with no asset layer: the same capability the realm's
 * lease provides, over the pages this preparation itself uploaded. The claim it
 * starts with is the preparation's own, given back once the eras are bound —
 * after which the runtimes posing it are the only holders.
 */
function hostEra(
    pair: SpinePair, value: SpineAssetValue, pages: AssetScope,
): { era: SpineEraBinding; preparation: SpineEraClaim } {
    let holders = 0;
    const claim = (): SpineEraClaim => {
        holders++;
        let live = true;
        return {
            release() {
                if (!live) return;
                live = false;
                if (--holders === 0) pages.releaseAll();
            },
        };
    };
    return {
        era: { id: `${spinePairKey(pair.skeleton, pair.atlas)}#${++preparations}`, pair, value,
            culling: { kind: 'unknown' }, retain: () => holders ? claim() : null },
        preparation: claim(),
    };
}

/** A standalone host supplies the documents and a receipt for each atlas page. */
function hostSpineIo(source: RuntimeAssetSource, atlas: string, page: SpineIO['page']): SpineIO {
    const resolveRef = source.resolveRef ?? ((ref: string) => ref);
    const logical = source.resolveAddress?.(atlas) ?? resolveRef(atlas);
    const rm = requireResourceManager();
    return {
        text: ref => source.backend.fetchText(resolveRef(ref)),
        binary: ref => source.backend.fetchBinary(resolveRef(ref)),
        page,
        renderId: handle => rm.getTextureGLId(handle),
        pagePath: name => atlasPagePath(logical, name),
        isBinary: ref => getAssetTypeEntry(resolveRef(ref))?.contentType === 'binary',
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

            await spineManager.loadEntity(entity, info.era, registry);

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
    try {
        await applySpineEntities({
            spineManager: opts.spineManager, sceneData: opts.sceneData,
            entityMap: opts.entityMap, registry: opts.registry, assetInfo,
        });
    } finally {
        for (const info of assetInfo.values()) info.preparation?.release();
    }
}
