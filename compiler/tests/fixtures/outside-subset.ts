// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    outside-subset.ts
 * @brief   Systems that must NOT compile.
 *
 * @details Each names a rule from REARCH_AOT §3; subset.test.ts asserts the
 *          diagnostic points at the line and says why.
 */
import { defineComponent, defineSystem, Query, Mut, Res, Time, Transform } from 'esengine';

export const Speed = defineComponent('FixtureSpeed', { value: 100 });

/** A loop of its own: only the row loop is lowered. */
export const looping = defineSystem(
    [Query(Mut(Transform), Speed)],
    (query) => {
        for (const [_e, t, s] of query) {
            while (t.position.x < s.value) {
                t.position.x += 1;
            }
        }
    },
    { name: 'FixtureLooping' },
);

/** A field the component does not declare — a typo, caught at compile time. */
export const typoField = defineSystem(
    [Query(Mut(Transform), Speed)],
    (query) => {
        for (const [_e, t, s] of query) {
            t.position.x += s.valeu;
        }
    },
    { name: 'FixtureTypo' },
);

/**
 * A Math operation ECMAScript leaves implementation-defined. Refused on purpose:
 * a native backend and the interpreter would be free to disagree, and a pixel
 * gate would then go red on trig instead of on a bug.
 */
export const trig = defineSystem(
    [Query(Mut(Transform), Speed), Res(Time)],
    (query, time) => {
        for (const [_e, t, s] of query) {
            t.position.x += Math.sin(s.value * time.delta);
        }
    },
    { name: 'FixtureTrig' },
);

// No annotation: the subset takes a parameter's type from the source, and there
// is nothing here to take.
function damp(v): number {
    return v * 0.5;
}

/** A call: nothing outside the intrinsics is reachable from a compiled system. */
export const calling = defineSystem(
    [Query(Mut(Transform), Speed), Res(Time)],
    (query, time) => {
        for (const [_e, t, s] of query) {
            t.position.x += damp(s.value) * time.delta;
        }
    },
    { name: 'FixtureCalling' },
);

/** Writing a component the query did not ask to write. */
export const writesReadOnly = defineSystem(
    [Query(Transform, Speed)],
    (query) => {
        for (const [_e, t, s] of query) {
            t.position.x += s.value;
        }
    },
    { name: 'FixtureWritesReadOnly' },
);

const LIMIT = 42;

/** Assigning to a module constant: it is a value, not storage. */
export const writesConst = defineSystem(
    [Query(Mut(Transform), Speed)],
    (query) => {
        for (const [_e, t, s] of query) {
            t.position.x = LIMIT + s.value;
            LIMIT.foo = 1;
        }
    },
    { name: 'FixtureWritesConst' },
);
