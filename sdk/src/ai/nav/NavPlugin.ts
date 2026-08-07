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
import { Navigation, Nav } from './Navigation';
import { NavAgent } from './NavAgent';
import { advanceAlongPath } from './follow';

/** Per-entity runtime path state, owned by the driving system (not serialized). */
export interface AgentRuntime {
    waypoints: import('../../types').Vec2[];
    index: number;
    plannedX: number;
    plannedY: number;
    repathTimer: number;
    reachable: boolean;
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

        const targetMoved = !rt || rt.plannedX !== agent.targetX || rt.plannedY !== agent.targetY;
        const timerElapsed = rt ? (rt.repathTimer -= dt) <= 0 : false;
        if (!rt || targetMoved || (agent.repathInterval > 0 && timerElapsed)) {
            const path = nav.findWorldPath(
                { x: tf.position.x, y: tf.position.y },
                { x: agent.targetX, y: agent.targetY },
            );
            rt = {
                waypoints: path ?? [],
                // Skip the start cell center to avoid backtracking toward it.
                index: path && path.length > 1 ? 1 : 0,
                plannedX: agent.targetX,
                plannedY: agent.targetY,
                repathTimer: agent.repathInterval,
                reachable: path !== null,
            };
            runtimes.set(entity, rt);
        }

        // Keep an unreachable agent's runtime for throttled retry (next target
        // change or repath timer) rather than churning it every frame.
        if (!rt.reachable) continue;

        const pos = { x: tf.position.x, y: tf.position.y };
        rt.index = advanceAlongPath(pos, rt.waypoints, rt.index, agent.speed * dt);
        tf.position.x = pos.x;
        tf.position.y = pos.y;
        world.set(entity, Transform, tf);

        if (rt.index >= rt.waypoints.length) {
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

        const runtimes = new Map<Entity, AgentRuntime>();
        app.world.onDespawn((entity: Entity) => runtimes.delete(entity));

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Nav), Res(Time), GetWorld()],
                (nav: Navigation, time: TimeData, world) => {
                    stepNavigation(world as NavWorldView, nav, time.delta, runtimes);
                },
                { name: 'NavAgentSystem' },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const navPlugin = new NavPlugin();
