// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { SpinePlugin, SpineEvents } from './SpinePlugin';
export type { SpineEvent, SpineEventType, SpineEventsData } from './SpinePlugin';
export { SpineManager } from './SpineManager';
export type { SpineVersion } from './SpineManager';
export { ModuleBackend } from './ModuleBackend';
export { SpineModuleController } from './SpineController';
export type { SpineEventCallback, ConstraintList, TransformMixData, PathMixData } from './SpineController';
export type { SpineModuleFactory } from './SpineModuleLoader';
export { wrapSpineModule } from './SpineModuleLoader';
// Shared spine scene loader — the editor loads spine entities through the same
// single implementation the builder runtime uses (see ./loadSpineScene).
export { loadSpineSceneEntities, loadSpineAssets, applySpineEntities } from './loadSpineScene';
export type { RuntimeAssetProvider } from '../runtimeAssets';
