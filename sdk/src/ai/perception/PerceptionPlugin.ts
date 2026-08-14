// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PerceptionPlugin.ts
 * @brief   Writes each Perceiver's view of the nearest visible PerceptionTarget
 *          into its Perception component. Runs in PreUpdate (before FSM/BT), so a
 *          decision system reads a fresh Perception the same frame.
 *
 *          `stepPerception` is extracted to unit-test against a fake world. Line
 *          of sight uses a physics raycast when a Physics is present, and is
 *          skipped (range + FOV only) otherwise — no hard physics dependency.
 */

import type { App, Plugin } from '../../app/app';
import type { Entity } from '../../types';
import { defineSystem, Schedule, GetWorld } from '../../ecs/system';
import { playModeOnly } from '../../ecs/env';
import { Transform } from '../../ecs/component';
import type { AnyComponentDef, ComponentData } from '../../ecs/component';
import { Physics, type PhysicsAPI } from '../../physics';
import { senseTarget, facingFromQuat } from './sense';
import { Perceiver, Perception, PerceptionTarget, type PerceptionData } from './components';

/** The slice of `World` the perception step needs — lets tests inject a fake. */
export interface PerceptionWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): readonly Entity[];
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
    has(entity: Entity, component: AnyComponentDef): boolean;
    insert<C extends AnyComponentDef>(entity: Entity, component: C, data?: Partial<ComponentData<C>>): unknown;
}

/**
 * True when the line from (ox,oy) to (tx,ty) is occluded. `observer` and
 * `target` are the two bodies at its ends — whatever they own is not what the
 * check is asking about.
 */
export type LosCheck = (
    ox: number, oy: number, tx: number, ty: number,
    observer: Entity, target: Entity,
) => boolean;

/** Update every Perceiver's Perception with the nearest visible target. */
export function stepPerception(world: PerceptionWorldView, isBlocked?: LosCheck): void {
    const targets = world.getEntitiesWithComponents([PerceptionTarget, Transform]).map(e => {
        const t = world.get(e, Transform);
        return { e, x: t.position.x, y: t.position.y };
    });

    for (const e of world.getEntitiesWithComponents([Perceiver, Transform])) {
        const cfg = world.get(e, Perceiver);
        const tf = world.get(e, Transform);
        const ox = tf.position.x;
        const oy = tf.position.y;
        const facing = facingFromQuat(tf.rotation.z, tf.rotation.w);
        const halfFov = ((cfg.fovDegrees * Math.PI) / 180) / 2;

        let best: { x: number; y: number; distance: number; dirX: number; dirY: number } | null = null;
        for (const t of targets) {
            if (t.e === e) continue;
            const r = senseTarget(ox, oy, facing, t.x, t.y, cfg.range, halfFov,
                isBlocked && ((ax, ay, bx, by) => isBlocked(ax, ay, bx, by, e, t.e)));
            if (r.visible && (!best || r.distance < best.distance)) {
                best = { x: t.x, y: t.y, distance: r.distance, dirX: r.dirX, dirY: r.dirY };
            }
        }

        const p: PerceptionData = best
            ? { visible: true, distance: best.distance, targetX: best.x, targetY: best.y, dirX: best.dirX, dirY: best.dirY }
            : { visible: false, distance: 0, targetX: 0, targetY: 0, dirX: 0, dirY: 0 };

        if (world.has(e, Perception)) world.set(e, Perception, p);
        else world.insert(e, Perception, p);
    }
}

/**
 * Raycast-backed line of sight: occluded by anything hit before the target that
 * is not one of the two bodies at the ends. A character's collider sits at its
 * feet, so a ray aimed at the origin passes through the target's own capsule —
 * counting that hides everyone approached from below.
 */
export function makeLosCheck(physics: PhysicsAPI): LosCheck {
    return (ox, oy, tx, ty, observer, target) => {
        const dx = tx - ox;
        const dy = ty - oy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return false;
        const hits = physics.raycast({ x: ox, y: oy }, { x: dx / dist, y: dy / dist }, dist);
        return hits.some(h => h.fraction < 0.98 && h.entity !== observer && h.entity !== target);
    };
}

export class PerceptionPlugin implements Plugin {
    name = 'perception';

    build(app: App): void {
        app.addSystemToSchedule(
            Schedule.PreUpdate,
            // system-access: senses whatever a project's perception graph names.
            defineSystem(
                [GetWorld()],
                world => {
                    const physics = app.hasResource(Physics) ? app.getResource<PhysicsAPI>(Physics) : null;
                    stepPerception(world as PerceptionWorldView, physics ? makeLosCheck(physics) : undefined);
                },
                { name: 'PerceptionSystem' },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const perceptionPlugin = new PerceptionPlugin();
