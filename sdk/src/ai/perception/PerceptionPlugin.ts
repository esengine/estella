// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PerceptionPlugin.ts
 * @brief   Writes each Perceiver's view of the nearest visible PerceptionTarget
 *          into its Perception component. Runs in PreUpdate (before FSM/BT), so a
 *          decision system reads a fresh Perception the same frame.
 *
 *          `stepPerception` is extracted to unit-test against a fake world. Line
 *          of sight uses a physics raycast when a PhysicsAPI is present, and is
 *          skipped (range + FOV only) otherwise — no hard physics dependency.
 */

import type { App, Plugin } from '../../app';
import type { Entity } from '../../types';
import { defineSystem, Schedule, GetWorld } from '../../system';
import { playModeOnly } from '../../env';
import { Transform } from '../../component';
import type { AnyComponentDef, ComponentData } from '../../component';
import { PhysicsAPI, type Physics } from '../../physics';
import { senseTarget, facingFromQuat } from './sense';
import { Perceiver, Perception, PerceptionTarget, type PerceptionData } from './components';

/** The slice of `World` the perception step needs — lets tests inject a fake. */
export interface PerceptionWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): Entity[];
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
    has(entity: Entity, component: AnyComponentDef): boolean;
    insert<C extends AnyComponentDef>(entity: Entity, component: C, data?: Partial<ComponentData<C>>): unknown;
}

export type LosCheck = (ox: number, oy: number, tx: number, ty: number) => boolean;

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
            const r = senseTarget(ox, oy, facing, t.x, t.y, cfg.range, halfFov, isBlocked);
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

/** Build a raycast-backed line-of-sight check. Occluded if anything is hit before the target. */
export function makeLosCheck(physics: Physics): LosCheck {
    return (ox, oy, tx, ty) => {
        const dx = tx - ox;
        const dy = ty - oy;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return false;
        const hits = physics.raycast({ x: ox, y: oy }, { x: dx / dist, y: dy / dist }, dist);
        // A hit clearly short of the target blocks the view (the last ~2% is the target itself).
        return hits.some(h => h.fraction < 0.98);
    };
}

export class PerceptionPlugin implements Plugin {
    name = 'perception';

    build(app: App): void {
        app.addSystemToSchedule(
            Schedule.PreUpdate,
            defineSystem(
                [GetWorld()],
                world => {
                    const physics = app.hasResource(PhysicsAPI) ? app.getResource<Physics>(PhysicsAPI) : null;
                    stepPerception(world as PerceptionWorldView, physics ? makeLosCheck(physics) : undefined);
                },
                { name: 'PerceptionSystem' },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const perceptionPlugin = new PerceptionPlugin();
