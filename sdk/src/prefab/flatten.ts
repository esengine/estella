// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { DEFERRED_KEY, canDefer, cutToRoot, deferredBindings, isDeferredInstance, rootOnly, rootOverrides } from './deferred';
import type {
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
    ProcessedEntity,
    FlattenContext,
    FlattenResult,
} from './types';
import { PREFAB_ADDRESS_SEP } from './types';
import { cloneComponents, cloneMetadata } from './clone';
import { mapOverrideRefs, prefabRef, remapComponentEntityRefs } from './entityRef';
import { applyOverrides, bucketOverridesByEntity } from './override';
import { createChildLookup, checkParentCycle } from '../document/diagnostics';
import { INVALID_ENTITY } from '../types';

const MAX_PREFAB_NESTING_DEPTH = 10;

/** Prefix a nested entity's stable id with the slot it was mounted through. */
function joinAddress(slotId: PrefabEntityId, localId: PrefabEntityId): PrefabEntityId {
    return `${slotId}${PREFAB_ADDRESS_SEP}${localId}`;
}

export function flattenPrefab(
    prefab: PrefabData,
    overrides: PrefabOverride[],
    ctx: FlattenContext,
): FlattenResult {
    const plan = preparePrefabBindings(prefab, overrides, ctx);
    plan.applyEdits(plan.entities);
    return { entities: plan.entities, rootId: plan.rootId, unresolved: plan.unresolved };
}

interface ReferenceScope {
    ids: ReadonlyMap<PrefabEntityId, number>;
    prefix: string;
    /** A scene delta stores external references as numbers. */
    scene?: boolean;
}

interface PendingEdits {
    id: number;
    patches: PrefabOverride[];
    local: ReferenceScope;
    origins: ReadonlyMap<PrefabOverride, ReferenceScope>;
}

interface AssemblyContext extends FlattenContext {
    pending: PendingEdits[];
    origins: ReadonlyMap<PrefabOverride, ReferenceScope>;
    prefix: string;
    finishDeferred: Array<() => void>;
}

interface AssembledPrefab extends FlattenResult {
    addresses: Map<PrefabEntityId, number>;
}

/** Scene deltas finish this same assembly after reserving ids for their added members. */
export function preparePrefabBindings(prefab: PrefabData, overrides: PrefabOverride[], ctx: FlattenContext,
    sceneIds?: Map<PrefabEntityId, number>) {
    const pending: PendingEdits[] = [];
    const finishDeferred: Array<() => void> = [];
    const origins = new Map<PrefabOverride, ReferenceScope>();
    if (sceneIds) {
        const scene = { ids: sceneIds, prefix: '', scene: true };
        for (const patch of overrides) origins.set(patch, scene);
    }
    const result = assemblePrefab(prefab, overrides, { ...ctx, prefix: '', pending, origins, finishDeferred });
    if (sceneIds) {
        for (const [address, id] of result.addresses) sceneIds.set(address, id);
    }
    function applyEdits(entities: readonly ProcessedEntity[]): void {
        for (const finish of finishDeferred) finish();
        if (pending.length === 0) return;
        const byId = new Map(entities.map(e => [e.id, e]));
        for (const edits of pending) {
            const target = byId.get(edits.id);
            if (!target) continue;
            const patches = edits.patches.map(patch => {
                const owner = edits.origins.get(patch) ?? edits.local;
                const mapped = mapOverrideRefs(patch, value => {
                    if (typeof value === 'string') {
                        // Older hand-authored nested edits can name a child in its local scope.
                        return owner.ids.get(value) ?? edits.local.ids.get(value) ?? INVALID_ENTITY;
                    }
                    return owner.scene ? value : prefabRef(value, owner.ids);
                });
                return { ...mapped, prefabEntityId: target.prefabEntityId };
            });
            applyOverrides(target, patches);
        }
    }
    return { ...result, applyEdits };
}

