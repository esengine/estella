export interface ComponentData {
    type: string;
    data: Record<string, unknown>;
}

/**
 * Per-entity identity inside a prefab file.
 *
 * The string is opaque — UUIDs for editor-authored prefabs, stringified
 * integers for migrated legacy files. Stability matters more than format:
 * once an entity has been assigned a `PrefabEntityId`, the editor must
 * never reassign or reuse it for the lifetime of the prefab, otherwise
 * existing instance overrides will silently apply to the wrong target.
 */
export type PrefabEntityId = string;

export interface PrefabData {
    version: string;
    name: string;
    rootEntityId: PrefabEntityId;
    entities: PrefabEntityData[];
    /**
     * If set, this prefab inherits from another prefab. The variant's own
     * `entities` list may **override** existing base entries (matched by
     * `prefabEntityId`) and **add** new entities; `overrides` is applied
     * on top of the merged result.
     */
    basePrefab?: string;
    overrides?: PrefabOverride[];
}

export interface PrefabEntityData {
    prefabEntityId: PrefabEntityId;
    name: string;
    parent: PrefabEntityId | null;
    children: PrefabEntityId[];
    components: ComponentData[];
    visible: boolean;
    /**
     * Editor/tooling state that survives prefab round-trip. Not consumed by
     * the runtime engine — the runtime instantiation path drops this. The
     * editor uses it to round-trip per-entity metadata such as asset refs
     * (`asset:Comp.field` → uuid) and selection markers.
     */
    metadata?: Record<string, unknown>;
    nestedPrefab?: NestedPrefabRef;
}

export interface NestedPrefabRef {
    prefabPath: string;
    overrides: PrefabOverride[];
}

/**
 * Override types applied to an entity in an instantiated prefab.
 *
 * - `property`          — patch one field of one component.
 *                         Requires: componentType, propertyName, value.
 * - `name`              — change the entity's name. Requires: value (string).
 * - `visibility`        — change the entity's visibility. Requires: value (boolean).
 * - `component_added`   — add a component **only if not already present**
 *                         (idempotent insert). Requires: componentData.
 *                         Use this for variants that want to *augment* the
 *                         base without silently stomping existing data.
 * - `component_replaced`— upsert: replace the component's data if the
 *                         component already exists, or insert it if not.
 *                         Requires: componentData. Use this when you
 *                         explicitly want to override the base's copy.
 * - `component_removed` — delete the component if present.
 *                         Requires: componentType.
 * - `metadata_set`      — set or replace one metadata key. Requires:
 *                         metadataKey, value (any JSON-serialisable).
 *                         Idempotent — applying twice is a no-op.
 * - `metadata_removed`  — delete one metadata key if present. Requires:
 *                         metadataKey.
 */
export interface PrefabOverride {
    prefabEntityId: PrefabEntityId;
    type:
        | 'property'
        | 'component_added'
        | 'component_replaced'
        | 'component_removed'
        | 'name'
        | 'visibility'
        | 'metadata_set'
        | 'metadata_removed';
    componentType?: string;
    propertyName?: string;
    metadataKey?: string;
    value?: unknown;
    componentData?: ComponentData;
}

export interface ProcessedEntity {
    /** Runtime entity id assigned by the flatten allocator. */
    id: number;
    /** Stable identity from the source prefab; preserved for diff/override matching. */
    prefabEntityId: PrefabEntityId;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
    metadata?: Record<string, unknown>;
}

export interface FlattenContext {
    allocateId: () => number;
    loadPrefab: (path: string) => PrefabData | null;
    visited?: Set<string>;
    depth?: number;
}

export interface FlattenResult {
    entities: ProcessedEntity[];
    rootId: number;
}
