import type {
    PrefabData,
    PrefabOverride,
    ProcessedEntity,
    FlattenContext,
    FlattenResult,
} from './types';
import { cloneComponents } from './clone';
import { remapComponentEntityRefs } from './entityRef';
import { applyOverrides } from './override';

const MAX_PREFAB_NESTING_DEPTH = 10;

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

    const visited = ctx.visited ?? new Set<string>();
    const idMapping = new Map<number, number>();

    for (const pe of prefab.entities) {
        if (!pe.nestedPrefab) {
            idMapping.set(pe.prefabEntityId, ctx.allocateId());
        }
    }

    const result: ProcessedEntity[] = [];

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

            visited.add(nestedPath);

            const nested = flattenPrefab(
                nestedPrefab,
                pe.nestedPrefab.overrides,
                { ...ctx, visited, depth: depth + 1 },
            );

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
        };

        // Apply overrides BEFORE remapping so newly added/replaced
        // components — and property overrides that target an
        // entityField — get their prefab-entity-id values remapped
        // to the allocated entity ids in the same pass.
        applyOverrides(entity, overrides);
        remapComponentEntityRefs(entity.components, idMapping);
        result.push(entity);
    }

    const rootId = idMapping.get(prefab.rootEntityId);
    if (rootId === undefined) {
        throw new Error('Failed to resolve prefab root entity');
    }

    return { entities: result, rootId };
}

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

    const variantOverrides = variant.overrides ?? [];
    const combinedOverrides = [...variantOverrides, ...instanceOverrides];

    return flattenPrefab(
        basePrefab,
        combinedOverrides,
        { ...ctx, visited, depth: depth + 1 },
    );
}
