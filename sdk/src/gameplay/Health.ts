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
 *          Going back UP is the same author's other verb. A respawn that reset
 *          the field itself would be a second one, and then "how much is left"
 *          has two answers whenever they disagree.
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
    /** Seconds after a blow lands that no other does: the blink a platformer gives a hit player. 0 = none. */
    graceTime?: number;
    /**
     * Damage it takes inside `poiseRecovery` seconds before a blow staggers it: the animator hears `stagger` and a
     * Hunter loses the swing it was winding up. 0 = never staggers.
     */
    poise?: number;
    /** Seconds a full poise takes to come back after the last blow. */
    poiseRecovery?: number;
    /** Engine-written: seconds no blow lands on it (the grace after a hit). */
    invulnerable?: number;
    /** Engine-written: damage taken toward a stagger, falling back to 0 over `poiseRecovery`. */
    stagger?: number;
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
    graceTime: 0,
    poise: 0,
    poiseRecovery: 2,
    invulnerable: 0,
    stagger: 0,
}, {
    readonlyFields: ['invulnerable', 'stagger'],
    fields: {
        current: { min: 0 },
        max: { min: 0 },
        graceTime: { min: 0, step: 0.05, unit: 's', tooltip: 'After a blow lands, how long no other does. 0 = none.' },
        poise: { min: 0, tooltip: 'Damage it takes, all within the recovery time, before a blow staggers it. 0 = never staggers.' },
        poiseRecovery: { min: 0, step: 0.1, unit: 's', advanced: true, tooltip: 'How long a full poise takes to come back after the last blow.' },
        invulnerable: { advanced: true },
        stagger: { advanced: true },
    },
});

/** What a round of blows did: those that landed, and who they staggered. @experimental */
export interface DamageOutcome {
    landed: DamagePayload[];
    staggered: Entity[];
}

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
/**
 * Put an entity back to full. The other half of this seam: a respawn restores
 * what a blow took, and neither reaches into the field itself.
 *
 * `max` is the whole policy — there is no second notion of "full" to invent, and
 * a caller that wants some other number wants a rule this seam does not have.
 *
 * @experimental
 */
export function restoreToFull(world: World, entity: Entity): void {
    if (!world.valid(entity) || !world.has(entity, Health)) return;
    world.update(entity, Health, (h: HealthData) => { h.current = h.max; });
}

export function applyDamage(
    world: World, blows: Iterable<DamagePayload>, shielded: ((entity: Entity) => boolean) | null = null,
): DamageOutcome {
    const outcome: DamageOutcome = { landed: [], staggered: [] };
    for (const blow of blows) {
        if (!world.valid(blow.target) || !world.has(blow.target, Health)) continue;
        const health = world.get(blow.target, Health) as HealthData;
        if (health.current <= 0) continue;
        // Untouchable: in the grace after a hit, or in frames its animation declared so (a dodge).
        if ((health.invulnerable ?? 0) > 0 || shielded?.(blow.target)) continue;
        let staggered = false;
        world.update(blow.target, Health, (h: HealthData) => {
            h.current = Math.max(0, h.current - blow.amount);
            if ((h.graceTime ?? 0) > 0) h.invulnerable = h.graceTime;
            const poise = h.poise ?? 0;
            if (poise > 0 && h.current > 0) {
                h.stagger = (h.stagger ?? 0) + blow.amount;
                if (h.stagger >= poise) { h.stagger = 0; staggered = true; }
            }
        });
        outcome.landed.push(blow);
        if (staggered) outcome.staggered.push(blow.target);
    }
    return outcome;
}

/**
 * Run the clocks of every Health by @p dt seconds: the grace after a hit runs out, and poise comes back.
 *
 * @experimental
 */
export function tickHealth(world: World, dt: number): void {
    if (dt <= 0) return;
    for (const entity of world.getEntitiesWithComponents([Health])) {
        const health = world.get(entity, Health) as HealthData;
        if (!((health.invulnerable ?? 0) > 0) && !((health.stagger ?? 0) > 0)) continue;
        world.update(entity, Health, (h: HealthData) => {
            h.invulnerable = Math.max(0, (h.invulnerable ?? 0) - dt);
            const recovery = h.poiseRecovery ?? 0;
            h.stagger = recovery > 0 ? Math.max(0, (h.stagger ?? 0) - (h.poise ?? 0) * dt / recovery) : 0;
        });
    }
}
