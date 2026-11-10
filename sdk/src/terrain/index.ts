// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    Terrain, TerrainExtent, Terrains, TerrainsRes, TerrainPlugin, terrainPlugin, NOISE_PROVIDER, type TerrainData, type TerrainStatus, type TerrainLoad,
} from './terrainPlugin';
export {
    erodeHeightfield, erosionJob, heightfieldFromPixels, HeightmapFormat, proceduralHeightfield, sampleHeight, terrainNormal,
    type Eroded, type ErosionParams, type Heightfield, type ProceduralParams,
} from './heightfield';
export { FieldSource, NoiseSource, ModifiedSource, flattenModifier, noised, type LayerWeights, type NoiseParams, type Splat, type TerrainRegionSamples, type TerrainSource, type TerrainModifier } from './source';
export { boxDistance, levelRange, nodeKey, parentOf, selectNodes, type QuadtreeParams, type TerrainNode } from './quadtree';
export { makePage, PageTable, PAGE_SIDE, PAGE_TEXELS, PATCH_CELLS, type Page, type PageImage } from './pages';
export { buildPatchMesh } from './patch';
export { packLayers, parseTerrainLayer, TerrainLayerAssetLoader, type LayerImage, type LayerSource, type PackedLayers, type TerrainLayerDef } from './layers';
export { findGroundPath, type ReachGround, type ReachOptions, type ReachResult } from './reach';
export {
    noiseProvider, ProviderSource, registerTerrainProvider, terrainProvider, TerrainUnavailable,
    type TerrainProvider, type TerrainRegion, type TerrainSamples,
} from './provider';

// Importing this subpath INSTALLS terrain — see tilemap/index.ts.
import { registerTerrainSupport } from './terrainSupport';

registerTerrainSupport();
export { paintWeights } from './paint';
export { PlanetRegistry, PlanetRegistryRes, type PlanetFacts } from './planetQuery';
export { Planet, Planets, PlanetPlugin, planetPlugin, type PlanetData, type PlanetStatus } from './planetPlugin';
export { registerPlanetProvider, planetProvider, type PlanetProvider, type PlanetRegion, type PlanetSamples } from './planetProvider';
export { makePlanetPage, tangentFrame, type PlanetPageSource } from './planetPages';
export {
    FACES, direction, faceOf, levelsFor, nodeAt, nodeBound, nodeDistance, nodePoint, nodeRect, nodeSpan, selectSphereNodes, sphereNodeKey, sphereRange,
    type SphereNode, type SphereTreeParams,
} from './sphere';
export { GroundEdit, type GroundPatch } from './groundEdit';
export { TiledGroundEdit, type TiledGroundPatch, type TiledGroundImage } from './tiledGroundEdit';
export { imagePixelsAt as readTerrainImage } from './layerArrays';
export { SculptMode, brushWeight, encodeHeightmap, paintSplat, sculptField, unionDirty, type Brush, type Dirty, type PaintDab, type SculptDab } from './sculpt';
