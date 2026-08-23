// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavObstacle.ts
 * @brief   A box that takes ground away from the navigable world — a door, a
 *          gate, a placed building.
 *
 * The scene's collision geometry is what the mesh is baked from, so anything with
 * a collider already blocks. This is for what BLOCKS WITHOUT BEING GEOMETRY, or
 * what stops blocking without moving: a closed door that opens, a bridge that is
 * raised, a tile a tower was just built on.
 *
 * It is a box in the entity's own frame, so it turns with the entity — unlike the
 * volume, which cannot, because the volume is the voxel grid and this only marks
 * cells in one.
 */

import { defineComponent } from '../../ecs/component';
import type { Vec3 } from '../../types';

export interface NavObstacleData {
    /** Half-extents of the blocking box, in world pixels; the Transform is its centre. */
    halfExtents: Vec3;
    /** Whether it blocks right now. A door that opens is this field. */
    enabled: boolean;
}

export const NavObstacle = defineComponent<NavObstacleData>('NavObstacle', {
    halfExtents: { x: 50, y: 100, z: 50 },
    enabled: true,
}, {
    fields: {
        halfExtents: { unit: 'px', category: 'Navigation' },
        enabled: { category: 'Navigation', tooltip: 'Whether it blocks right now — a door that opens.' },
    },
});