function assemblePrefab(prefab: PrefabData, overrides: PrefabOverride[], ctx: AssemblyContext): AssembledPrefab {
    const depth = ctx.depth ?? 0;
    if (depth > MAX_PREFAB_NESTING_DEPTH) {
        throw new Error(
            `Prefab nesting depth exceeded ${MAX_PREFAB_NESTING_DEPTH}. ` +
            `Check for deep or circular nesting in: ${prefab.name}`,
        );
    }

    if (prefab.basePrefab) {
        return flattenVariant(prefab, overrides, ctx, depth);
    }

    validateParentChildConsistency(prefab);

    const visited = ctx.visited ?? new Set<string>();
    // Stable identity → runtime entity id allocated by ctx.
    const idMapping = new Map<PrefabEntityId, number>();
    const local: ReferenceScope = { ids: idMapping, prefix: ctx.prefix };

    for (const pe of prefab.entities) {
        if (!pe.nestedPrefab) {
            const reserved = pe.prefabEntityId === prefab.rootEntityId ? ctx.rootId : undefined;
            idMapping.set(pe.prefabEntityId, reserved ?? ctx.allocateId());
        }
    }

    const result: ProcessedEntity[] = [];
    const overrideBuckets = bucketOverridesByEntity(overrides);
    const unresolved: PrefabOverride[] = [];
    const slotPrefixes: string[] = [];

    for (const pe of prefab.entities) {
        if (pe.nestedPrefab) {
            const nestedPath = pe.nestedPrefab.prefabPath;

            if (visited.has(nestedPath)) {
                throw new Error(
                    `[Prefab] Circular reference detected: "${nestedPath}" ` +
                    `is already being instantiated in the current prefab chain`,
                );
            }

            const nestedPrefab = ctx.loadPrefab(nestedPath);
            if (!nestedPrefab) {
                throw new Error(
                    `Failed to load nested prefab: ${nestedPath}`,
                );
            }

            // Route overrides that address entities INSIDE this slot down into the
            // nested flatten. Instance deltas target nested entities by their
            // composed address (`slot/localId`); strip the slot prefix so they
            // apply in the nested prefab's own id space, and layer them after the
            // slot's authored overrides. This is what makes an instance override
            // on a nested entity survive the collapse→expand round trip.
            const slotPrefix = pe.prefabEntityId + PREFAB_ADDRESS_SEP;
            const prefix = ctx.prefix + slotPrefix;
            slotPrefixes.push(slotPrefix);
            const origins = new Map<PrefabOverride, ReferenceScope>();
            const routed: PrefabOverride[] = [];
            for (const patch of overrides) {
                if (!patch.prefabEntityId.startsWith(slotPrefix)) continue;
                const childPatch = { ...patch, prefabEntityId: patch.prefabEntityId.slice(slotPrefix.length) };
                origins.set(childPatch, ctx.origins.get(patch) ?? local);
                routed.push(childPatch);
            }
            const nestedOverrides = routed.length
                ? [...pe.nestedPrefab.overrides, ...routed]
                : pe.nestedPrefab.overrides;

            // DFS ancestor stack: a path counts as "visited" only while it is an
            // ancestor of the entity being flattened, so a genuine cycle still
            // throws but the SAME prefab may be mounted in several sibling slots
            // (e.g. four turrets on one ship). Pop once the branch returns.
            visited.add(nestedPath);
            // A virtual mounting (marked on the slot, on the nested prefab's root, or by an override) is made as its root alone; what
            // it would be made from is recorded for whoever opens it. A prefab that cannot be cut to its root is flattened whole and
            // cut afterwards.
            const virtual = ctx.deferred !== undefined && canDefer(nestedOverrides, nestedPrefab)
                && (pe.metadata?.[DEFERRED_KEY] === true || isDeferredInstance(nestedPrefab, nestedOverrides));
            const stub = virtual ? rootOnly(nestedPrefab) : null;
            const nested = assemblePrefab(
                stub ?? nestedPrefab,
                stub ? rootOverrides(nestedPrefab, nestedOverrides) : nestedOverrides,
                {
                    ...ctx, origins, prefix, visited, depth: depth + 1,
                    rootId: pe.prefabEntityId === prefab.rootEntityId ? ctx.rootId : undefined,
                    deferred: virtual ? undefined : ctx.deferred,
                },
            );
            visited.delete(nestedPath);
            if (virtual && ctx.deferred) {
                if (!stub) nested.entities = cutToRoot(nested.entities, nested.rootId);
                nested.unresolved = [];
                const records = ctx.deferred;
                const rootAddress = nested.entities.find(e => e.id === nested.rootId)!.prefabEntityId;
                // The enclosing scene may still be allocating a sibling or an added member.
                ctx.finishDeferred.push(() => records.push({ id: nested.rootId, prefab: nestedPath,
                    ...slotBindings(nestedOverrides, origins, prefix, rootAddress, nestedPrefab, nested.addresses) }));
            }

            // Namespace the nested subtree's stable ids by this slot so two
            // instantiations of the same prefab — or two prefabs reusing the same
            // local ids — never collide in the flattened set. Runtime `id`,
            // component data, and entity refs are untouched; only the identity
            // string used for diff/override/tag addressing is composed.
            for (const ne of nested.entities) {
                ne.prefabEntityId = joinAddress(pe.prefabEntityId, ne.prefabEntityId);
            }
            for (const [address, id] of nested.addresses) {
                if (!virtual || id === nested.rootId) idMapping.set(joinAddress(pe.prefabEntityId, address), id);
            }
            for (const o of nested.unresolved) {
                unresolved.push({ ...o, prefabEntityId: joinAddress(pe.prefabEntityId, o.prefabEntityId) });
            }

            idMapping.set(pe.prefabEntityId, nested.rootId);

            result.push(...nested.entities);
            continue;
        }

        const id = idMapping.get(pe.prefabEntityId)!;

        const entity: ProcessedEntity = {
            id,
            prefabEntityId: pe.prefabEntityId,
            name: pe.name,
            // Resolve hierarchy and component references once all slots have ids.
            parent: null,
            children: [],
            components: cloneComponents(pe.components),
            visible: pe.visible,
            ...(pe.metadata ? { metadata: cloneMetadata(pe.metadata) } : {}),
        };

        const patches = overrideBuckets.get(pe.prefabEntityId);
        if (patches) ctx.pending.push({ id, patches, local, origins: ctx.origins });
        result.push(entity);
    }

    for (const o of overrides) {
        if (idMapping.has(o.prefabEntityId)) continue;
        if (slotPrefixes.some((p) => o.prefabEntityId.startsWith(p))) continue;
        unresolved.push(o);
    }

    const rootId = idMapping.get(prefab.rootEntityId);
    if (rootId === undefined) {
        throw new Error(
            `Failed to resolve prefab root entity "${prefab.rootEntityId}" in "${prefab.name}"`,
        );
    }

    // Resolve authored links only after nested slots have ids. Preserve the
    // children order the author serialized, including slots that were flattened
    // later; entity-array order is not sibling order.
    const byRuntimeId = new Map(result.map((e) => [e.id, e]));
    for (const pe of prefab.entities) {
        const childId = idMapping.get(pe.prefabEntityId);
        if (childId === undefined) continue;
        const entity = byRuntimeId.get(childId);
        if (!entity) continue;
        entity.parent = pe.prefabEntityId === prefab.rootEntityId ? null
            : (pe.parent !== null ? idMapping.get(pe.parent) ?? null : null);
        const authored = pe.children.map(c => idMapping.get(c)).filter((c): c is number => c !== undefined);
        if (!pe.nestedPrefab) {
            // A field can name a later slot or one of its descendants. Mounted
            // components have already resolved their own local references.
            remapComponentEntityRefs(entity.components, idMapping);
            entity.children = authored;
        } else if (authored.length) {
            // A mounted root keeps its own subtree, then children authored on
            // the mounting slot. They share the same final parent.
            const present = new Set(entity.children);
            for (const id of authored) if (!present.has(id)) { present.add(id); entity.children.push(id); }
        }
    }

    return { entities: result, rootId, unresolved, addresses: idMapping };
}

