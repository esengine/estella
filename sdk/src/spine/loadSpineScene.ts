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
import { getComponentSkeletalFieldDescriptor, type SceneData } from '../scene';
import { discoverSceneAssets } from '../asset/discoverAssets';
import { getAssetTypeEntry } from '../assetTypes';
import { requireResourceManager } from '../resourceManager';
import { log } from '../logger';
import { SpineManager, type SpineVersion } from './SpineManager';
import { parseSpineAtlasPages } from './atlasPages';
import { createTextureFromPixels, type RuntimeAssetSource } from '../runtimeAssets';
import { isKtx2Path, type BasisTranscoder } from '../asset/compressed';

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

export interface SpineAssetInfo {
    version: SpineVersion | null;
    skelData: Uint8Array | string;
    atlasText: string;
    textures: Map<string, { glId: number; w: number; h: number }>;
}

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

            const texNames = parseSpineAtlasPages(atlasContent);
            // Pages are named relative to the atlas's AUTHORED location, not its
            // staged one — a content-addressed build renamed the atlas to a hash
            // under assets/, so `atlasPath`'s directory is not where the pages were.
            // Recover the authored directory from the atlas's logical address, so
            // `<dir>/page.png` resolves through the manifest like every other ref.
            const atlasLogical = source.resolveAddress?.(atlasRef) ?? atlasPath;
            const atlasDir = atlasLogical.substring(0, atlasLogical.lastIndexOf('/'));
            const rm = requireResourceManager();
            const textures = new Map<string, { glId: number; w: number; h: number }>();

            for (const texName of texNames) {
                // No dir ⇒ the page name IS the path (never a leading-slash
                // "/page.png", which resolves to nothing) — matches SpineAssetLoader.
                const texPath = atlasDir ? atlasDir + '/' + texName : texName;
                try {
                    // The atlas names its pages by AUTHORED filename; a cook may
                    // have re-encoded (.ktx2) or content-addressed the staged
                    // file, so the derived logical path resolves through the
                    // manifest/catalog like every other fetch.
                    const staged = resolveRef(texPath);
                    let result: { width: number; height: number; pixels: Uint8Array };
                    if (isKtx2Path(staged)) {
                        const transcoder = await transcoderProvider?.();
                        if (!transcoder) throw new Error('KTX2 atlas page but no Basis transcoder in this realm');
                        const rgba = transcoder.transcodeToRgba(new Uint8Array(await source.backend.fetchBinary(staged)));
                        if (!rgba) throw new Error(`KTX2 transcode failed: ${staged}`);
                        result = { width: rgba.width, height: rgba.height, pixels: rgba.data };
                    } else {
                        result = await source.decodePixels(staged, false);
                    }
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

            const info = assetInfo.get(`${skelRef}:${atlasRef}`);
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
