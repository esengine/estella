// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    follow.ts
 * @brief   Kinematic path following — pure, unit-testable movement integration.
 */

import type { Vec2 } from '../../types';

/**
 * Advance `pos` up to `distance` pixels along the waypoint chain starting at
 * `startIndex`, snapping onto each reached waypoint so a single frame can cross
 * several. Mutates `pos` in place. Returns the new waypoint index — a value
 * `>= waypoints.length` means the end was reached.
 */
export function advanceAlongPath(
    pos: Vec2,
    waypoints: Vec2[],
    startIndex: number,
    distance: number,
): number {
    let index = startIndex;
    let remaining = distance;
    while (remaining > 0 && index < waypoints.length) {
        const wp = waypoints[index];
        const dx = wp.x - pos.x;
        const dy = wp.y - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) {
            // Already on this waypoint; step to the next without consuming budget.
            index++;
            continue;
        }
        if (dist <= remaining) {
            pos.x = wp.x;
            pos.y = wp.y;
            remaining -= dist;
            index++;
        } else {
            pos.x += (dx / dist) * remaining;
            pos.y += (dy / dist) * remaining;
            remaining = 0;
        }
    }
    return index;
}
