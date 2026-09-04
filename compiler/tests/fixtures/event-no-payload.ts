// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    event-no-payload.ts
 * @brief   An event a compiled system reads, declared without a payload value.
 *
 * @details `defineEvent<T>` erases T, so the layout the compiled code bakes in
 *          is one nothing at run time can name. The subset asks for the value.
 */
import { defineComponent, defineEvent, defineSystem, EventReader, EventWriter, Query, Mut } from 'esengine';

export const Mover = defineComponent('NoPayloadMover', { speed: 100 });

/** No second argument: the payload exists only as a type. */
export const Silent = defineEvent<{ amount: number }>('NoPayloadSilent');

/** Declared with one, and so usable. */
export const Loud = defineEvent<{ amount: number }>('NoPayloadLoud', { amount: 0 });

/** The names agree and the ORDER does not, which is every field at another
 *  position — the value says one thing and the type says the other. */
export const Crossed = defineEvent<{ first: number; second: number }>(
    'NoPayloadCrossed', { second: 0, first: 0 });

/**
 * @compiled
 */
export const readsSilent = defineSystem(
    [EventReader(Silent), Query(Mut(Mover))],
    (hits, query) => {
        for (const h of hits) { for (const [, m] of query) { m.speed += h.amount; } }
    },
    { name: 'ReadsSilent' },
);

/**
 * @compiled
 */
export const writesSilent = defineSystem(
    [Query(Mut(Mover)), EventWriter(Silent)],
    (query, out) => {
        for (const [, m] of query) { out.send({ amount: m.speed }); }
    },
    { name: 'WritesSilent' },
);

/**
 * @compiled
 */
export const readsLoud = defineSystem(
    [EventReader(Loud), Query(Mut(Mover))],
    (hits, query) => {
        for (const h of hits) { for (const [, m] of query) { m.speed += h.amount; } }
    },
    { name: 'ReadsLoud' },
);

/**
 * @compiled
 */
export const readsCrossed = defineSystem(
    [EventReader(Crossed), Query(Mut(Mover))],
    (hits, query) => {
        for (const h of hits) { for (const [, m] of query) { m.speed += h.first + h.second; } }
    },
    { name: 'ReadsCrossed' },
);
