// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    follow.ts
 * @brief   Kinematic path following — pure, unit-testable movement integration.
 */

import type { Vec3 } from '../../types';

/**
 * Advance `pos` up to `distance` pixels along the waypoint chain starting at
 * `startIndex`, snapping onto each reached waypoint so a single frame can cross
 * several. Mutates `pos` in place. Returns the new waypoint index — a value
 * `>= waypoints.length` means the end was reached.
 *
 * The walk is three-dimensional: a route over sloped ground is longer than its
 * shadow, and spending the frame's budget on the shadow walks an agent up a hill
 * faster than it walks along the flat. On a flat grid every waypoint shares one
 * third axis and the arithmetic is what it always was.
 */
export function advanceAlongPath(
    pos: Vec3,
    waypoints: Vec3[],
    startIndex: number,
    distance: number,
): number {
    let index = startIndex;
    let remaining = distance;
    while (remaining > 0 && index < waypoints.length) {
        const wp = waypoints[index];
        const dx = wp.x - pos.x;
        const dy = wp.y - pos.y;
        const dz = wp.z - pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist === 0) {
            // Already on this waypoint; step to the next without consuming budget.
            index++;
            continue;
        }
        if (dist <= remaining) {
            pos.x = wp.x;
            pos.y = wp.y;
            pos.z = wp.z;
            remaining -= dist;
            index++;
        } else {
            pos.x += (dx / dist) * remaining;
            pos.y += (dy / dist) * remaining;
            pos.z += (dz / dist) * remaining;
            remaining = 0;
        }
    }
    return index;
}
