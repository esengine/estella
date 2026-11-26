// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    effectLifetime.ts
 * @brief   A one-shot effect that removes itself: the entity and everything under it go once it has run its course.
 *
 * @details An explosion spawned where a fireball hits plays once, and then its emitters sit empty and its light dark, an
 *          entity per hit for as long as the game runs, unless something removes them. The game knows when it spawned one,
 *          not when it is over; the effect does. Counted in the game's own time from when the entity first runs, so a paused
 *          game or a slowed one keeps it as long as its particles take, and only in a running game: the editor never deletes
 *          an entity of the scene being edited.
 */
import { defineComponent, type ComponentDef } from '../ecs/component';

/** The fields of the `EffectLifetime` component. @experimental */
export interface EffectLifetimeData {
    /** Seconds from when it first runs until it and its children are removed. */
    seconds: number;
}

/** @experimental */
export const EffectLifetime: ComponentDef<EffectLifetimeData> = defineComponent<EffectLifetimeData>('EffectLifetime', {
    seconds: 5,
}, {
    fields: {
        seconds: {
            min: 0, unit: 's',
            tooltip: 'Seconds after it first runs in the game until it and everything under it is removed: a one-shot effect that cleans up after itself. Only a running game removes it.',
        },
    },
});

/** How long each entity with an EffectLifetime has run, by entity; what the particle plugin's system advances. */
export function advanceLifetimes(
    ages: Map<number, number>,
    present: readonly number[],
    seconds: (entity: number) => number,
    delta: number,
): number[] {
    const due: number[] = [];
    const seen = new Set(present);
    for (const e of ages.keys()) if (!seen.has(e)) ages.delete(e);
    for (const e of present) {
        const age = (ages.get(e) ?? -delta) + delta;
        ages.set(e, age);
        if (age >= seconds(e)) due.push(e);
    }
    return due;
}
