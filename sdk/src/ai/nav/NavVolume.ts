// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavVolume.ts
 * @brief   The box a navigation mesh is baked over — where a scene SAYS its
 *          agents may walk.
 *
 * Authored, not coded. A flat scene builds its grid from a tilemap, which is
 * already data; a spatial one has only geometry, and asking every game to write
 * the bake by hand would put the one thing agents depend on outside the scene
 * that describes them.
 *
 * Every field here is a fact about the AGENT or about how finely the world is
 * measured — never about the route, which is what the bake works out from them.
 */

import { defineComponent } from '../../ecs/component';
import type { Vec3 } from '../../types';

export interface NavVolumeData {
    /** Half-extents of the box, in world pixels; the entity's Transform is its centre. */
    halfExtents: Vec3;
    /** Voxel size in the ground plane, in world pixels. Smaller is a mesh that
     *  hugs the geometry more closely, and a slower bake. */
    cellSize: number;
    /** Voxel size vertically, in world pixels. This is what decides whether a
     *  balcony and the floor under it are two levels or one. */
    cellHeight: number;
    /** Steepest ground an agent can stand on, in degrees from level. */
    maxSlopeDegrees: number;
    /** Headroom an agent needs; ground with less is not walkable. */
    agentHeight: number;
    /** How wide the agent is. The mesh is pulled back from every wall by this, so
     *  a route over it clears the walls without the planner doing anything. */
    agentRadius: number;
    /** Height difference between neighbouring cells an agent can climb. */
    stepHeight: number;
    /** Physics layers the ground is on; 0 = every layer. */
    layers: number;
}

export const NavVolume = defineComponent<NavVolumeData>('NavVolume', {
    halfExtents: { x: 1000, y: 500, z: 1000 },
    cellSize: 50,
    cellHeight: 10,
    maxSlopeDegrees: 45,
    agentHeight: 180,
    agentRadius: 30,
    stepHeight: 40,
    layers: 0,
}, {
    fields: {
        halfExtents: { unit: 'px', category: 'Navigation' },
        cellSize: { min: 1, unit: 'px', category: 'Navigation' },
        cellHeight: { min: 1, unit: 'px', category: 'Navigation', tooltip: 'Vertical voxel size; what separates one level from the one above it.' },
        maxSlopeDegrees: { min: 0, max: 89, unit: '°', category: 'Navigation' },
        agentHeight: { min: 0, unit: 'px', category: 'Navigation', tooltip: 'Headroom an agent needs to walk somewhere.' },
        agentRadius: { min: 0, unit: 'px', category: 'Navigation', tooltip: 'How wide the agent is; the mesh is pulled back from walls by this.' },
        stepHeight: { min: 0, unit: 'px', category: 'Navigation' },
        layers: { min: 0, category: 'Navigation', advanced: true, tooltip: 'Layer mask the ground is taken from; 0 = every layer.' },
    },
});
