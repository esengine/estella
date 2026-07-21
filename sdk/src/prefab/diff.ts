// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type {
    ComponentData,
    PrefabData,
    PrefabEntityId,
    PrefabOverride,
    ProcessedEntity,
} from './types';
import { getComponent } from '../component';

/**
 * An entity-typed field on an instance holds a numeric runtime id; the source
 * prefab stores the prefab-local string id. Translate the runtime id back to its
 * prefab-local id (inverse of {@link remapComponentEntityRefs}) so an UNCHANGED
 * intra-instance ref diffs equal — otherwise every such field produces a spurious
 * override carrying a session-specific number that dangles on save+reload. A ref
 * that points outside the instance (unmapped) stays numeric, best-effort.
 */
function normalizeEntityRef(value: unknown, runtimeToPrefabId: Map<number, PrefabEntityId>): unknown {
    if (typeof value === 'number') {
        const prefabId = runtimeToPrefabId.get(value);
        if (prefabId !== undefined) return prefabId;
    }
    return value;
}

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
    // A flat prefab's own `entities` list IS its pristine baseline (entity-ref
    // fields already in prefab-local id space). Nested prefabs must diff against
    // a flattened baseline instead — {@link diffEntities} — since their children
    // are not present in `source.entities`.
    return diffEntities(source.entities, instance, options);
}

/** The subset of an entity {@link diffEntities} reads. `PrefabEntityData` (raw
 *  source, string entity-refs, no `id`) and `ProcessedEntity` (flattened
 *  baseline / instance, numeric entity-refs + `id`) both satisfy it. */
export interface DiffBaselineEntity {
    prefabEntityId: PrefabEntityId;
    name: string;
    visible: boolean;
    components: ComponentData[];
    metadata?: Record<string, unknown>;
    /** Runtime id — present on flattened baselines so their entity-ref fields
     *  normalise to stable-id space; absent on raw source entities. */
    id?: number;
}

/**
 * Diff an `instance` against a `baseline` (both keyed by the stable
 * `prefabEntityId` — a composed `slot/localId` address once nesting is
 * involved). Entity-ref component fields are normalised on BOTH sides to their
 * own runtime-id→stable-id space, so an unchanged cross-reference diffs equal
 * regardless of which side carries volatile runtime numbers.
 */
export function diffEntities(
    baseline: readonly DiffBaselineEntity[],
    instance: readonly ProcessedEntity[],
    options?: DiffOptions,
): {
    overrides: PrefabOverride[];
    untracked: ProcessedEntity[];
    orphanedSourceIds: PrefabEntityId[];
} {
    const baselineById = new Map<PrefabEntityId, DiffBaselineEntity>();
    for (const e of baseline) baselineById.set(e.prefabEntityId, e);

    const instanceByPrefabId = new Map<PrefabEntityId, ProcessedEntity>();
    for (const e of instance) instanceByPrefabId.set(e.prefabEntityId, e);

    // Each side's runtime id → its stable id, so entity-ref fields diff in
    // stable-id space instead of against volatile runtime numbers.
    const baseRefMap = new Map<number, PrefabEntityId>();
    for (const e of baseline) if (e.id !== undefined) baseRefMap.set(e.id, e.prefabEntityId);
    const instRefMap = new Map<number, PrefabEntityId>();
    for (const e of instance) instRefMap.set(e.id, e.prefabEntityId);

    const ignoredMeta = new Set(options?.ignoreMetadataKeys ?? []);
    const ignoredNames = new Set(options?.ignoreEntityNames ?? []);
    const eps = options?.floatEpsilon ?? 0;

    const overrides: PrefabOverride[] = [];
    const untracked: ProcessedEntity[] = [];
    const orphanedSourceIds: PrefabEntityId[] = [];

    for (const instEntity of instance) {
        if (ignoredNames.has(instEntity.name)) continue;
        const base = baselineById.get(instEntity.prefabEntityId);
        if (!base) {
            untracked.push(instEntity);
            continue;
        }

        if (instEntity.name !== base.name) {
            overrides.push({
                prefabEntityId: instEntity.prefabEntityId,
                type: 'name',
                value: instEntity.name,
            });
        }
        if (instEntity.visible !== base.visible) {
            overrides.push({
                prefabEntityId: instEntity.prefabEntityId,
                type: 'visibility',
                value: instEntity.visible,
            });
        }

        diffMetadata(base.metadata, instEntity.metadata, ignoredMeta, instEntity.prefabEntityId, overrides);
        diffComponents(base.components, instEntity.components, instEntity.prefabEntityId, eps, overrides, baseRefMap, instRefMap);
    }

    for (const [id] of baselineById) {
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
    baseComps: readonly ComponentData[],
    instComps: readonly ComponentData[],
    entityId: PrefabEntityId,
    eps: number,
    out: PrefabOverride[],
    baseRefMap: Map<number, PrefabEntityId>,
    instRefMap: Map<number, PrefabEntityId>,
): void {
    const baseByType = new Map<string, ComponentData>();
    for (const c of baseComps) baseByType.set(c.type, c);
    const instByType = new Map<string, ComponentData>();
    for (const c of instComps) instByType.set(c.type, c);

    for (const [type] of baseByType) {
        if (!instByType.has(type)) {
            out.push({ prefabEntityId: entityId, type: 'component_removed', componentType: type });
        }
    }

    for (const [type, instComp] of instByType) {
        const baseComp = baseByType.get(type);
        if (!baseComp) {
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
        const entityFields = new Set(getComponent(type)?.entityFields ?? []);
        const keys = new Set<string>([
            ...Object.keys(baseComp.data),
            ...Object.keys(instComp.data),
        ]);
        for (const key of keys) {
            // Entity refs diff (and store) in stable-id space so an unchanged
            // cross-reference isn't logged as a dangling numeric override — both
            // sides normalise through their own runtime-id→stable-id map.
            const a = entityFields.has(key)
                ? normalizeEntityRef(baseComp.data[key], baseRefMap)
                : baseComp.data[key];
            const b = entityFields.has(key)
                ? normalizeEntityRef(instComp.data[key], instRefMap)
                : instComp.data[key];
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
