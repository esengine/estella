// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Modeling: `.esmodel` sources, the steps they run, and the `.esmesh` they bake to.
 *        Pure: no filesystem and no engine instance, so the editor and a test run the same code.
 */
export {
    MODEL_OPS, MODEL_SOURCE_EXT, MODEL_SOURCE_VERSION, ModelBuildError, applyModelEdits, buildPolyMesh, describeModelOps, validateModelSource,
    type ModelEdit, type ModelSource, type ModelStep, type StepReport,
} from './modelSource';
export { organic, ORGANIC_DEFAULT_RESOLUTION, ORGANIC_MAX_RESOLUTION, type OrganicParams, type OrganicPart } from './organic';
export { needsPreparing, prepareModeling } from './booleans';
export { bakeModel, type BakedModel, type ModelReport } from './modelBake';
export type { FaceSelector } from './polyMesh';
export { DEFAULT_MODEL_VIEWS, MODEL_VIEWS, renderModelSheet, renderRigSheet, type ModelSheet, type ModelViewName, type RigViewOptions } from './modelViews';
export { controllerOf, jointPositions, morphedPositions, posedPositions, prefabOf, timelineOf, type AnimationSource, type ControllerSource, type PoseSolve, type PreviewGround, type RigSource, type ShapeSource } from './rig';
