// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import { remapComponentEntityRefs } from './entityRef';
import { applyOverrides, bucketOverridesByEntity } from './override';

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

    for (const pe of prefab.entities) {
        if (!pe.nestedPrefab) {
            idMapping.set(pe.prefabEntityId, ctx.allocateId());
        }
    }

    const result: ProcessedEntity[] = [];
    const overrideBuckets = bucketOverridesByEntity(overrides);

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
            const routed = overrides
                .filter(o => o.prefabEntityId.startsWith(slotPrefix))
                .map(o => ({ ...o, prefabEntityId: o.prefabEntityId.slice(slotPrefix.length) }));
            const nestedOverrides = routed.length
                ? [...pe.nestedPrefab.overrides, ...routed]
                : pe.nestedPrefab.overrides;

            // DFS ancestor stack: a path counts as "visited" only while it is an
            // ancestor of the entity being flattened, so a genuine cycle still
            // throws but the SAME prefab may be mounted in several sibling slots
            // (e.g. four turrets on one ship). Pop once the branch returns.
            visited.add(nestedPath);
            const nested = flattenPrefab(
                nestedPrefab,
                nestedOverrides,
                { ...ctx, visited, depth: depth + 1 },
            );
            visited.delete(nestedPath);

            // Namespace the nested subtree's stable ids by this slot so two
            // instantiations of the same prefab — or two prefabs reusing the same
            // local ids — never collide in the flattened set. Runtime `id`,
            // component data, and entity refs are untouched; only the identity
            // string used for diff/override/tag addressing is composed.
            for (const ne of nested.entities) {
                ne.prefabEntityId = joinAddress(pe.prefabEntityId, ne.prefabEntityId);
            }

            idMapping.set(pe.prefabEntityId, nested.rootId);

            const nestedRoot = nested.entities.find(e => e.id === nested.rootId);
            if (nestedRoot) {
                nestedRoot.parent = pe.parent !== null
                    ? idMapping.get(pe.parent) ?? null
                    : null;
            }

            result.push(...nested.entities);
            continue;
        }

        const id = idMapping.get(pe.prefabEntityId)!;
        const isRoot = pe.prefabEntityId === prefab.rootEntityId;

        const entity: ProcessedEntity = {
            id,
            prefabEntityId: pe.prefabEntityId,
            name: pe.name,
            parent: isRoot
                ? null
                : (pe.parent !== null ? idMapping.get(pe.parent) ?? null : null),
            children: pe.children
                .map(c => idMapping.get(c))
                .filter((c): c is number => c !== undefined),
            components: cloneComponents(pe.components),
            visible: pe.visible,
            ...(pe.metadata ? { metadata: cloneMetadata(pe.metadata) } : {}),
        };

        // Apply overrides BEFORE remapping so newly added/replaced
        // components — and property overrides that target an
        // entityField — get their prefab-entity-id values remapped
        // to the allocated entity ids in the same pass.
        applyOverrides(entity, overrideBuckets.get(pe.prefabEntityId));
        remapComponentEntityRefs(entity.components, idMapping);
        result.push(entity);
    }

    const rootId = idMapping.get(prefab.rootEntityId);
    if (rootId === undefined) {
        throw new Error(
            `Failed to resolve prefab root entity "${prefab.rootEntityId}" in "${prefab.name}"`,
        );
    }

    return { entities: result, rootId };
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
    ctx: FlattenContext,
    depth: number,
): FlattenResult {
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

    const variantOverrides = variant.overrides ?? [];
    const combinedOverrides = [...variantOverrides, ...instanceOverrides];

    const result = flattenPrefab(
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

    const baseById = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of base.entities) baseById.set(e.prefabEntityId, e);

    const merged: PrefabEntityData[] = base.entities.map(e => ({ ...e }));
    const mergedById = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of merged) mergedById.set(e.prefabEntityId, e);

    const variantEntities = variant.entities ?? [];
    for (const ve of variantEntities) {
        const existing = mergedById.get(ve.prefabEntityId);
        if (existing) {
            // Variant entry replaces base authored data wholesale (matching
            // Unity behaviour where editing inside the variant becomes the
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
            const idx = merged.indexOf(existing);
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
        merged.push(added);
        mergedById.set(ve.prefabEntityId, added);
    }

    // Pass 2: link added entities into their parents' children lists,
    // and validate referential integrity.
    const baseIds = new Set(base.entities.map(e => e.prefabEntityId));
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
        if (!parent.children.includes(ve.prefabEntityId)) {
            parent.children = [...parent.children, ve.prefabEntityId];
        }
    }

    // Validate no cycles among the merged set before flatten downstream.
    detectCycle(merged, variant.name);

    return {
        version: base.version,
        name: variant.name,
        rootEntityId: base.rootEntityId,
        entities: merged,
        // basePrefab intentionally dropped; the merged result is no longer a
        // variant for downstream flatten purposes.
    };
}

function validateParentChildConsistency(prefab: PrefabData): void {
    const byId = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of prefab.entities) byId.set(e.prefabEntityId, e);

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
            if (!parent.children.includes(e.prefabEntityId)) {
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
    const byId = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of entities) byId.set(e.prefabEntityId, e);
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<PrefabEntityId, number>();
    for (const e of entities) color.set(e.prefabEntityId, WHITE);

    const visit = (id: PrefabEntityId, path: PrefabEntityId[]): void => {
        const c = color.get(id);
        if (c === BLACK) return;
        if (c === GRAY) {
            const cycleStart = path.indexOf(id);
            const cycle = path.slice(cycleStart).concat(id);
            throw new Error(
                `Prefab "${prefabName}" parent cycle detected: ${cycle.join(' → ')}`,
            );
        }
        color.set(id, GRAY);
        const entity = byId.get(id);
        if (entity?.parent !== null && entity?.parent !== undefined) {
            visit(entity.parent, [...path, id]);
        }
        color.set(id, BLACK);
    };

    for (const e of entities) visit(e.prefabEntityId, []);
}
