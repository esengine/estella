// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Spline, SplinePlugin, splinePlugin, PathFollower, PathMode, PathOrient, pathPlace, type SplineData, type PathFollowerData } from './splinePlugin';
export { TerrainBand2D, buildTerrainBand, type TerrainBand2DData, type TerrainBandBuild } from './terrainBand2D';
export { RoadDecal, buildRoadDecal, type RoadDecalData, type RoadGround } from './roadDecal';
export { SplineCurve, SPLINE_POINT_TYPES, type SplinePoint, type SplineNearest, type SplinePointType, type SplinePointValue } from './curve';

// Importing this subpath INSTALLS splines — see tilemap/index.ts.
import { registerSplineSupport } from './splineSupport';

registerSplineSupport();
