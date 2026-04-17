export interface ComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface PrefabData {
    version: string;
    name: string;
    rootEntityId: number;
    entities: PrefabEntityData[];
    basePrefab?: string;
    overrides?: PrefabOverride[];
}

export interface PrefabEntityData {
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
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
 */
export interface PrefabOverride {
    prefabEntityId: number;
    type:
        | 'property'
        | 'component_added'
        | 'component_replaced'
        | 'component_removed'
        | 'name'
        | 'visibility';
    componentType?: string;
    propertyName?: string;
    value?: unknown;
    componentData?: ComponentData;
}

export interface ProcessedEntity {
    id: number;
    prefabEntityId: number;
    name: string;
    parent: number | null;
    children: number[];
    components: ComponentData[];
    visible: boolean;
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
