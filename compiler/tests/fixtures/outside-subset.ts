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

/** A branch: no control flow beyond the row loop is lowered yet. */
export const branching = defineSystem(
    [Query(Mut(Transform), Speed)],
    (query) => {
        for (const [_e, t, s] of query) {
            if (s.value > 0) {
                t.position.x += s.value;
            }
        }
    },
    { name: 'FixtureBranching' },
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

/** A call: nothing outside the intrinsics is reachable from a compiled system. */
export const calling = defineSystem(
    [Query(Mut(Transform), Speed), Res(Time)],
    (query, time) => {
        for (const [_e, t, s] of query) {
            t.position.x += Math.sin(s.value) * time.delta;
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
