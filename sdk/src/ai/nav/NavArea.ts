// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavArea.ts
 * @brief   A box of ground that costs more or less to cross — mud, water, a road.
 *
 * The mesh answers where an agent CAN walk. This is where a scene says what it
 * would rather walk on: a route through a marked box is charged its `cost` per
 * unit, so a road at half price is taken the long way round and a swamp at four
 * times is walked round entirely if there is any way round at all.
 *
 * It does not block. A cost high enough to be a wall is still a cost — an agent
 * with nowhere else to go wades through, which is what a swamp is and what
 * {@link NavObstacle} is not.
 */

import { defineComponent } from '../../ecs/component';
import type { Vec3 } from '../../types';

export interface NavAreaData {
    /** Half-extents of the box, in world pixels; the Transform is its centre. */
    halfExtents: Vec3;
    /**
     * What a unit of distance inside it costs, against 1 for open ground. Under 1
     * is preferred, over 1 is avoided; 0 or less is not a shortcut but a mistake,
     * and reads as free ground.
     */
    cost: number;
    enabled: boolean;
}

export const NavArea = defineComponent<NavAreaData>('NavArea', {
    halfExtents: { x: 200, y: 100, z: 200 },
    cost: 3,
    enabled: true,
}, {
    fields: {
        halfExtents: { unit: 'px', category: 'Navigation' },
        cost: { min: 0, category: 'Navigation', tooltip: 'What crossing it costs against 1 for open ground.' },
        enabled: { category: 'Navigation' },
    },
});
