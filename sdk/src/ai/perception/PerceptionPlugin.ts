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
import { Physics3D } from '../../physics3d/Physics3DPlugin';
import type { Physics3DQueries } from '../../physics3d/Physics3DQueries';
import { senseTarget, facingFromRotation } from './sense';
import type { Vec3 } from '../../types';
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
 * True when the line from `from` to `to` is occluded. `observer` and `target`
 * are the two bodies at its ends — whatever they own is not what the check is
 * asking about. `layers` is the 3D layer mask the caller wants cast against
 * (0 = every layer); a 2D check has no layers and ignores it.
 */
export type LosCheck = (
    from: Vec3, to: Vec3,
    observer: Entity, target: Entity,
    layers: number,
) => boolean;

/** Update every Perceiver's Perception with the nearest visible target. */
export function stepPerception(world: PerceptionWorldView, isBlocked?: LosCheck): void {
    const targets = world.getEntitiesWithComponents([PerceptionTarget, Transform]).map(e => {
        const t = world.get(e, Transform);
        return { e, at: t.position as Vec3 };
    });

    for (const e of world.getEntitiesWithComponents([Perceiver, Transform])) {
        const cfg = world.get(e, Perceiver);
        const tf = world.get(e, Transform);
        const at = tf.position as Vec3;
        const facing = facingFromRotation(tf.rotation, cfg.facingAxis);
        const halfFov = ((cfg.fovDegrees * Math.PI) / 180) / 2;

        let best: { at: Vec3; distance: number; dir: Vec3 } | null = null;
        for (const t of targets) {
            if (t.e === e) continue;
            const r = senseTarget(at, facing, t.at, cfg.range, halfFov,
                isBlocked && ((from, to) => isBlocked(from, to, e, t.e, cfg.losLayers)));
            if (r.visible && (!best || r.distance < best.distance)) {
                best = { at: t.at, distance: r.distance, dir: r.dir };
            }
        }

        const p: PerceptionData = best
            ? {
                visible: true, distance: best.distance,
                targetX: best.at.x, targetY: best.at.y, targetZ: best.at.z,
                dirX: best.dir.x, dirY: best.dir.y, dirZ: best.dir.z,
            }
            : { visible: false, distance: 0, targetX: 0, targetY: 0, targetZ: 0, dirX: 0, dirY: 0, dirZ: 0 };

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
    return (from, to, observer, target) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return false;
        const hits = physics.raycast({ x: from.x, y: from.y }, { x: dx / dist, y: dy / dist }, dist);
        return hits.some(h => h.fraction < 0.98 && h.entity !== observer && h.entity !== target);
    };
}

/**
 * The same check through the 3D solver, which answers with the NEAREST body
 * rather than every body on the line: a ray starting inside the observer's own
 * collider reports the observer and nothing behind it, and this has to read that
 * as "not blocked". `Perceiver.losLayers` is how a scene avoids the question.
 */
export function makeLosCheck3D(queries: Physics3DQueries): LosCheck {
    return (from, to, observer, target, layers) => {
        const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        if (dir.x === 0 && dir.y === 0 && dir.z === 0) return false;
        const hit = queries.raycast(from, dir, layers);
        if (!hit || hit.entity === observer || hit.entity === target) return false;
        return hit.fraction < 0.98;
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
                    // The 3D solver first where a scene has one: its bodies are the
                    // walls of a 3D scene, and the 2D one knows nothing about them.
                    const q3d = app.hasResource(Physics3D)
                        ? app.getResource<Physics3DQueries | null>(Physics3D) : null;
                    const physics = app.hasResource(Physics) ? app.getResource<PhysicsAPI>(Physics) : null;
                    const los = q3d ? makeLosCheck3D(q3d) : physics ? makeLosCheck(physics) : undefined;
                    stepPerception(world as PerceptionWorldView, los);
                },
                {
                    name: 'PerceptionSystem',
                    // The World is for the cross-entity sweep (every target against
                    // every perceiver), not for reach beyond these four.
                    touches: {
                        reads: [Perceiver._name, PerceptionTarget._name, Transform._name],
                        writes: [Perception._name],
                    },
                },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const perceptionPlugin = new PerceptionPlugin();