/** A virtual slot reopens as its own prefab. Keep its local addresses and capture any enclosing targets by source id. */
function slotBindings(overrides: PrefabOverride[], origins: ReadonlyMap<PrefabOverride, ReferenceScope>, prefix: string,
    root: PrefabEntityId, prefab: PrefabData, addresses: ReadonlyMap<PrefabEntityId, number>) {
    let authoredIds: Set<PrefabEntityId> | undefined;
    return deferredBindings(overrides, (patch, value) => {
        const owner = origins.get(patch);
        if (!owner) {
            // Legacy asset overrides can name numeric locals, including descendants absent from a root-only stub.
            if (typeof value !== 'number' || value <= 0) return value;
            const key = String(value);
            authoredIds ??= new Set(prefab.entities.map(e => e.prefabEntityId));
            return addresses.has(key) || authoredIds.has(key) ? key : value;
        }
        const ref = typeof value === 'number' && value > 0 && !owner.scene && owner.ids.has(String(value)) ? String(value) : value;
        if (typeof ref !== 'string') return ref;
        const address = owner.prefix + ref;
        if (address + PREFAB_ADDRESS_SEP === prefix) return root;
        if (address.startsWith(prefix)) return address.slice(prefix.length);
        return owner.ids.get(ref) ?? ref;
    });
}

