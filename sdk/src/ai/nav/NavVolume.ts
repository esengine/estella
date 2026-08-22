// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavVolume.ts
 * @brief   The box a navigation grid is baked over — where a scene SAYS its
 *          agents may walk.
 *
 * Authored, not coded. A flat scene builds its grid from a tilemap, which is
 * already data; a spatial one has only geometry, and asking every game to write
 * the bake by hand would put the one thing agents depend on outside the scene
 * that describes them.
 */

import { defineComponent } from '../../ecs/component';
import type { Vec3 } from '../../types';

export interface NavVolumeData {
    /** Half-extents of the box, in world pixels; the entity's Transform is its centre. */
    halfExtents: Vec3;
    /** World pixels per cell. Smaller is a finer route and a slower bake. */
    cellSize: number;
    /** Steepest ground an agent can stand on, in degrees from level. */
    maxSlopeDegrees: number;
    /** Headroom an agent needs; a cell with less is not walkable. 0 skips the check. */
    agentHeight: number;
    /** Height difference between neighbouring cells an agent can climb. */
    stepHeight: number;
    /** Physics layers the ground is on; 0 = every layer. */
    layers: number;
}

export const NavVolume = defineComponent<NavVolumeData>('NavVolume', {
    halfExtents: { x: 1000, y: 500, z: 1000 },
    cellSize: 50,
    maxSlopeDegrees: 45,
    agentHeight: 180,
    stepHeight: 40,
    layers: 0,
}, {
    fields: {
        halfExtents: { unit: 'px', category: 'Navigation' },
        cellSize: { min: 1, unit: 'px', category: 'Navigation' },
        maxSlopeDegrees: { min: 0, max: 89, unit: '°', category: 'Navigation' },
        agentHeight: { min: 0, unit: 'px', category: 'Navigation', tooltip: 'Headroom an agent needs; 0 skips the ceiling check.' },
        stepHeight: { min: 0, unit: 'px', category: 'Navigation' },
        layers: { min: 0, category: 'Navigation', advanced: true, tooltip: 'Layer mask the ground rays are cast against; 0 = every layer.' },
    },
});
