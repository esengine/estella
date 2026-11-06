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
export { bakeModel, type BakedModel, type ModelReport } from './modelBake';
export { DEFAULT_MODEL_VIEWS, MODEL_VIEWS, renderModelSheet, type ModelSheet, type ModelViewName } from './modelViews';
