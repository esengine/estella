// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Navigation barrel — grid, A*, tilemap builder, agent, plugin.
 */

export { NavGrid, type NavGridOptions, type NavPlane, type Cell } from './NavGrid';
export { findPath, pathToWorld, type PathfindOptions } from './pathfind';
export {
    navGridFromTiles,
    navGridFromTilemapLayer,
    type BuildNavGridOptions,
} from './navGridFromTilemap';
export {
    bakeNavGrid,
    type BakeNavGridOptions,
    type GroundProbe,
    type GroundHit,
} from './bakeNavGrid';
export { Navigation, Nav } from './Navigation';
export { NavAgent, type NavAgentData, setNavDestination, stopNavAgent } from './NavAgent';
export { NavVolume, type NavVolumeData } from './NavVolume';
export { NavPlugin, navPlugin } from './NavPlugin';
