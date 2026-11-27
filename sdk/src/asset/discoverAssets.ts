// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    discoverAssets.ts
 * @brief   Unified asset discovery from scene/prefab data.
 *
 * Each component may reference assets in three ways: a custom
 * `discoverAssets` callback, declared `assetFields`, or paired
 * `skeletalFields`. This module walks a SceneData and buckets every
 * such ref by asset type. A `discoverAssets` callback is authoritative:
 * when present, `assetFields` are not walked for discovery (they still
 * drive the editor's asset pickers and ref rewrites) — the callback may
 * deliberately exclude values, e.g. FSM/BT agents skip plain
 * code-registered names that only look like asset refs.
 *
 * Refs in serialized data may be either a concrete path
 * (`"assets/player.png"`, legacy) or a UUID reference
 * (`"@uuid:xxxxxxxx-..."`, produced by the meta-driven pipeline).
 * An optional `refResolver` callback translates a ref to its
 * current path before bucketing. Without a resolver the ref is
 * passed through unchanged — works for legacy scenes that still
 * store paths directly.
 */

import { getComponent, type FieldAssetDiscovery } from '../ecs/component';
import { probeRefs } from './AddressableManifest';
import { hasAssetFileExtension } from './documentRef';
import { assetPairKey } from './assetPairKey';
import type { SceneData, AssetFieldType } from '../scene/scene';
import { canonicalComponentType } from '../scene/legacyComponents';
import type { SurfaceUse } from './surfaceTextureUses';

export interface SpineAssetRef {
    skeleton: string;
    atlas: string;
}

/** A skeleton/atlas pair, whichever runtime poses it. */
export type SkeletalAssetRef = SpineAssetRef;

export interface SceneAssetRefs {
    byType: Map<string, Set<string>>;
    /**
     * The same buckets keyed by the RAW serialized ref (pre-resolution).
     * Loaders whose registry is keyed by what the COMPONENT carries (anim
     * clips: `SpriteAnimator.clip` / Animator states hold the serialized ref)
     * must be driven by the raw ref, so load-time aliasing can bind the raw
     * ref to the resolved registration — a realm whose resolver returns
     * absolute URLs would otherwise register under keys no component uses.
     */
    rawByType: Map<string, Set<string>>;
    /**
     * Resolved path → the RAW ref it came from (first spelling wins; several refs
     * can name one asset). Lets a caller that must bucket by resolved path — the
     * handle maps are keyed that way — still load through the authored ref, which
     * is the spelling per-asset lookups (texture import settings) are keyed by.
     */
    rawFor: Map<string, string>;
    /**
     * Skeleton/atlas pairs posed by SPINE. Split from {@link dragonBones} because
     * the two are loaded by different runtimes: a pair handed to the wrong one is
     * parsed by a parser that cannot read it, and fails as "unsupported version"
     * rather than as the routing mistake it is.
     */
    spines: SkeletalAssetRef[];
    /** Skeleton/atlas pairs posed by DragonBones. */
    dragonBones: SkeletalAssetRef[];
    /**
     * Distinct refs that could not be resolved to a path, in first-seen order.
     * Callers surface these so missing assets don't silently turn into texture handle 0.
     */
    unresolved: string[];
    /** Resolved paths of the textures a MeshRenderer draws directly (its texture and normal map): what texture streaming may start small. */
    meshTextures: Set<string>;
    /** Resolved paths of the materials a MeshRenderer draws with: their textures may start small too. */
    meshMaterials: Set<string>;
}

/** Turns a raw serialized ref into a concrete path (or null if unknown). */
export type RefResolver = (ref: string) => string | null;

// Animation and audio components play the authored clip reference they carry.
function usesAuthoredRef(type: string): boolean {
    return type === 'anim-clip' || type === 'audio';
}

/** Entities that named each acquisition in this preparation. */
export class SceneAssetOwners {
    private readonly byType = new Map<string, Map<string, { entities?: Set<number>; auxiliary?: Set<number> }>>();
    readonly surfaces = { texture: new Map<string, SurfaceUse>(), material: new Map<string, SurfaceUse>() };

    constructor(private readonly options: { entityOwnership: boolean | 'auxiliary'; includeAliases?: boolean }) {}

    asset(type: string, raw: string, path: string, entity: number, auxiliary = false, acquisitionPath?: string): void {
        const label = this.options.includeAliases && type === 'bitmap-font' ? 'font' : type;
        // A clip registers under each authored spelling. Handle-backed assets share a resolved path.
        const key = acquisitionPath ?? (usesAuthoredRef(type) ? raw : path);
        this.add(label, key, entity, auxiliary);
        // Older structural providers could identify a receipt by either spelling.
        if (this.options.includeAliases && raw !== path) this.add(label, key === raw ? path : raw, entity, auxiliary);
    }

    add(type: string, path: string, entity: number, auxiliary = false): void {
        const { entityOwnership } = this.options;
        if (entityOwnership !== true && !auxiliary) return;
        let paths = this.byType.get(type);
        if (!paths) this.byType.set(type, paths = new Map());
        let owners = paths.get(path);
        if (!owners) paths.set(path, owners = {});
        if (entityOwnership === true) (owners.entities ??= new Set()).add(entity);
        if (auxiliary && entityOwnership) (owners.auxiliary ??= new Set()).add(entity);
    }

    get(type: string, path: string): ReadonlySet<number> | undefined {
        const owners = this.byType.get(type)?.get(path);
        return owners?.entities ?? owners?.auxiliary;
    }

    auxiliaryFor(type: string, path: string): ReadonlySet<number> | null {
        return this.byType.get(type)?.get(path)?.auxiliary ?? null;
    }

    /** When entity IDs were not requested, only independently declared paths were recorded. */
    hasAuxiliary(type: string, path: string): boolean {
        const owners = this.byType.get(type)?.get(path);
        return !!owners && (!this.options.entityOwnership || !!owners.auxiliary);
    }
}

type AcquisitionPath = (type: string, raw: string, resolved: string) => string;

function assetIndex(refResolver?: RefResolver, owners?: SceneAssetOwners, acquireAs?: AcquisitionPath) {
    const refs: SceneAssetRefs = {
        byType: new Map(), rawByType: new Map(), rawFor: new Map(),
        spines: [], dragonBones: [], unresolved: [], meshTextures: new Set(), meshMaterials: new Set(),
    };
    const spineKeys = new Set<string>();
    const dragonBonesKeys = new Set<string>();
    let unresolved: Set<string> | undefined;
    const resolve = (raw: string): string | null => {
        const path = refResolver ? refResolver(raw) : raw;
        if (path) return path;
        unresolved ??= new Set();
        if (!unresolved.has(raw)) {
            unresolved.add(raw);
            refs.unresolved.push(raw);
        }
        return null;
    };
    const bucket = (map: Map<string, Set<string>>, type: string, value: string): void => {
        let paths = map.get(type);
        if (!paths) map.set(type, paths = new Set());
        paths.add(value);
    };
    return {
        refs,
        asset(entity: number, type: string, raw: string, auxiliary = false, measured?: boolean) {
            const path = resolve(raw);
            if (path === null) return;
            const key = acquireAs ? (usesAuthoredRef(type) ? raw : acquireAs(type, raw, path)) : undefined;
            bucket(refs.byType, type, key ?? path);
            bucket(refs.rawByType, type, raw);
            if (!refs.rawFor.has(path)) refs.rawFor.set(path, raw);
            owners?.asset(type, raw, path, entity, auxiliary, key);
            if (measured !== undefined && (type === 'texture' || type === 'material')) {
                if (measured) (type === 'material' ? refs.meshMaterials : refs.meshTextures).add(path);
                const uses = owners?.surfaces[type];
                if (uses && (!measured || !uses.has(path))) uses.set(path, measured ? 'mesh' : 'full');
            }
        },
        skeletal(entity: number, dragonBones: boolean, skelRef: string, atlasRef: string) {
            const skeleton = resolve(skelRef), atlas = resolve(atlasRef);
            if (skeleton === null || atlas === null) return;
            const key = assetPairKey(skeleton, atlas);
            if (!dragonBones) owners?.add('spine', key, entity, true);
            const keys = dragonBones ? dragonBonesKeys : spineKeys;
            if (keys.has(key)) return;
            keys.add(key);
            (dragonBones ? refs.dragonBones : refs.spines).push({ skeleton, atlas });
        },
    };
}

/** Index the same component declarations for acquisition, optional authored bindings and entity ownership. */
export function indexSceneAssets(
    scene: SceneData, resolveRef?: RefResolver, {
        owners, onAuthored, acquireAs, knownFile,
    }: {
        owners?: SceneAssetOwners; onAuthored?: (refs: SceneAssetRefs) => void;
        acquireAs?: AcquisitionPath; knownFile?: (ref: string, type: string) => boolean;
    } = {},
): SceneAssetRefs {
    const resolved = assetIndex(resolveRef, owners, acquireAs);
    const authored = onAuthored ? assetIndex() : undefined;
    const indexes = authored ? [resolved, authored] : [resolved];
    const indexed = (ref: string, type: string, extension: string): boolean => {
        if (knownFile?.(ref, type)) return true;
        // A host may expose a file through a short address without shipping a catalog.
        const target = resolveRef && probeRefs(() => resolveRef(ref));
        return !!target && target !== ref && hasAssetFileExtension(target, extension);
    };

    for (const entity of scene.entities) {
        // Prefab rows supply their components after expansion.
        if (entity.visible === false || !Array.isArray(entity.components)) continue;
        for (const component of entity.components) {
            const definition = getComponent(canonicalComponentType(component.type));
            if (!definition) continue;
            const data = component.data as Record<string, unknown>;

            const discover: FieldAssetDiscovery | undefined = definition.discoverAssets;
            if (discover) {
                const fields = [...definition.assetFields];
                for (const { type, path } of discover.call(definition, data, indexed)) {
                    if (typeof path !== 'string' || !path) continue;
                    // Each scalar field accounts for one declaration. A list may also name the same file.
                    const field = fields.findIndex(f => f.type === type && data[f.field] === path);
                    const declaration = field >= 0 ? fields.splice(field, 1)[0] : undefined;
                    for (const index of indexes) index.asset(entity.id, type, path, !declaration, declaration && !!declaration.measuresTextureDensity);
                }
            } else {
                for (const { field, type, measuresTextureDensity } of definition.assetFields) {
                    const raw = data[field];
                    if (typeof raw === 'string' && raw) {
                        for (const index of indexes) index.asset(entity.id, type, raw, false, !!measuresTextureDensity);
                    }
                }
            }

            const fields = definition.skeletalFields;
            if (fields) {
                const skeleton = data[fields.skeletonField] as string;
                const atlas = data[fields.atlasField] as string;
                if (skeleton && atlas) {
                    for (const index of indexes) index.skeletal(entity.id, fields.runtime === 'dragonbones', skeleton, atlas);
                }
            }
        }
    }
    if (authored) onAuthored?.(authored.refs);
    return resolved.refs;
}

export function discoverSceneAssets(sceneData: SceneData, refResolver?: RefResolver, knownFile?: (ref: string, type: string) => boolean): SceneAssetRefs {
    return indexSceneAssets(sceneData, refResolver, { knownFile });
}

export function getAssetPathsByType(refs: SceneAssetRefs, type: AssetFieldType): Set<string> {
    return refs.byType.get(type) ?? new Set();
}
