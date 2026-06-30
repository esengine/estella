// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type {
    ComponentData,
    PrefabData,
    PrefabEntityData,
    PrefabEntityId,
    PrefabOverride,
    NestedPrefabRef,
    ProcessedEntity,
    FlattenContext,
    FlattenResult,
} from './types';

export { flattenPrefab } from './flatten';
export { applyOverrides, applyOverridesToSource, bucketOverridesByEntity } from './override';
export type { OverrideTarget } from './override';
export { remapComponentEntityRefs } from './entityRef';
export { cloneComponents, cloneComponentData, cloneMetadata } from './clone';
export { collectNestedPrefabPaths, preloadNestedPrefabs } from './collect';
export { migratePrefabData, PREFAB_FORMAT_VERSION } from './migrate';
export type { MigrationResult } from './migrate';
export { diffAgainstSource } from './diff';
export type { DiffOptions } from './diff';
export { validateOverrides } from './validate';
export type { ValidateResult, StaleOverride } from './validate';

export {
    expandInstance,
    collapseInstance,
    expandEntry,
    collapseEntry,
    rebuildChildren,
    extractPrefab,
} from './sceneInstance';
export type {
    AddedEntity,
    PrefabInstanceDelta,
    PrefabInstanceEntry,
    SyncPrefabResolver,
    ExtractEntity,
} from './sceneInstance';
