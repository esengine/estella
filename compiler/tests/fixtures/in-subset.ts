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
import {
    defineComponent, defineEvent, defineSystem, EventReader, EventWriter,
    exact, Query, Mut, Res, Camera, Input, Time, Transform,
} from 'esengine';

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
            // `Math.PI` folds like a module constant does, and for the same
            // reason: the spec pins it to one double. `Math.sin` does not.
            const step = drift.rate * time.delta * TUNING.damping * (Math.PI / Math.SQRT2);
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

// The shape examples/camera-follow writes: a module-level pure helper called
// once per row. It must not still be a call after the inline pass.
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
function boost(v: number, on: boolean): number {
    return on ? v * 2 : v;
}

export const helperSystem = defineSystem(
    [Query(Mut(Transform), Drift), Res(Time)],
    (query, time) => {
        for (const [, transform, drift] of query) {
            const step = boost(drift.rate * time.delta, drift.enabled);
            transform.position.x = clamp(transform.position.x + step, -80, 80);
            transform.position.y = clamp(boost(step, true), -10, 10);
        }
    },
    { name: 'FixtureHelpers' },
);

// Every exactly-specified Math operation, on the arguments where the C library
// and ECMAScript actually disagree: ties, and the sign of zero. Nothing else in
// the corpus reaches them, and a shim nothing samples is a shim nobody checked.
export const MathProbe = defineComponent('FixtureMathProbe', {
    v: 0, rounded: 0, truncated: 0, ceiled: 0, floored: 0, signum: 0, lo: 0, hi: 0,
});

export const mathSystem = defineSystem(
    [Query(Mut(MathProbe))],
    (query) => {
        for (const [, p] of query) {
            p.rounded = Math.round(p.v);
            p.truncated = Math.trunc(p.v);
            p.ceiled = Math.ceil(p.v);
            p.floored = Math.floor(p.v);
            p.signum = Math.sign(p.v);
            // min/max of a value and its negation: the only way to reach the
            // -0 / +0 rule, which fmin and fmax do not follow.
            p.lo = Math.min(p.v, -p.v);
            p.hi = Math.max(p.v, -p.v);
        }
    },
    { name: 'FixtureMathOps' },
);

/**
 * An ENGINE component, so the offsets and encodings are EHT's rather than
 * anything this compiler chose. `isActive` is ONE byte at 24; read as a float it
 * would take three bytes of `priority` with it. Nothing else in the corpus
 * reaches a bool in a C++ struct.
 */
export const cameraSystem = defineSystem(
    [Query(Mut(Camera)), Res(Time)],
    (query, time) => {
        for (const [, camera] of query) {
            if (camera.isActive) {
                camera.fov = camera.fov + camera.aspectRatio * time.delta;
            } else {
                camera.orthoSize = Math.max(1, camera.orthoSize - time.delta);
            }
            camera.isActive = camera.fov < 90;
        }
    },
    { name: 'FixtureCamera' },
);

/**
 * A SERVICE question, and the three ways out of a row loop. The two sides
 * answer `isKeyDown` differently by construction — the interpreter over live
 * objects calls the method, compiled code reads the bit a host mirrored it
 * into — so agreement here is the only thing that says the mirror is right.
 */
export const gateSystem = defineSystem(
    [Query(Mut(Drift)), Res(Input)],
    (query, input) => {
        if (!input.isKeyDown('KeyW')) return;
        for (const [, d] of query) {
            if (!d.enabled) continue;
            if (d.rate > 110) break;
            d.rate = d.rate + (input.isKeyPressed('Space') ? 2 : 1);
        }
    },
    { name: 'FixtureGate' },
);

/** One payload, and the two halves that put it into memory and take it out. */
export const Pinged = defineEvent<{ by: number }>('FixturePinged', { by: 0 });

export const pingSystem = defineSystem(
    [Query(Mut(Drift)), EventWriter(Pinged)],
    (query, out) => {
        for (const [, d] of query) {
            if (d.enabled) out.send({ by: d.rate });
        }
    },
    { name: 'FixturePing' },
);

export const pongSystem = defineSystem(
    [EventReader(Pinged), Query(Mut(Drift))],
    (pings, query) => {
        let total = 0;
        for (const p of pings) total = total + p.by;
        for (const [, d] of query) {
            d.wrap = total;
        }
    },
    { name: 'FixturePong' },
);

/**
 * Trigonometry the engine specifies. `Math.sin` is refused; this is what a
 * system that wants to compile calls, and the differential is what says the
 * two implementations of it are one implementation.
 */
export const trigSystem = defineSystem(
    [Query(Mut(MathProbe))],
    (query) => {
        for (const [, p] of query) {
            p.rounded = exact.sin(p.v);
            p.truncated = exact.cos(p.v);
            p.ceiled = exact.sin(p.v * 100);
            p.floored = exact.cos(p.v * 100);
        }
    },
    { name: 'FixtureTrig' },
);
