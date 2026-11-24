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

import { getComponent } from '../ecs/component';
import { spinePairKey } from './spinePairKey';
import type { SceneData, AssetFieldType } from '../scene/scene';

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
     * Refs seen during discovery that could not be resolved to a path
     * (e.g. unknown UUID). Callers surface this to the user so missing
     * assets don't silently turn into texture handle 0.
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

export function sceneAcquisitionPaths(refs: SceneAssetRefs, type: string): ReadonlySet<string> | undefined {
    return (usesAuthoredRef(type) ? refs.rawByType : refs.byType).get(type);
}

/** Entities that named each acquisition in this preparation. */
export class SceneAssetOwners {
    private readonly byType = new Map<string, Map<string, { entities: Set<number>; auxiliary?: Set<number> }>>();

    constructor(private readonly includeAliases = false) {}

    asset(type: string, raw: string, path: string, entity: number, auxiliary = false): void {
        const label = type === 'bitmap-font' ? 'font' : type;
        // A clip registers under each authored spelling. Handle-backed assets share a resolved path.
        const key = usesAuthoredRef(type) ? raw : path;
        this.add(label, key, entity, auxiliary);
        // Older structural providers could identify a receipt by either spelling.
        if (this.includeAliases && raw !== path) this.add(label, key === raw ? path : raw, entity, auxiliary);
    }

    add(type: string, path: string, entity: number, auxiliary = false): void {
        let paths = this.byType.get(type);
        if (!paths) this.byType.set(type, paths = new Map());
        let owners = paths.get(path);
        if (!owners) paths.set(path, owners = { entities: new Set() });
        owners.entities.add(entity);
        if (auxiliary) (owners.auxiliary ??= new Set()).add(entity);
    }

    get(type: string, path: string): ReadonlySet<number> | undefined {
        return this.byType.get(type)?.get(path)?.entities;
    }

    auxiliaryFor(type: string, path: string): ReadonlySet<number> | null {
        return this.byType.get(type)?.get(path)?.auxiliary ?? null;
    }
}

function assetIndex(refResolver?: RefResolver, owners?: SceneAssetOwners) {
    const refs: SceneAssetRefs = {
        byType: new Map(), rawByType: new Map(), rawFor: new Map(),
        spines: [], dragonBones: [], unresolved: [], meshTextures: new Set(), meshMaterials: new Set(),
    };
    const skeletalKeys = new Set<string>();
    const resolve = (raw: string): string | null => {
        const path = refResolver ? refResolver(raw) : raw;
        if (path) return path;
        refs.unresolved.push(raw);
        return null;
    };
    const bucket = (map: Map<string, Set<string>>, type: string, value: string): void => {
        let paths = map.get(type);
        if (!paths) map.set(type, paths = new Set());
        paths.add(value);
    };
    return {
        refs,
        asset(entity: number, type: string, raw: string, auxiliary = false) {
            const path = resolve(raw);
            if (path === null) return;
            bucket(refs.byType, type, path);
            bucket(refs.rawByType, type, raw);
            if (!refs.rawFor.has(path)) refs.rawFor.set(path, raw);
            owners?.asset(type, raw, path, entity, auxiliary);
        },
        mesh(raw: string, material: boolean) {
            const path = refResolver ? refResolver(raw) : raw;
            if (path) (material ? refs.meshMaterials : refs.meshTextures).add(path);
        },
        skeletal(entity: number, dragonBones: boolean, skelRef: string, atlasRef: string) {
            const skeleton = resolve(skelRef), atlas = resolve(atlasRef);
            if (skeleton === null || atlas === null) return;
            const key = spinePairKey(skeleton, atlas);
            if (!dragonBones) owners?.add('spine', key, entity, true);
            if (skeletalKeys.has(key)) return;
            skeletalKeys.add(key);
            (dragonBones ? refs.dragonBones : refs.spines).push({ skeleton, atlas });
        },
    };
}

/** Index the same component declarations for acquisition, optional authored bindings and entity ownership. */
export function indexSceneAssets(
    scene: SceneData, resolveRef?: RefResolver, owners?: SceneAssetOwners,
    onAuthored?: (refs: SceneAssetRefs) => void,
): SceneAssetRefs {
    const resolved = assetIndex(resolveRef, owners);
    const authored = onAuthored ? assetIndex() : undefined;
    const indexes = authored ? [resolved, authored] : [resolved];

    for (const entity of scene.entities) {
        // Prefab rows supply their components after expansion.
        if (entity.visible === false || !Array.isArray(entity.components)) continue;
        for (const component of entity.components) {
            const definition = getComponent(component.type);
            if (!definition) continue;
            const data = component.data as Record<string, unknown>;

            if (component.type === 'MeshRenderer') {
                for (const field of ['texture', 'normalMap', 'material'] as const) {
                    const raw = data[field];
                    if (typeof raw === 'string' && raw) {
                        for (const index of indexes) index.mesh(raw, field === 'material');
                    }
                }
            }

            if (definition.discoverAssets) {
                for (const { type, path } of definition.discoverAssets(data)) {
                    if (typeof path === 'string' && path) {
                        const auxiliary = !!owners && !definition.assetFields.some(f => f.type === type && data[f.field] === path);
                        for (const index of indexes) index.asset(entity.id, type, path, auxiliary);
                    }
                }
            } else {
                for (const { field, type } of definition.assetFields) {
                    const raw = data[field];
                    if (typeof raw === 'string' && raw) {
                        for (const index of indexes) index.asset(entity.id, type, raw);
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

export function discoverSceneAssets(sceneData: SceneData, refResolver?: RefResolver): SceneAssetRefs {
    return indexSceneAssets(sceneData, refResolver);
}

export function getAssetPathsByType(refs: SceneAssetRefs, type: AssetFieldType): Set<string> {
    return refs.byType.get(type) ?? new Set();
}
