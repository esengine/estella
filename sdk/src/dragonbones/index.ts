// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { DragonBonesModuleController } from './DragonBonesController';
export { wrapDragonBonesModule } from './DragonBonesModuleLoader';
export type {
    DragonBonesWasmModule,
    DragonBonesWrappedAPI,
    DragonBonesModuleFactory,
} from './DragonBonesModuleLoader';
export { DragonBonesManager } from './DragonBonesManager';
export type { DragonBonesEntityOptions } from './DragonBonesManager';
export { DragonBonesPlugin, dragonBonesPlugin, DragonBones } from './DragonBonesPlugin';
export { parseDragonBonesNames } from './skeletonNames';
export type { DragonBonesArmatureNames } from './skeletonNames';
// Shared scene loader — the editor binds a scene's armatures through the same
// single implementation the builder runtime uses (see ./loadDragonBonesScene).
export {
    loadDragonBonesSceneEntities,
    loadDragonBonesAssets,
    applyDragonBonesEntities,
    dragonBonesEntityProps,
} from './loadDragonBonesScene';
export type { DragonBonesAssetInfo } from './loadDragonBonesScene';
export type { RuntimeAssetSource } from '../runtime/runtimeAssets';
