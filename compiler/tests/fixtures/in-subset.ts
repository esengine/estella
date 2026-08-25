// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    in-subset.ts
 * @brief   A system using everything the subset gained after moveSystem.
 *
 * @details Locals, if / else-if / else, comparisons, && and !. Held against node
 *          by conformance.test.ts — a feature the frontend lowers but nobody
 *          runs both ways is a feature nobody has checked.
 */
import { defineComponent, defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';

export const Drift = defineComponent('FixtureDrift', { rate: 40, wrap: 100, enabled: true });

export const driftSystem = defineSystem(
    [Query(Mut(Transform), Drift), Res(Time)],
    (query, time) => {
        for (const [_entity, transform, drift] of query) {
            const step = drift.rate * time.delta;
            const nx = transform.position.x + step;
            const fast = drift.rate > 50;
            if (nx > drift.wrap) {
                transform.position.x = nx - drift.wrap * 2;
            } else if (nx < -drift.wrap && drift.enabled) {
                transform.position.x = nx + drift.wrap * 2;
            } else {
                transform.position.x = nx;
            }
            if (!fast && drift.enabled) {
                transform.position.y += step * 0.5;
            }
        }
    },
    { name: 'FixtureDrift' },
);

export const Clamp = defineComponent('FixtureClamp', { lo: -50, hi: 50, push: 30 });

/** Ternaries and the exactly-specified half of Math. */
export const clampSystem = defineSystem(
    [Query(Mut(Transform), Clamp), Res(Time)],
    (query, time) => {
        for (const [, transform, clamp] of query) {
            const dx = clamp.push * time.delta;
            const nx = transform.position.x + (transform.position.x < 0 ? dx : -dx);
            transform.position.x = Math.min(Math.max(nx, clamp.lo), clamp.hi);
            transform.position.y = Math.abs(nx) > 10 ? Math.sqrt(Math.abs(nx)) : 0;
        }
    },
    { name: 'FixtureClampSys' },
);
