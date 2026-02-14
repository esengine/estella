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
    convertPrefabAssetRefs,
    type EntityTreeToPrefabResult,
} from './PrefabSerializer';

export {
    instantiatePrefab,
    instantiatePrefabRecursive,
    syncPrefabInstances,
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
    recordComponentAddedOverride,
    recordComponentRemovedOverride,
    removePropertyOverride,
} from './PrefabOverrideTracker';
