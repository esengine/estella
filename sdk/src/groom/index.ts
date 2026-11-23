// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Groom, GroomPlugin, GroomRes, GroomResource, groomPlugin, groupUniforms, besideFile, createStrandsMaterial, loadGroomCurves, screenSizeOf, GROOM_SHADOW_PER_UNIT, GROOM_LOD_HYSTERESIS, type GroomData } from './groomPlugin';
export {
    decodeCurves, encodeCurves, parseGroomDocument, groupSettings, settingsForGroups, curveSetStats, groupStats, emptyCurveSet,
    CurveAttribute, DEFAULT_GROUP_SETTINGS, DEFAULT_CARDS_SCREEN_SIZE, CURVES_MAGIC, CURVES_VERSION, GROOM_FORMAT_VERSION,
    type CurveSet, type CurveGroup, type GroomCurves, type GroomGroupSettings, type GroomDocument, type GroomCardsLod, type CurveSetStats, type GroupStats,
} from './groomFormat';
export { growGroom, checkGrowRecipe, GROW_LIMITS, type GrowRecipe, type GrowGroup, type GrowScalp, type GrowEllipsoid } from './groomGrow';
export {
    meshSurface, projectStrands, bakeStrandsTextures, bakeFollicleMask, SEGMENT_FLOATS, MIN_TEXEL_COVERAGE,
    type MeshPlacement, type MeshSurface, type ProjectedStrands, type StrandsProjectionOptions, type TraceType, type BakedTexture, type FollicleGroom, type Bvh,
} from './groomTextures';
export { buildGroomCards, type GroomCardsOptions } from './groomCards';
export { buildStrandMesh, type StrandMesh } from './groomMesh';
export { STRANDS_SHADER_TEMPLATE } from './groomShader';

// Importing this subpath INSTALLS grooms — see tilemap/index.ts.
import { registerGroomSupport } from './groomSupport';

registerGroomSupport();
