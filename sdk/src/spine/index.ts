// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { SpinePlugin, spinePlugin, SpineEvents, Spine } from './SpinePlugin';
export type { SpineEvent, SpineEventType, SpineEventsData } from './SpinePlugin';
export { SpineManager } from './SpineManager';
export type { SpineVersion } from './SpineManager';
export { SpineRuntime } from './SpineRuntime';
export { SpineModuleController } from './SpineController';
export type { ConstraintList, TransformMixData, PathMixData } from './SpineController';
export type { SpineModuleFactory } from './SpineModuleLoader';
export { wrapSpineModule } from './SpineModuleLoader';
export type { SpinePair } from './prepareSpine';
export type { SpineClipBudget } from './spineMetrics';
export type {
    SpineAABB, SpineCullingEnvelope, SpineScanCoverage, SpineBoundsSource,
} from './spineBounds';
export {
    setupBounds, scanObservedBounds, certifyBounds, envelopeFor, mayDeferWorldPose,
    worldBounds, contains,
} from './spineBounds';
export { spineCertificatesFrom, NO_CERTIFICATES } from './spineCertificates';
export type { SpineCertificateSource, SpineCullingProvider } from './spineCertificates';
export { spineSceneDiagnostics, formatSpineDiagnostics } from './spineSceneDiagnostics';
export type {
    SpineSceneDiagnostics, SpineAssetDiagnostic, SpineFinding, SpineFindingCode,
    SpineDeferralBlocker, SpinePoseTotals, SpineResidencyFacts, SpineDiagnosticRuntime,
} from './spineSceneDiagnostics';
// Shared spine scene loader — the editor loads spine entities through the same
// single implementation the builder runtime uses (see ./loadSpineScene).
export { loadSpineSceneEntities, loadSpineAssets, applySpineEntities, spineEntityProps } from './loadSpineScene';
export type { RuntimeAssetSource } from '../runtime/runtimeAssets';
