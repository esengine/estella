import type {
    ComponentData,
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
    ProcessedEntity,
} from './types';

export interface DiffOptions {
    /**
     * Metadata keys whose presence/value should not produce diffs. Editor
     * selection markers, per-panel UI state, and prefab-tracking metadata
     * that belongs on the *instance root* rather than the prefab itself
     * typically live here (e.g. `prefab:source`, `prefab:overrides`).
     */
    ignoreMetadataKeys?: readonly string[];
    /**
     * Entity names whose children should be excluded from the diff entirely
     * (useful for editor-only scaffolding entities).
     */
    ignoreEntityNames?: readonly string[];
    /**
     * Optional numeric tolerance for float equality checks. Defaults to 0
     * (exact equality). Raise to tame small FP drift from Transform math.
     */
    floatEpsilon?: number;
}

/**
 * Compute the minimal `PrefabOverride[]` that, applied to `source`, produces
 * the `instance` state. The editor calls this on every change to an instance
 * to keep `prefab:overrides` accurate.
 *
 * Contract:
 *   applyOverrides(flattenPrefab(source, [], ctx), diffAgainstSource(source, instance))
 *   reproduces `instance` modulo runtime id remapping.
 *
 * Current scope:
 *   - Handles property / component_added / component_replaced / component_removed
 *     / name / visibility / metadata_set / metadata_removed
 *   - Handles instance entities that are NEW relative to source (reports them
 *     via `untracked` — caller decides whether to surface as variant additions
 *     or error)
 *   - Does NOT yet emit "entity_removed" overrides (entity deletion from an
 *     instance has no override type today); missing entities are reported via
 *     `orphanedSourceIds`.
 */
export function diffAgainstSource(
    source: PrefabData,
    instance: readonly ProcessedEntity[],
    options?: DiffOptions,
): {
    overrides: PrefabOverride[];
    untracked: ProcessedEntity[];
    orphanedSourceIds: PrefabEntityId[];
} {
    const sourceById = new Map<PrefabEntityId, PrefabEntityData>();
    for (const e of source.entities) sourceById.set(e.prefabEntityId, e);

    const instanceByPrefabId = new Map<PrefabEntityId, ProcessedEntity>();
    for (const e of instance) instanceByPrefabId.set(e.prefabEntityId, e);

    const ignoredMeta = new Set(options?.ignoreMetadataKeys ?? []);
    const ignoredNames = new Set(options?.ignoreEntityNames ?? []);
    const eps = options?.floatEpsilon ?? 0;

    const overrides: PrefabOverride[] = [];
    const untracked: ProcessedEntity[] = [];
    const orphanedSourceIds: PrefabEntityId[] = [];

    for (const instEntity of instance) {
        if (ignoredNames.has(instEntity.name)) continue;
        const src = sourceById.get(instEntity.prefabEntityId);
        if (!src) {
            untracked.push(instEntity);
            continue;
        }

        if (instEntity.name !== src.name) {
            overrides.push({
                prefabEntityId: instEntity.prefabEntityId,
                type: 'name',
                value: instEntity.name,
            });
        }
        if (instEntity.visible !== src.visible) {
            overrides.push({
                prefabEntityId: instEntity.prefabEntityId,
                type: 'visibility',
                value: instEntity.visible,
            });
        }

        diffMetadata(src.metadata, instEntity.metadata, ignoredMeta, instEntity.prefabEntityId, overrides);
        diffComponents(src.components, instEntity.components, instEntity.prefabEntityId, eps, overrides);
    }

    for (const [id] of sourceById) {
        if (!instanceByPrefabId.has(id)) orphanedSourceIds.push(id);
    }

    return { overrides, untracked, orphanedSourceIds };
}

function diffMetadata(
    srcMeta: Record<string, unknown> | undefined,
    instMeta: Record<string, unknown> | undefined,
    ignored: Set<string>,
    entityId: PrefabEntityId,
    out: PrefabOverride[],
): void {
    const src = srcMeta ?? {};
    const inst = instMeta ?? {};
    const keys = new Set<string>([...Object.keys(src), ...Object.keys(inst)]);
    for (const key of keys) {
        if (ignored.has(key)) continue;
        const inSrc = key in src;
        const inInst = key in inst;
        if (inInst && !inSrc) {
            out.push({ prefabEntityId: entityId, type: 'metadata_set', metadataKey: key, value: inst[key] });
        } else if (!inInst && inSrc) {
            out.push({ prefabEntityId: entityId, type: 'metadata_removed', metadataKey: key });
        } else if (inInst && inSrc && !deepEqual(src[key], inst[key])) {
            out.push({ prefabEntityId: entityId, type: 'metadata_set', metadataKey: key, value: inst[key] });
        }
    }
}

function diffComponents(
    srcComps: readonly ComponentData[],
    instComps: readonly ComponentData[],
    entityId: PrefabEntityId,
    eps: number,
    out: PrefabOverride[],
): void {
    const srcByType = new Map<string, ComponentData>();
    for (const c of srcComps) srcByType.set(c.type, c);
    const instByType = new Map<string, ComponentData>();
    for (const c of instComps) instByType.set(c.type, c);

    for (const [type, srcComp] of srcByType) {
        if (!instByType.has(type)) {
            out.push({ prefabEntityId: entityId, type: 'component_removed', componentType: type });
        }
    }

    for (const [type, instComp] of instByType) {
        const srcComp = srcByType.get(type);
        if (!srcComp) {
            out.push({
                prefabEntityId: entityId,
                type: 'component_added',
                componentData: { type, data: deepClone(instComp.data) },
            });
            continue;
        }

        // Per-property diff keeps override list small and human-readable,
        // and lets Inspector "revert this field" work without dragging the
        // whole component along.
        const keys = new Set<string>([
            ...Object.keys(srcComp.data),
            ...Object.keys(instComp.data),
        ]);
        for (const key of keys) {
            const a = srcComp.data[key];
            const b = instComp.data[key];
            if (!deepEqual(a, b, eps)) {
                out.push({
                    prefabEntityId: entityId,
                    type: 'property',
                    componentType: type,
                    propertyName: key,
                    value: deepClone(b),
                });
            }
        }
    }
}

function deepEqual(a: unknown, b: unknown, eps = 0): boolean {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return true;
        return eps > 0 ? Math.abs(a - b) <= eps : false;
    }
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i], eps)) return false;
        return true;
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(ao[k], bo[k], eps)) return false;
    return true;
}

function deepClone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}
