// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Health.ts
 * @brief   What a blow is, and the one place it lands.
 *
 * @details A blow travels as a REQUEST on the {@link Damage} bus and one system
 *          answers it. Nothing else writes `Health` — not the thing that swung,
 *          not the physics query that found a body — so "how much is left" has a
 *          single author, and every rule that will ever sit between a hit and a
 *          health bar (armour, invulnerability, a shield) has one seam to sit in
 *          rather than an inlined subtraction to be found and edited.
 *
 *          The bus is double buffered, so a blow sent this frame lands on the
 *          next. That is one frame between the animation's hit moment and the
 *          number changing, and it buys a combat system that never reaches into
 *          the thing it hit.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { defineEvent, type EventDef } from '../ecs/event';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

/** The fields of the `Health` component. @experimental */
export interface HealthData {
    current: number;
    max: number;
}

/**
 * What something has left. Presence is also what makes an entity DAMAGEABLE: a
 * combat query finds colliders, and the floor is one of them.
 *
 * @experimental
 */
export const Health: ComponentDef<HealthData> = defineComponent<HealthData>('Health', {
    current: 100,
    max: 100,
}, {
    fields: {
        current: { min: 0 },
        max: { min: 0 },
    },
});

/**
 * One blow, on its way to whoever it lands on.
 *
 * The point it landed at travels with it because presentation needs it and
 * cannot recover it: by the time a spark is drawn, the swing has moved on.
 *
 * @experimental
 */
export interface DamagePayload {
    target: Entity;
    /** Who dealt it, so a blow cannot be traced back to nobody. */
    source: Entity;
    amount: number;
    x: number;
    y: number;
    z: number;
}

/**
 * The bus every blow travels on. Send it to deal damage; read it to answer one
 * (a spark, a sound, a hit reaction).
 *
 * @experimental
 */
export const Damage: EventDef<DamagePayload> = defineEvent<DamagePayload>('Damage', {
    target: 0 as Entity, source: 0 as Entity, amount: 0, x: 0, y: 0, z: 0,
});

/**
 * Land every blow in `blows`. The ONLY writer of `Health` — a blow aimed at
 * something that has none, or at something already down, is simply not applied.
 */
export function applyDamage(world: World, blows: Iterable<DamagePayload>): void {
    for (const blow of blows) {
        if (!world.valid(blow.target) || !world.has(blow.target, Health)) continue;
        const health = world.get(blow.target, Health) as HealthData;
        if (health.current <= 0) continue;
        world.update(blow.target, Health, (h: HealthData) => {
            h.current = Math.max(0, h.current - blow.amount);
        });
    }
}
