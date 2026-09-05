// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Hunter.ts
 * @brief   The gameplay layer above a character that hunts: what it decides,
 *          asked of the same navigation, physics, animator and combat a player
 *          goes through.
 *
 * @details The twin of {@link ThirdPersonController}. That one turns INPUT into a
 *          request; this one turns PERCEPTION into one. Everything downstream is
 *          deliberately identical — the route is navigation's, the movement is
 *          the character controller's, the speed the animator hears is the one
 *          the world allowed, and a swing goes out as an animator trigger and
 *          comes back through the same MeleeAttack. An attacker being a program
 *          rather than a person must not change the mechanism.
 *
 *          Four states and no authoring surface: this is a concrete enemy, not a
 *          framework. The FSM and behaviour-tree runtimes are how a GAME declares
 *          its own; what needed proving first is that the chain holds at all.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import { Transform, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';
import { CharacterController3D, type CharacterController3DData } from '../physics3d/Physics3DComponents';
import { Perception, type PerceptionData } from '../ai/perception/components';
import { NavAgent, setNavDestination, stopNavAgent } from '../ai/nav/NavAgent';
import { Animator } from '../animation/Animator';
import type { AnimatorControllerAPI } from '../animation/Animator';
import { Health, type HealthData } from './Health';
import {
    facingYaw, turnToward, yawQuaternion, yawOfQuaternion,
    TPC_SPEED, TPC_GROUNDED,
} from './ThirdPersonController';

/** What a hunter is doing. Engine-written; a game reads it. @experimental */
export type HunterState = 'idle' | 'chase' | 'attack' | 'dead';

/** The fields of the `Hunter` component. @experimental */
export interface HunterData {
    /** Ground-plane distance it closes to before it swings, world units. */
    attackRange: number;
    /** Seconds between swings. */
    attackInterval: number;
    /** How fast it turns to face, degrees per second. */
    rotationSpeed: number;
    /** Speed under which the animator is told it is standing still. */
    idleThreshold: number;
    enabled: boolean;
    /** Engine-written: one of `idle` / `chase` / `attack` / `dead`. */
    state: string;
    /** Engine-written: seconds until it may swing again. */
    cooldown: number;
}

/**
 * A character that hunts what it perceives: it asks navigation for a route, the
 * character controller for the movement, and the animator for a swing. Add it
 * beside `Perceiver`/`Perception`, `NavAgent`, `CharacterController3D` and an
 * `Animator` whose graph answers `attack`; damage stays `MeleeAttack`'s.
 *
 * @experimental
 */
export const Hunter: ComponentDef<HunterData> = defineComponent<HunterData>('Hunter', {
    attackRange: 110,
    attackInterval: 1.6,
    rotationSpeed: 540,
    idleThreshold: 8,
    enabled: true,
    state: 'idle',
    cooldown: 0,
}, {
    readonlyFields: ['state', 'cooldown'],
    fields: {
        attackRange: { min: 0, tooltip: 'How close it gets before it swings.' },
        attackInterval: { min: 0, unit: 's' },
        rotationSpeed: { min: 0, unit: '°/s' },
        idleThreshold: { min: 0, step: 0.05, advanced: true },
        state: { advanced: true },
        cooldown: { advanced: true, unit: 's' },
    },
});

// =============================================================================
// The decision, as a pure function
// =============================================================================

/** Everything the decision depends on, so it can be made without a world. */
export interface HunterSituation {
    alive: boolean;
    visible: boolean;
    /** Distance to what it sees, IN THE GROUND PLANE — two capsules standing on
     *  the same floor are never as close as their three-axis distance says. */
    distance: number;
    attackRange: number;
}

/**
 * What a hunter should be doing. Recomputed every frame rather than latched:
 * a target that steps out of reach mid-swing has to be chased again, and a
 * state that only leaves on its own would leave it swinging at air.
 */
export function decideHunterState(s: HunterSituation): HunterState {
    if (!s.alive) return 'dead';
    if (!s.visible) return 'idle';
    return s.distance <= s.attackRange ? 'attack' : 'chase';
}

// =============================================================================
// The system
// =============================================================================

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Stop the body. Navigation SKIPS an agent with no destination, so the velocity
 *  it last wrote would carry a hunter on walking after it stopped chasing. */
function halt(world: World, entity: Entity): void {
    if (!world.has(entity, CharacterController3D)) return;
    world.update(entity, CharacterController3D, (c: CharacterController3DData) => {
        c.velocity.x = 0;
        c.velocity.z = 0;
    });
}

/** Turn toward `wanted` at the component's rate; a zero direction holds. */
function face(world: World, entity: Entity, wanted: Vec3, degreesPerSecond: number, dt: number): void {
    if (Math.hypot(wanted.x, wanted.z) < 1e-6 || !world.has(entity, Transform)) return;
    const to = facingYaw({ x: wanted.x, y: 0, z: wanted.z });
    world.update(entity, Transform, (t: TransformData) => {
        const turned = turnToward(yawOfQuaternion(t.rotation), to, degreesPerSecond, dt);
        const yaw = yawQuaternion(turned);
        t.rotation.w = yaw.w; t.rotation.x = yaw.x; t.rotation.y = yaw.y; t.rotation.z = yaw.z;
    });
}

/**
 * Perceive, decide, and ask — after perception, before navigation, so the
 * destination is planned the frame it was chosen. It moves nothing: where the
 * hunter ends up is the character controller's answer, and the speed the
 * animator hears is that answer. A hunter shoving a wall is not running on the spot.
 */
export function huntTargets(
    world: World, animator: AnimatorControllerAPI | null, attackTrigger: string, dt: number,
): void {
    for (const entity of world.getEntitiesWithComponents([Hunter, Perception, Transform])) {
        const data = world.get(entity, Hunter) as HunterData;
        if (!data.enabled) continue;

        const sight = world.get(entity, Perception) as PerceptionData;
        const here = (world.get(entity, Transform) as TransformData).position;
        const alive = !world.has(entity, Health)
            || (world.get(entity, Health) as HealthData).current > 0;
        const state = decideHunterState({
            alive,
            visible: sight.visible,
            distance: Math.hypot(sight.targetX - here.x, sight.targetZ - here.z),
            attackRange: data.attackRange,
        });

        if (state === 'chase' && world.has(entity, NavAgent)) {
            setNavDestination(world, entity, {
                x: sight.targetX, y: sight.targetY, z: sight.targetZ,
            });
        } else {
            if (world.has(entity, NavAgent)) stopNavAgent(world, entity);
            halt(world, entity);
        }

        let cooldown = Math.max(0, data.cooldown - dt);
        if (state === 'attack' && cooldown <= 0 && animator && world.has(entity, Animator)) {
            // The ACTION, not the clip: whether this character has a swing at all
            // is its animator graph's answer, exactly as it is for a player.
            animator.setTrigger(entity, attackTrigger);
            cooldown = data.attackInterval;
        }

        const character = world.has(entity, CharacterController3D)
            ? world.get(entity, CharacterController3D) as CharacterController3DData : null;
        const moved = character?.realVelocity ?? ZERO;
        const speed = Math.hypot(moved.x, moved.z);
        if (animator && world.has(entity, Animator)) {
            animator.setFloat(entity, TPC_SPEED,
                              state === 'dead' || speed < data.idleThreshold ? 0 : speed);
            animator.setBool(entity, TPC_GROUNDED, character?.isOnFloor ?? true);
        }

        // Where it goes while chasing, what it is fighting while attacking. The
        // two are different questions: a swing aimed down the last bit of drift
        // lands beside the target it was aimed at.
        if (state === 'chase' && speed >= data.idleThreshold) {
            face(world, entity, { x: moved.x, y: 0, z: moved.z }, data.rotationSpeed, dt);
        } else if (state === 'attack') {
            face(world, entity, { x: sight.dirX, y: 0, z: sight.dirZ }, data.rotationSpeed, dt);
        }

        world.update(entity, Hunter, (h: HunterData) => {
            h.state = state;
            h.cooldown = cooldown;
        });
    }
}
