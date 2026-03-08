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

export interface PrefabOverride {
    prefabEntityId: number;
    type: 'property' | 'component_added' | 'component_removed' | 'name' | 'visibility';
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
