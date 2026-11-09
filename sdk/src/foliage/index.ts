// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Foliage, FoliageField, FoliageRes, FoliagePlugin, foliagePlugin, type FoliageData,
} from './foliagePlugin';
export {
    PlacedFoliage, PlacedFoliageField, PlacedFoliageRes, PlacedFoliagePlugin, placedFoliagePlugin,
    type PlacedFoliageData,
} from './placedFoliage';
export { PlantGrowth, PlantGrowthRes, plantGrowthOf } from './plantGrowth';
export { PLACED_STRIDE, type PlacedKind, type PlacedPart, type PlantKind, type PlantInteractionDef } from './plantKind';
export {
    FoliageContact, PlantProxy, PlantInteraction, PlantInteractionRes, plantInteractionOf,
    type FoliageContactData, type PlantProxyData, type PlantRef, type PlantEvent, type PlantState, type PlantSaveState,
} from './plantInteraction';
export {
    scatterCell, buildGrassMesh, buildInstancedMesh, buildPlacedMesh, thinPlants, softenNormals, buildBillboardMesh, rng,
    type Plant, type Ground, type ScatterParams, type BladeParams, type CardRect,
} from './builder';

// Importing this subpath INSTALLS foliage — see tilemap/index.ts. It stands on a Terrain when the scene has one and
// needs none to stand on a flat floor, so it does not pull terrain's plugin in.
import { registerFoliageSupport } from './foliageSupport';

registerFoliageSupport();
