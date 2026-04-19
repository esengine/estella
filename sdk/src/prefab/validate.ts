import type {
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
} from './types';

export interface StaleOverride {
    override: PrefabOverride;
    reason: string;
    /** Where in the prefab the override lives. */
    site: 'variant' | 'nested' | 'instance';
    /** For nested sites, the nested prefab's entity id whose overrides list it came from. */
    nestedAt?: PrefabEntityId;
}

export interface ValidateResult {
    stale: StaleOverride[];
    /**
     * Entity ids mentioned in the prefab's own `children` lists that have
     * no corresponding entity entry. Surfaces corruption from third-party
     * editing tools; flatten also fails hard on this, so this is a softer
     * diagnostic the editor can surface before flatten.
     */
    orphanedChildren: PrefabEntityId[];
}

/**
 * Find overrides pointing at entities or components that no longer exist.
 *
 * The check is structural (no flatten). For nested-prefab site validation
 * pass a loader via `options.loadPrefab`; without it, nested overrides are
 * skipped (treated as "cannot verify").
 *
 * Used by the editor on scene open + on Apply-to-Source to warn the user
 * before stale overrides silently disappear.
 */
export function validateOverrides(
    prefab: PrefabData,
    options?: {
        /** Overrides applied at instance site, e.g. `prefab:overrides` metadata. */
        instanceOverrides?: readonly PrefabOverride[];
        loadPrefab?: (path: string) => PrefabData | null;
    },
): ValidateResult {
    const stale: StaleOverride[] = [];
    const orphanedChildren: PrefabEntityId[] = [];

    const byId = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of prefab.entities) byId.set(e.prefabEntityId, e);

    for (const e of prefab.entities) {
        for (const childId of e.children) {
            if (!byId.has(childId)) orphanedChildren.push(childId);
        }
    }

    const checkAgainst = (
        overrides: readonly PrefabOverride[],
        target: PrefabData,
        site: StaleOverride['site'],
        nestedAt?: PrefabEntityId,
    ): void => {
        const map = new Map<PrefabEntityId, PrefabEntityData>();
        for (const e of target.entities) map.set(e.prefabEntityId, e);
        for (const o of overrides) {
            const entity = map.get(o.prefabEntityId);
            if (!entity) {
                stale.push({
                    override: o,
                    reason: `entity "${o.prefabEntityId}" not found in "${target.name}"`,
                    site,
                    ...(nestedAt !== undefined ? { nestedAt } : {}),
                });
                continue;
            }
            const reason = reasonForOverride(o, entity);
            if (reason) {
                stale.push({
                    override: o,
                    reason,
                    site,
                    ...(nestedAt !== undefined ? { nestedAt } : {}),
                });
            }
        }
    };

    if (prefab.overrides) {
        checkAgainst(prefab.overrides, prefab, 'variant');
    }
    if (options?.instanceOverrides) {
        checkAgainst(options.instanceOverrides, prefab, 'instance');
    }

    if (options?.loadPrefab) {
        const loader = options.loadPrefab;
        for (const e of prefab.entities) {
            if (!e.nestedPrefab) continue;
            const nested = loader(e.nestedPrefab.prefabPath);
            if (!nested) continue;
            checkAgainst(e.nestedPrefab.overrides, nested, 'nested', e.prefabEntityId);
        }
    }

    return { stale, orphanedChildren };
}

function reasonForOverride(
    override: PrefabOverride,
    entity: PrefabEntityData,
): string | null {
    switch (override.type) {
        case 'property':
        case 'component_removed': {
            const type = override.componentType;
            if (!type) return 'missing componentType';
            const exists = entity.components.some(c => c.type === type);
            return exists ? null : `component "${type}" not present on "${entity.prefabEntityId}"`;
        }
        case 'component_replaced':
        case 'component_added':
            // Both are upserts; they can't be stale by definition.
            return null;
        case 'metadata_removed': {
            const key = override.metadataKey;
            if (!key) return 'missing metadataKey';
            const present = entity.metadata && Object.prototype.hasOwnProperty.call(entity.metadata, key);
            return present ? null : `metadata key "${key}" not present on "${entity.prefabEntityId}"`;
        }
        case 'metadata_set':
        case 'name':
        case 'visibility':
            return null;
    }
}
