export type {
    ComponentData,
    PrefabData,
    PrefabEntityData,
    PrefabOverride,
    NestedPrefabRef,
    ProcessedEntity,
    FlattenContext,
    FlattenResult,
} from './types';

export { flattenPrefab } from './flatten';
export { applyOverrides } from './override';
export { remapComponentEntityRefs } from './entityRef';
export { cloneComponents, cloneComponentData } from './clone';
export { collectNestedPrefabPaths, preloadNestedPrefabs } from './collect';