/**
 * Variants merge their own `entities` list onto the base before applying
 * overrides. An entry whose `prefabEntityId` matches an entry in the base
 * **replaces** that entry's authored data; an entry whose id is new gets
 * **appended** as an additional child of the base. The variant's root
 * identity must equal the base's root — variants extend, they do not
 * relocate the root.
 */
function flattenVariant(
    variant: PrefabData,
    instanceOverrides: PrefabOverride[],
    ctx: AssemblyContext,
    depth: number,
): AssembledPrefab {
    const basePath = variant.basePrefab!;
    const visited = ctx.visited ?? new Set<string>();

    if (visited.has(basePath)) {
        throw new Error(
            `[Prefab] Circular variant reference detected: "${basePath}" ` +
            `is already being instantiated in the current prefab chain`,
        );
    }

    const basePrefab = ctx.loadPrefab(basePath);
    if (!basePrefab) {
        throw new Error(`Failed to load base prefab for variant: ${basePath}`);
    }

    visited.add(basePath);

    // If the base is itself a variant, resolve its chain first so we merge
    // against a flat prefab. This preserves the pre-UUID behaviour where
    // the recursive flattenPrefab call transparently handled nested variants.
    const resolvedBase = basePrefab.basePrefab
        ? resolveVariantChain(basePrefab, ctx, depth + 1, visited)
        : basePrefab;

    const merged = mergeVariantEntities(resolvedBase, variant);

    const variantOverrides = merged.overrides ?? [];
    const combinedOverrides = [...variantOverrides, ...instanceOverrides];

    const result = assemblePrefab(
        merged,
        combinedOverrides,
        { ...ctx, visited, depth: depth + 1 },
    );
    visited.delete(basePath); // pop the ancestor stack (see nested branch)
    return result;
}

function resolveVariantChain(
    variant: PrefabData,
    ctx: FlattenContext,
    depth: number,
    visited: Set<string>,
): PrefabData {
    if (depth > MAX_PREFAB_NESTING_DEPTH) {
        throw new Error(
            `Prefab variant chain exceeded depth ${MAX_PREFAB_NESTING_DEPTH}; ` +
            `suspected circular inheritance ending at "${variant.name}"`,
        );
    }
    const basePath = variant.basePrefab;
    if (!basePath) return variant;
    if (visited.has(basePath)) {
        throw new Error(
            `[Prefab] Circular variant reference detected: "${basePath}" ` +
            `is already being instantiated in the current prefab chain`,
        );
    }
    const base = ctx.loadPrefab(basePath);
    if (!base) {
        throw new Error(`Failed to load base prefab for variant: ${basePath}`);
    }
    visited.add(basePath);
    const resolvedBase = base.basePrefab
        ? resolveVariantChain(base, ctx, depth + 1, visited)
        : base;
    const merged = mergeVariantEntities(resolvedBase, variant);
    visited.delete(basePath); // pop after the chain is merged (DFS stack)
    return merged;
}

