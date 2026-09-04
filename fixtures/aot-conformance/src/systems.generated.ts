// GENERATED from sdk/tests/fixtures/conformance-systems.ts — do not edit.
// The same systems, with the imports a PROJECT writes. Regenerate with
// ESTELLA_AOT_WRITE=1 pnpm --filter @estella/sdk test aot-conformance.
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
import { defineComponent, defineSystem, Query, Mut, defineEvent, EventReader, EventWriter, Commands, Res, ResMut, Time, defineResource } from 'esengine';

export const Mover = defineComponent('ConfMover', { x: 0, speed: 0, bounces: 0 });

/** A resource the compiled code WRITES. A ResMut lands in the mirror and
 *  nowhere else, so it is in the world only if the road copied it back. */
export const Tally = defineResource({ bounces: 0, frames: 0, census: 0 }, 'ConfTally');

/** A second population, so the road that despawns never touches the rows the
 *  C++ harness models. */
export const Doomed = defineComponent('ConfDoomed', { ttl: 0 });

/** The payload is a VALUE, because a compiled system reads its layout. */
export const Bounced = defineEvent<{ amount: number }>('ConfBounced', { amount: 0 });

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

/**
 * @compiled
 */
export const tallySystem = defineSystem(
    [Query(Mover), ResMut(Tally)],
    (query, tally) => {
        tally.modify((t) => {
            t.frames = t.frames + 1;
        });
        for (const [, m] of query) {
            tally.modify((t) => {
                t.bounces = t.bounces + m.bounces;
            });
        }
    },
    { name: 'ConfTally' },
);

/**
 * @compiled
 */
export const announceSystem = defineSystem(
    [Query(Mover), EventWriter(Bounced)],
    (query, out) => {
        for (const [, m] of query) {
            if (m.bounces > 0) out.send({ amount: 1 });
        }
    },
    { name: 'ConfAnnounce' },
);

/**
 * @compiled
 */
export const absorbSystem = defineSystem(
    [EventReader(Bounced), Query(Mut(Doomed))],
    (hits, query) => {
        for (const h of hits) {
            for (const [, d] of query) {
                d.ttl = d.ttl + h.amount;
            }
        }
    },
    { name: 'ConfAbsorb' },
);

/**
 * @compiled
 */
export const reapSystem = defineSystem(
    [Query(Mut(Doomed)), Commands()],
    (query, cmds) => {
        for (const [e, d] of query) {
            if (d.ttl >= 8) cmds.despawn(e);
        }
    },
    { name: 'ConfReap' },
);

/**
 * A compiled query over rows that LEAVE, which is the only way the cached row
 * table is ever invalidated. A road reusing last frame's addresses walks a slot
 * nothing owns any more and this number stops agreeing.
 *
 * @compiled
 */
export const censusSystem = defineSystem(
    [Query(Doomed), ResMut(Tally)],
    (query, tally) => {
        for (const [, d] of query) {
            tally.modify((t) => {
                t.census = t.census + d.ttl + 1;
            });
        }
    },
    { name: 'ConfCensus' },
);
