// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Modeling: `.esmodel` sources, the steps they run, and the `.esmesh` they bake to.
 *        Pure: no filesystem and no engine instance, so the editor and a test run the same code.
 */
export {
    MODEL_OPS, MODEL_SOURCE_EXT, MODEL_SOURCE_VERSION, ModelBuildError, UNOFFERED_OPS, applyModelEdits, buildPolyMesh, describeModelOps, expandModelSource, validateModelSource,
    type ModelEdit, type ModelSource, type NormalBakeSource, type ModelStep, type StepReport,
} from './modelSource';
export { organic, ORGANIC_DEFAULT_RESOLUTION, ORGANIC_MAX_RESOLUTION, type OrganicParams, type OrganicPart } from './organic';
export { needsPreparing, prepareModeling } from './booleans';
export { tree, treeLeafPicture, treeParts, TREE_BARKS, TREE_SHAPES, type TreeBark, type TreeParams, type TreeShape } from './tree';
export { piecesPrefabOf, type FractureParams } from './fracture';
export { bakeModel, HAIR_CUTOFF, modelMaterialDoc, type BakedModel, type ModelReport } from './modelBake';
export { bakeNormalMap, type NormalBakeReport, type NormalMap } from './normalBake';
export type { FaceSelector } from './polyMesh';
export { DEFAULT_MODEL_VIEWS, MODEL_VIEWS, renderModelSheet, renderRigSheet, type ModelSheet, type ModelViewName, type RigViewOptions } from './modelViews';
export { controllerOf, jointPositions, morphedPositions, posedPositions, prefabOf, timelineOf, type AnimationSource, type ControllerSource, type PoseSolve, type PreviewGround, type RigSource, type ShapeSource } from './rig';
export { EXPR_HELP } from './modelExpr';