function mergeVariantEntities(base: PrefabData, variant: PrefabData): PrefabData {
    if (variant.rootEntityId !== base.rootEntityId) {
        throw new Error(
            `Variant "${variant.name}" rootEntityId "${variant.rootEntityId}" ` +
            `must match base "${base.name}" rootEntityId "${base.rootEntityId}". ` +
            `Variants extend the base; they do not relocate the root.`,
        );
    }

    const merged: PrefabEntityData[] = base.entities.map(e => ({ ...e }));
    const mergedById = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of merged) mergedById.set(e.prefabEntityId, e);

    const mergedIndex = new Map(merged.map((e, i) => [e.prefabEntityId, i]));
    const variantEntities = variant.entities ?? [];
    for (const ve of variantEntities) {
        const existing = mergedById.get(ve.prefabEntityId);
        if (existing) {
            // Variant entry replaces base authored data wholesale (matching
            // editing inside the variant, which becomes the
            // new authored state for that entity within this variant).
            const replaced: PrefabEntityData = {
                ...ve,
                children: [...ve.children],
                components: ve.components.map(c => ({
                    type: c.type,
                    data: { ...c.data },
                })),
                ...(ve.metadata ? { metadata: { ...ve.metadata } } : {}),
            };
            const idx = mergedIndex.get(ve.prefabEntityId)!;
            merged[idx] = replaced;
            mergedById.set(ve.prefabEntityId, replaced);
            continue;
        }

        // New entity. Validate its parent points somewhere reachable.
        if (ve.parent === null) {
            throw new Error(
                `Variant "${variant.name}" entity "${ve.prefabEntityId}" has ` +
                `parent=null but is not the root. Variant additions must attach ` +
                `to an existing entity from the base or another variant addition.`,
            );
        }
        const added: PrefabEntityData = {
            ...ve,
            children: [...ve.children],
            components: ve.components.map(c => ({
                type: c.type,
                data: { ...c.data },
            })),
            ...(ve.metadata ? { metadata: { ...ve.metadata } } : {}),
        };
        mergedIndex.set(ve.prefabEntityId, merged.length);
        merged.push(added);
        mergedById.set(ve.prefabEntityId, added);
    }

    // Pass 2: link added entities into their parents' children lists,
    // and validate referential integrity.
    const baseIds = new Set(base.entities.map(e => e.prefabEntityId));
    const extendedChildren = new Map<PrefabEntityId, Set<PrefabEntityId>>();
    for (const ve of variantEntities) {
        const isNew = !baseIds.has(ve.prefabEntityId);
        if (!isNew) continue;
        const parent = mergedById.get(ve.parent!);
        if (!parent) {
            throw new Error(
                `Variant "${variant.name}" entity "${ve.prefabEntityId}" parent ` +
                `"${ve.parent!}" not found in base or other variant additions.`,
            );
        }
        let children = extendedChildren.get(parent.prefabEntityId);
        if (!children) {
            children = new Set(parent.children);
            parent.children = [...parent.children]; // one owned copy, never mutate the base
            extendedChildren.set(parent.prefabEntityId, children);
        }
        if (!children.has(ve.prefabEntityId)) {
            children.add(ve.prefabEntityId);
            parent.children.push(ve.prefabEntityId);
        }
    }

    // Validate no cycles among the merged set before flatten downstream.
    detectCycle(merged, variant.name);

    return {
        version: base.version,
        name: variant.name,
        rootEntityId: base.rootEntityId,
        entities: merged,
        overrides: [...(base.overrides ?? []), ...(variant.overrides ?? [])],
        // basePrefab intentionally dropped; the merged result is no longer a
        // variant for downstream flatten purposes.
    };
}

function validateParentChildConsistency(prefab: PrefabData): void {
    const byId = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of prefab.entities) byId.set(e.prefabEntityId, e);
    const hasChild = createChildLookup<PrefabEntityId>();

    for (const e of prefab.entities) {
        // The address separator is reserved so flatten can compose `slot/localId`
        // paths unambiguously — an authored id must never contain it.
        if (e.prefabEntityId.includes(PREFAB_ADDRESS_SEP)) {
            throw new Error(
                `Prefab "${prefab.name}" entity id "${e.prefabEntityId}" contains the ` +
                `reserved separator "${PREFAB_ADDRESS_SEP}". Authored prefab entity ids ` +
                `must not contain it.`,
            );
        }
        if (e.parent !== null) {
            const parent = byId.get(e.parent);
            if (!parent) {
                throw new Error(
                    `Prefab "${prefab.name}" entity "${e.prefabEntityId}" parent ` +
                    `"${e.parent}" does not exist.`,
                );
            }
            if (!hasChild(parent.children, e.prefabEntityId)) {
                throw new Error(
                    `Prefab "${prefab.name}" inconsistent topology: entity ` +
                    `"${e.prefabEntityId}" claims parent "${e.parent}" but the ` +
                    `parent's children list does not contain it. children is ` +
                    `the source of truth — fix by adding the child id there.`,
                );
            }
        }
        for (const childId of e.children) {
            const child = byId.get(childId);
            if (!child) {
                throw new Error(
                    `Prefab "${prefab.name}" entity "${e.prefabEntityId}" lists ` +
                    `child "${childId}" which does not exist.`,
                );
            }
            if (child.parent !== e.prefabEntityId) {
                throw new Error(
                    `Prefab "${prefab.name}" inconsistent topology: entity ` +
                    `"${e.prefabEntityId}" lists "${childId}" as a child but ` +
                    `the child's parent points elsewhere ("${child.parent ?? 'null'}").`,
                );
            }
        }
    }
}

function detectCycle(entities: PrefabEntityData[], prefabName: string): void {
    const nodes = entities.map(e => ({ id: e.prefabEntityId, parent: e.parent,
        children: e.children, components: e.components }));
    checkParentCycle(nodes, new Map(nodes.map(e => [e.id, e])), (_code, _severity, message) => {
        throw new Error(`Prefab "${prefabName}" ${message}`);
    });
}
