/**
 * @file    index.ts
 * @brief   Prefab system exports
 */

export {
    serializePrefab,
    deserializePrefab,
    entityTreeToPrefab,
    prefabToSceneData,
    sceneDataToPrefab,
    savePrefabToPath,
    loadPrefabFromPath,
    type EntityTreeToPrefabResult,
} from './PrefabSerializer';

export {
    instantiatePrefab,
    instantiatePrefabRecursive,
    computeNextEntityId,
    type InstantiateResult,
} from './PrefabInstantiator';

export {
    isPropertyOverridden,
    getOverridesForEntity,
    hasAnyOverrides,
    recordPropertyOverride,
    recordNameOverride,
    recordVisibilityOverride,
    removePropertyOverride,
} from './PrefabOverrideTracker';
