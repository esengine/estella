// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Navigation barrel — the surface, its two shapes, and what drives them.
 */

export type {
    NavSurface, NavSurfaceSink, NavQueryOptions, NavPoint,
} from './NavSurface';
export { NavGrid, type NavGridOptions, type Cell } from './NavGrid';
export { findPath, pathToWorld, type PathfindOptions } from './pathfind';
export {
    navGridFromTiles,
    navGridFromTilemapLayer,
    type BuildNavGridOptions,
} from './navGridFromTilemap';
export { NavMesh, type NavMeshData } from './NavMesh';
export { buildNavMesh, type BuildNavMeshOptions } from './navmesh/build';
export {
    collectNavGeometry, navGeometryReady,
    type NavGeometry, type CollectNavGeometryOptions,
} from './navGeometry';
export { Navigation, Nav } from './Navigation';
export { NavAgent, type NavAgentData, setNavDestination, stopNavAgent } from './NavAgent';
export { NavVolume, type NavVolumeData } from './NavVolume';
export { NavPlugin, navPlugin } from './NavPlugin';
export { NavDebugDraw, drawNavDebug, type NavDebugDrawConfig } from './NavDebugDraw';
