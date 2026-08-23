// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavLink.ts
 * @brief   A way between two places the ground does not join — a drop off a
 *          ledge, a ladder, a plank across a gap.
 *
 * The mesh is baked from what an agent can WALK, so two floors are two places
 * unless geometry joins them. That is the honest answer and it is not the whole
 * one: a scene knows things the floor does not, and this is where it says them.
 *
 * Both ends are offsets in the entity's own frame, so a link turns and travels
 * with whatever carries it — a ladder in a prefab is a ladder wherever the prefab
 * is put down.
 */

import { defineComponent } from '../../ecs/component';
import type { Vec3 } from '../../types';

export interface NavLinkData {
    /** Where the way starts, relative to the entity. */
    start: Vec3;
    /** Where it comes out, relative to the entity. */
    end: Vec3;
    /** Whether it can be taken in both directions. A drop off a ledge is not. */
    bidirectional: boolean;
    /**
     * How far from each end the ground may be and still be joined, in world
     * pixels. An end that reaches no ground joins nothing.
     */
    radius: number;
    enabled: boolean;
}

export const NavLink = defineComponent<NavLinkData>('NavLink', {
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 150 },
    bidirectional: true,
    radius: 50,
    enabled: true,
}, {
    fields: {
        start: { unit: 'px', category: 'Navigation' },
        end: { unit: 'px', category: 'Navigation' },
        bidirectional: { category: 'Navigation', tooltip: 'Whether it can be taken both ways — a drop off a ledge cannot.' },
        radius: { min: 1, unit: 'px', category: 'Navigation', tooltip: 'How far from each end ground may be and still be joined.' },
        enabled: { category: 'Navigation' },
    },
});
