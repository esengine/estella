// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Stamina.ts
 * @brief   What a character has left to run, roll and swing with.
 *
 * @details One pool every costly action draws on, so a fight is a choice of how to
 *          spend it: a roll, a swing and a sprint all come out of the same bar, and
 *          the bar comes back only after a moment of doing none of them.
 *
 *          An action is allowed while anything is left and takes the bar to empty
 *          at worst. A rule that refused a roll short of its full cost would leave
 *          the player watching a bar that is nearly enough; the last roll out of an
 *          empty bar is what this kind of game feels like.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

/** The fields of the `Stamina` component. @experimental */
export interface StaminaData {
    /** What is left. */
    current: number;
    /** A full bar. */
    max: number;
    /** How fast it comes back, per second. */
    regen: number;
    /** Seconds after the last spend before it starts to come back. */
    regenDelay: number;
    /** Engine-written: seconds until it starts to come back. */
    cooldown: number;
}

/**
 * The pool a character's costly actions draw on: a ThirdPersonController's sprint, dodge, attack and jump, a
 * PlatformerController2D's dash. Without it those actions cost nothing.
 *
 * @experimental
 */
export const Stamina: ComponentDef<StaminaData> = defineComponent<StaminaData>('Stamina', {
    current: 100,
    max: 100,
    regen: 26,
    regenDelay: 0.7,
    cooldown: 0,
}, {
    readonlyFields: ['cooldown'],
    fields: {
        current: { min: 0 },
        max: { min: 0 },
        regen: { min: 0, unit: '/s', tooltip: 'How fast the bar comes back.' },
        regenDelay: { min: 0, step: 0.05, unit: 's', tooltip: 'How long after the last spend before it starts to come back.' },
        cooldown: { advanced: true },
    },
});

/**
 * Take @p amount from @p entity's stamina for an action it asked for. False, and nothing taken, when the bar is empty:
 * the action is refused. An entity without Stamina pays nothing and is always allowed.
 *
 * @experimental
 */
export function spendStamina(world: World, entity: Entity, amount: number): boolean {
    if (!world.has(entity, Stamina)) return true;
    const pool = world.get(entity, Stamina) as StaminaData;
    if (pool.current <= 0) return false;
    if (amount <= 0) return true;
    world.update(entity, Stamina, (s: StaminaData) => {
        s.current = Math.max(0, s.current - amount);
        s.cooldown = s.regenDelay;
    });
    return true;
}

/**
 * Bring every bar back by @p dt seconds: the wait after a spend first, then `regen` a second up to `max`.
 *
 * @experimental
 */
export function regenerateStamina(world: World, dt: number): void {
    if (dt <= 0) return;
    for (const entity of world.getEntitiesWithComponents([Stamina])) {
        const pool = world.get(entity, Stamina) as StaminaData;
        if (pool.current >= pool.max && pool.cooldown <= 0) continue;
        world.update(entity, Stamina, (s: StaminaData) => {
            const waited = Math.min(dt, Math.max(0, s.cooldown));
            s.cooldown = Math.max(0, s.cooldown - dt);
            s.current = Math.min(s.max, s.current + s.regen * (dt - waited));
        });
    }
}
