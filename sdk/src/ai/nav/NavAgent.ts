// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavAgent.ts
 * @brief   NavAgent component — the authorable, serializable half of a
 *          pathfinding actor (tuning knobs + destination).
 *
 * The transient runtime path is held by the driving system, not this component,
 * mirroring how `defineBehavior` keeps per-entity runtime state in its system
 * closure rather than in serialized data. Named `NavAgent` (not `Agent`) and
 * with the `*Agent` suffix to stay clear of the UI-owned `StateMachine`.
 */

import { defineComponent } from '../../ecs/component';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';

export interface NavAgentData {
    /** Movement speed in world pixels per second. */
    speed: number;
    /**
     * How wide the body is, in pixels. Planning routes it around anything it
     * would not fit through. 0 routes it as a point, which is what every agent
     * did before this was honoured — so it stays the default, rather than
     * silently re-routing every project that already shipped.
     */
    radius: number;
    /** Stop distance from the final goal, in pixels. */
    arriveRadius: number;
    /** Replan cadence in seconds while moving; 0 = replan only when the target changes. */
    repathInterval: number;
    /** Whether a destination is set. Cleared on arrival or `stopNavAgent`. */
    hasTarget: boolean;
    /** Destination in world pixels. */
    targetX: number;
    targetY: number;
    targetZ: number;
    /** Set true by the system the frame the agent reaches its goal. */
    arrived: boolean;
}

export const NavAgent = defineComponent<NavAgentData>('NavAgent', {
    speed: 120,
    radius: 0,
    arriveRadius: 6,
    repathInterval: 0.5,
    hasTarget: false,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    arrived: false,
}, {
    fields: {
        speed: { min: 0, unit: 'px/s', category: 'Navigation' },
        radius: { min: 0, unit: 'px', category: 'Navigation' },
        arriveRadius: { min: 0, unit: 'px', category: 'Navigation' },
        repathInterval: {
            min: 0, unit: 's', category: 'Navigation',
            tooltip: 'Replan cadence while moving; 0 = only when the target changes.',
        },
        hasTarget: { category: 'Target' },
        targetX: { unit: 'px', category: 'Target' },
        targetY: { unit: 'px', category: 'Target' },
        targetZ: { unit: 'px', category: 'Target' },
        arrived: { category: 'Target', advanced: true },
    },
});

/**
 * Point a NavAgent at a world position and (re)arm it. Safe to call every frame
 * (e.g. to chase a moving target) — the system only replans when the target
 * actually moves or the repath timer elapses.
 */
export function setNavDestination(
    world: World,
    entity: Entity,
    target: { x: number; y: number; z?: number },
): void {
    if (!world.has(entity, NavAgent)) return;
    const agent = world.get(entity, NavAgent);
    agent.hasTarget = true;
    agent.targetX = target.x;
    agent.targetY = target.y;
    // `z` is optional so a flat game keeps naming a destination in two, and a
    // point in the ground plane of a spatial one is not silently taken as depth 0.
    agent.targetZ = target.z ?? 0;
    agent.arrived = false;
    world.set(entity, NavAgent, agent);
}

/** Clear a NavAgent's destination and stop it in place. */
export function stopNavAgent(world: World, entity: Entity): void {
    if (!world.has(entity, NavAgent)) return;
    const agent = world.get(entity, NavAgent);
    agent.hasTarget = false;
    world.set(entity, NavAgent, agent);
}
