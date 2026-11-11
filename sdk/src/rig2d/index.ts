// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    RIG_SOURCE_VERSION, RIG_SOURCE_EXT, RIG_MAX_INFLUENCES, createRig, checkRig, parseRig, serializeRig, rigBoneWorlds, removeRigBone, rigBoneId, ensureRigBoneIds,
    type RigSource, type RigBone, type RigPart, type RigDeform, type RigBoneWorld,
} from './rigSource';
export {
    rigImageFromRGBA, findRigParts, coverRigPart, rigVertex, autoWeightPart, bindPartToBone, paintPartWeights, partWeightsOf, pushRigDeform,
    type RigImage, type RigWeightDab,
} from './rigMesh';
export { bakeRig, skinRigPart } from './rigBake';
export {
    rigBonePaths, rigParentProblem, setRigBoneParent, rebindRigToSkeleton, rigPathChanges, remapRigPath,
    type RigRebindReport, type RigPathChanges,
} from './rigRebind';
export { solveChain2D, chainTip, clampAngle, type ChainBone, type ChainSolveOptions } from './solve2d';
export {
    Bone2D, IK2D, BoneConstraint2D, BoneConstraintKind, Rig2DPlugin,
    type Bone2DData, type IK2DData, type BoneConstraint2DData,
} from './rig2dPlugin';
export { spawnRig, rigPrefab, type SpawnedRig } from './spawnRig';
