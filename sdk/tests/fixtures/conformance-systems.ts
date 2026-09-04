// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    conformance-systems.ts
 * @brief   One source, read twice: as closures, and as the module the compiler
 *          makes of it.
 *
 * @details Imported by relative path rather than through `esengine`, because
 *          the same file has to be importable by the suite AND lowerable by the
 *          compiler — which matches `defineSystem` by name, not by where it
 *          came from.
 */
import { defineComponent } from '../../src/ecs/component';
import { defineSystem } from '../../src/ecs/system';
import { Query, Mut } from '../../src/ecs/query';
import { Res, Time } from '../../src/ecs/resource';

export const Mover = defineComponent('ConfMover', { x: 0, speed: 0, bounces: 0 });

/**
 * @compiled
 */
export const driftSystem = defineSystem(
    [Query(Mut(Mover)), Res(Time)],
    (query, time) => {
        for (const [, m] of query) {
            m.x = m.x + m.speed * time.delta;
        }
    },
    { name: 'ConfDrift' },
);

/**
 * @compiled
 */
export const clampSystem = defineSystem(
    [Query(Mut(Mover))],
    (query) => {
        for (const [, m] of query) {
            if (m.x > 10) {
                m.x = 10;
                m.speed = -m.speed;
                m.bounces = m.bounces + 1;
            } else if (m.x < -10) {
                m.x = -10;
                m.speed = -m.speed;
                m.bounces = m.bounces + 1;
            }
        }
    },
    { name: 'ConfClamp' },
);
