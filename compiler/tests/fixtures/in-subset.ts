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

// Module-level literals: values, not storage. A system reading one gets a
// constant folded in, and a local of the same name must still shadow it.
const WRAP = 120;
const TUNING = { damping: 0.9, boost: 2 };

export const tunedSystem = defineSystem(
    [Query(Mut(Transform), Drift), Res(Time)],
    (query, time) => {
        for (const [, transform, drift] of query) {
            const step = drift.rate * time.delta * TUNING.damping;
            const nx = transform.position.x + step * (drift.enabled ? TUNING.boost : 1);
            transform.position.x = nx > WRAP ? nx - WRAP * 2 : nx;
            if (drift.enabled) {
                // Genuinely shadows the module constant: a read of WRAP in here
                // must be the local, not 120.
                const WRAP = drift.rate;
                transform.position.y = WRAP > 100 ? 1 : 0;
            }
        }
    },
    { name: 'FixtureTuned' },
);
