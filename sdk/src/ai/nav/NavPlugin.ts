// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavPlugin.ts
 * @brief   Drives NavAgents: plan-on-demand + kinematic path following.
 *
 * One system, gated to play mode. Per-entity runtime path lives in a closure
 * Map (the `defineBehavior` pattern) so the NavAgent component stays purely
 * authorable/serializable. The per-frame logic is `stepNavigation`, extracted
 * so it unit-tests against a fake world. MVP integrates the Transform directly
 * (kinematic); physics `moveCharacter` avoidance is a later stage
 * (REARCH_GAMEPLAY_AI.md AI4) — the grid path already clears static blockers.
 */

import type { App, Plugin } from '../../app/app';
import type { Entity } from '../../types';
import { defineSystem, Schedule, GetWorld } from '../../ecs/system';
import { Res, Time, type TimeData } from '../../ecs/resource';
import {
    Transform,
    type AnyComponentDef,
    type ComponentData,
} from '../../ecs/component';
import { playModeOnly } from '../../ecs/env';
import {
    Physics3D, Physics3DRuntime, type Physics3DRuntime as Physics3DRuntimeData,
} from '../../physics3d/Physics3DPlugin';
import { log } from '../../util/logger';
import { Navigation, Nav } from './Navigation';
import { NavAgent } from './NavAgent';
import { NavVolume } from './NavVolume';
import { bakeNavGrid, type GroundProbe } from './bakeNavGrid';
import { setupNavDebugDraw } from './NavDebugDraw';
import { advanceAlongPath } from './follow';

/** Per-entity runtime path state, owned by the driving system (not serialized). */
export interface AgentRuntime {
    waypoints: import('../../types').Vec3[];
    index: number;
    plannedX: number;
    plannedY: number;
    plannedZ: number;
    repathTimer: number;
    reachable: boolean;
}

/**
 * Bake the first NavVolume that has not been baked yet, and install its grid.
 * `probe` is null until the caller has a world worth sampling (see the plugin):
 * a bake against a solver with no bodies yet returns a grid of holes, and one
 * bake per volume means it would stay that way.
 */
export function bakeVolumes(
    world: NavWorldView,
    nav: Navigation,
    probe: GroundProbe | null,
    baked: Set<Entity>,
): void {
    if (!probe) return;
    for (const entity of world.getEntitiesWithComponents([NavVolume, Transform])) {
        if (baked.has(entity)) continue;
        const volume = world.get(entity, NavVolume);
        const at = world.get(entity, Transform).position;
        const h = volume.halfExtents;
        nav.setGrid(bakeNavGrid(probe, {
            min: { x: at.x - h.x, y: at.y - h.y, z: at.z - h.z },
            max: { x: at.x + h.x, y: at.y + h.y, z: at.z + h.z },
            cellSize: volume.cellSize,
            maxSlopeDegrees: volume.maxSlopeDegrees,
            agentHeight: volume.agentHeight,
            stepHeight: volume.stepHeight,
            layers: volume.layers,
        }));
        baked.add(entity);
        // Baked once, so a volume that found nothing stays empty: say so rather
        // than leave a scene with agents that never move and no reason given.
        if (!nav.grid?.walkable.some(w => w === 1)) {
            log.warn('nav', `NavVolume on entity ${entity} baked no walkable ground —`
                + ' check that it covers the floor and that `layers` includes it');
        }
        // One grid is installed at a time, so a scene with two volumes would have
        // the last one win. Bake one per frame and let the newest be the active
        // one rather than silently merging boxes that may not touch.
        return;
    }
}

/** The slice of `World` the nav step needs — lets tests inject a fake. */
export interface NavWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): readonly Entity[];
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
}

/**
 * Advance every NavAgent one frame: (re)plan when the target moved or the
 * repath timer elapsed, then follow the path kinematically. `runtimes` carries
 * per-entity path state across frames.
 */
