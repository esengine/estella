// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    WorldGen, WorldZone, PlacedObject, ZoneShapeKind, WorldSurface, WorldGens, WorldGenRes, WorldGenPlugin, worldGenPlugin,
    type WorldGenData, type WorldZoneData, type PlacedObjectData, type WorldGenStatus,
} from './worldgenPlugin';
export {
    registerWorldRules, worldRules, bandWeight,
    type WorldRules, type BiomeDef, type BiomeCondition, type BiomeRecipe, type Recipe, type RecipeMember, type PlacementLayer,
} from './rules';
export { parseWorldRules, isRulesFile, WorldRulesAssetLoader } from './rulesAsset';
export { WorldPlan, type Placement, type Group, type Rejection } from './plan';
export { Zones, zoneDistance, zoneWeight, zoneBounds, type ZoneDef, type ZoneShape } from './zones';
export { createWorld2D, world2dChunk, placement2D, streamingPoints2D, type World2D, type World2DOptions, type World2DChunk, type Placement2D } from './world2d';
export { PlacementDiffs, type PlacementChange, type PlacementDiffsData } from './diffs';
export {
    Environment, fbm, fbm3, hash01, hashString, type FieldValues, type FieldFn, type NoiseField, type EnvironmentInputs,
} from './fields';

export { PlanetFace, FaceZones, planetFaces, faceHalf, faceUnit, type PlaneFrame } from './planetSurface';

// Importing this subpath INSTALLS generated worlds — see tilemap/index.ts. Their ground is the terrain's when the scene has one.
import { registerWorldGenSupport } from './worldgenSupport';

registerWorldGenSupport();
