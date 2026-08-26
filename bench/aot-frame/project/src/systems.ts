// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The project the frame benchmark measures — one file, run two ways.
 *
 * Both bodies move a real engine `Transform`, because that is what a game does
 * and it is the address path that costs: an engine component's bytes come from
 * the C++ pools through the bridge, once per row per frame.
 *
 * Thin and thick bracket the answer from both sides (bench/aot-stage0 found the
 * same): a thin body is nearly all loop overhead, which is where an interpreter
 * is worst and compiled code best; a thick one dilutes that with arithmetic both
 * sides pay for.
 */
import { defineComponent, defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';

export const Mover = defineComponent('BenchMover', { dx: 0, dy: 0, speed: 0, boost: 0 });

/**
 * Three multiply-adds per entity.
 *
 * @compiled
 */
export const thinSystem = defineSystem(
    [Query(Mut(Transform), Mover), Res(Time)],
    (query, time) => {
        for (const [, transform, mover] of query) {
            transform.position.x += mover.dx * mover.speed * time.delta;
            transform.position.y += mover.dy * mover.speed * time.delta;
        }
    },
    { name: 'BenchThin' },
);

/**
 * Four substeps with a bounce test each, unrolled — the subset has no loop but
 * `rowLoop`. Its weight separates the cost of a BODY from the cost of handing
 * the row over: if compiled time barely moves between thin and this, what a
 * compiled system costs is not its code.
 *
 * @compiled
 */
export const heavySystem = defineSystem(
    [Query(Mut(Transform), Mover), Res(Time)],
    (query, time) => {
        for (const [, transform, mover] of query) {
            const step = time.delta * 0.25;
            let x = transform.position.x;
            let y = transform.position.y;
            let vx = mover.dx * mover.speed;
            let vy = mover.dy * mover.speed;

            x = x + vx * step;
            y = y + vy * step;
            let d = Math.sqrt(x * x + y * y);
            if (d > 1000) { vx = -vx; vy = -vy; x = x * (1000 / d); y = y * (1000 / d); }

            x = x + vx * step;
            y = y + vy * step;
            d = Math.sqrt(x * x + y * y);
            if (d > 1000) { vx = -vx; vy = -vy; x = x * (1000 / d); y = y * (1000 / d); }

            x = x + vx * step;
            y = y + vy * step;
            d = Math.sqrt(x * x + y * y);
            if (d > 1000) { vx = -vx; vy = -vy; x = x * (1000 / d); y = y * (1000 / d); }

            x = x + vx * step;
            y = y + vy * step;
            d = Math.sqrt(x * x + y * y);
            if (d > 1000) { vx = -vx; vy = -vy; x = x * (1000 / d); y = y * (1000 / d); }

            transform.position.x = x;
            transform.position.y = y;
            transform.position.z = Math.sqrt(vx * vx + vy * vy) * 0.001;
        }
    },
    { name: 'BenchHeavy' },
);

/**
 * A body with branches, clamps and a square root — the shape of gameplay code
 * rather than of a loop.
 *
 * @compiled
 */
export const thickSystem = defineSystem(
    [Query(Mut(Transform), Mover), Res(Time)],
    (query, time) => {
        for (const [, transform, mover] of query) {
            const dt = time.delta;
            const speed = mover.boost > 0 ? mover.speed * 2 : mover.speed;
            let x = transform.position.x + mover.dx * speed * dt;
            let y = transform.position.y + mover.dy * speed * dt;
            if (x > 1000 || x < -1000) {
                x = Math.max(-1000, Math.min(1000, x));
            }
            if (y > 1000 || y < -1000) {
                y = Math.max(-1000, Math.min(1000, y));
            }
            transform.position.x = x;
            transform.position.y = y;
            transform.position.z = Math.sqrt(x * x + y * y) * 0.001;
        }
    },
    { name: 'BenchThick' },
);