export function stepNavigation(
    world: NavWorldView,
    nav: Navigation,
    dt: number,
    runtimes: Map<Entity, AgentRuntime>,
): void {
    if (dt <= 0) return;

    for (const entity of world.getEntitiesWithComponents([NavAgent, Transform])) {
        const agent = world.get(entity, NavAgent);
        if (!agent.hasTarget) {
            runtimes.delete(entity);
            continue;
        }

        const tf = world.get(entity, Transform);
        let rt = runtimes.get(entity);

        const targetMoved = !rt || rt.plannedX !== agent.targetX || rt.plannedY !== agent.targetY
            || rt.plannedZ !== agent.targetZ;
        const timerElapsed = rt ? (rt.repathTimer -= dt) <= 0 : false;
        if (!rt || targetMoved || (agent.repathInterval > 0 && timerElapsed)) {
            const path = nav.findWorldPath(
                tf.position,
                { x: agent.targetX, y: agent.targetY, z: agent.targetZ },
                { radius: agent.radius },
            );
            rt = {
                waypoints: path ?? [],
                // Skip the start cell center to avoid backtracking toward it.
                index: path && path.length > 1 ? 1 : 0,
                plannedX: agent.targetX,
                plannedY: agent.targetY,
                plannedZ: agent.targetZ,
                repathTimer: agent.repathInterval,
                reachable: path !== null,
            };
            runtimes.set(entity, rt);
        }

        // Keep an unreachable agent's runtime for throttled retry (next target
        // change or repath timer) rather than churning it every frame.
        if (!rt.reachable) continue;

        const pos = { x: tf.position.x, y: tf.position.y, z: tf.position.z };
        rt.index = advanceAlongPath(pos, rt.waypoints, rt.index, agent.speed * dt);
        tf.position.x = pos.x;
        tf.position.y = pos.y;
        tf.position.z = pos.z;
        world.set(entity, Transform, tf);

        // Arrival is a DISTANCE, not the end of the list: an agent that has to
        // stop short of what it is chasing never reaches the last waypoint, and
        // one that walks the path exactly stands on top of its target.
        const goal = rt.waypoints[rt.waypoints.length - 1];
        const withinGoal = goal !== undefined && agent.arriveRadius > 0
            && Math.hypot(goal.x - pos.x, goal.y - pos.y, goal.z - pos.z) <= agent.arriveRadius;
        if (rt.index >= rt.waypoints.length || withinGoal) {
            agent.arrived = true;
            agent.hasTarget = false;
            world.set(entity, NavAgent, agent);
            runtimes.delete(entity);
        }
    }
}

export class NavPlugin implements Plugin {
    name = 'nav';

    build(app: App): void {
        app.insertResource(Nav, new Navigation());
        // Installed with the grid, drawn only once a game turns the resource on —
        // the same bargain the 3D physics overlay makes.
        setupNavDebugDraw(app);

        const runtimes = new Map<Entity, AgentRuntime>();
        const baked = new Set<Entity>();
        app.world.onDespawn((entity: Entity) => {
            runtimes.delete(entity);
            baked.delete(entity);
        });

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Nav), Res(Time), GetWorld()],
                (nav: Navigation, time: TimeData, world) => {
                    // A NavVolume takes its grid from the 3D solver. Waiting for a
                    // BODY, not for the queries resource: that appears when the
                    // module loads, bodies only when it first steps.
                    const runtime = app.hasResource(Physics3DRuntime)
                        ? app.getResource<Physics3DRuntimeData>(Physics3DRuntime) : null;
                    const populated = (runtime?.bodies.size ?? 0) > 0;
                    const probe = populated && app.hasResource(Physics3D)
                        ? app.getResource<GroundProbe | null>(Physics3D) : null;
                    bakeVolumes(world as NavWorldView, nav, probe, baked);
                    stepNavigation(world as NavWorldView, nav, time.delta, runtimes);
                },
                {
                    name: 'NavAgentSystem',
                    touches: {
                        reads: [NavVolume._name],
                        writes: [NavAgent._name, Transform._name],
                    },
                    // Both move an entity; for one carrying both, the path is the
                    // intent and the drift is not, so the follow lands last. The
                    // order registration already produced — declared, not changed.
                    runAfter: ['VelocitySystem'],
                },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const navPlugin = new NavPlugin();
