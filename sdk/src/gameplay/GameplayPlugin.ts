// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GameplayPlugin.ts
 * @brief   Wires the third-person character and its camera into the frame.
 *
 * @details Three systems, and WHERE they sit is the design. The controller asks
 *          before the physics step and observes after it, so what reaches the
 *          animator is the motion the world allowed rather than the motion the
 *          player asked for. The camera runs once a frame, after everything has
 *          moved, because it follows and is never followed.
 */

import type { App, Plugin } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { Res, Time, type TimeData } from '../ecs/resource';
import { playModeOnly } from '../ecs/env';
import { Input, type InputState } from '../input/input';
import { Transform, type TransformData } from '../ecs/component';
import { CharacterController3D, type CharacterController3DData } from '../physics3d/Physics3DComponents';
import { Physics3D } from '../physics3d/Physics3DPlugin';
import type { Physics3DQueries } from '../physics3d/Physics3DQueries';
import { Animator, AnimatorController, type AnimatorControllerAPI } from '../animation/Animator';
import {
    AnimatorRootMotion, type AnimatorRootMotionData,
} from '../animation/animatorRootMotion';
import { AnimatorEvent, type AnimatorEventPayload } from '../animation/animatorEvent';
import { EventReader, EventWriter, type EventWriterInstance } from '../ecs/event';
import { Damage, applyDamage, type DamagePayload } from './Health';
import { MeleeAttacks, resolveMeleeHits } from './MeleeAttack';
import { q } from '../math/quat';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import {
    ThirdPersonController, type ThirdPersonControllerData,
    desiredDirection, approachVelocity, facingYaw, turnToward, rootMotionVelocity,
    yawQuaternion, yawOfQuaternion, WORLD_BASIS, DODGE_KEY, ATTACK_KEY, type MoveBasis,
} from './ThirdPersonController';
import {
    ThirdPersonCamera, type ThirdPersonCameraData,
    orbitOffset, cameraGroundBasis, dampFactor, clampPitch,
} from './ThirdPersonCamera';

/** Animator parameters this controller writes. Names, not clips. */
export const TPC_SPEED = 'speed';
export const TPC_GROUNDED = 'grounded';
/** The trigger a dodge press sets. Whether any state answers it is the graph's. */
export const TPC_DODGE = 'dodge';
/** The trigger an attack press sets. The graph decides which state answers it. */
export const TPC_ATTACK = 'attack';

/**
 * What the animation is asking this character to do, or null when nothing is.
 * Presence of the component is the opt-in and `active` is the switch — "the
 * delta is non-zero" is not, being false in the still moment inside a dodge.
 */
function rootMotionRequest(world: World, entity: Entity): AnimatorRootMotionData | null {
    if (!world.has(entity, AnimatorRootMotion)) return null;
    const data = world.get(entity, AnimatorRootMotion) as AnimatorRootMotionData;
    return data.active ? data : null;
}

/** The stick, from the keys a keyboard stands in for one with. */
function readStick(input: InputState): { x: number; y: number } {
    const x = (input.isKeyDown('KeyD') ? 1 : 0) - (input.isKeyDown('KeyA') ? 1 : 0);
    const y = (input.isKeyDown('KeyW') ? 1 : 0) - (input.isKeyDown('KeyS') ? 1 : 0);
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

/** The camera a controller reads forward from: the one it names, else any. */
function basisFor(world: World, data: ThirdPersonControllerData): MoveBasis {
    if (!data.cameraRelative) return WORLD_BASIS;
    const named = data.camera && world.has(data.camera, ThirdPersonCamera)
        ? data.camera
        : world.getEntitiesWithComponents([ThirdPersonCamera])[0];
    if (named === undefined) return WORLD_BASIS;
    return cameraGroundBasis((world.get(named, ThirdPersonCamera) as ThirdPersonCameraData).yaw);
}

/**
 * Ask for motion: the stick, in the camera's ground plane, as a velocity the
 * character controller will try to honour. The vertical component is left alone
 * unless a jump starts one, because the character controller carries it.
 */
export function requestMotion(
    world: World, input: InputState, dt: number,
    animator: AnimatorControllerAPI | null = null,
): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonController, CharacterController3D])) {
        const data = world.get(entity, ThirdPersonController) as ThirdPersonControllerData;
        if (!data.enabled) continue;

        if (animator && world.has(entity, Animator)) {
            // A press asks for the ACTION; which clip that is, and whether this
            // character has one at all, stays the animator graph's answer.
            if (input.isKeyPressed(DODGE_KEY)) animator.setTrigger(entity, TPC_DODGE);
            if (input.isKeyPressed(ATTACK_KEY)) animator.setTrigger(entity, TPC_ATTACK);
        }

        const character = world.get(entity, CharacterController3D) as CharacterController3DData;
        // Which of the two states the character's movement: the stick, or the
        // animation that declared itself in charge. Chosen HERE and not by the
        // animator, which states a request and never a position.
        const driven = rootMotionRequest(world, entity);
        let next: { x: number; z: number };
        if (driven) {
            next = rootMotionVelocity(driven.deltaPosition, driven.deltaTime);
        } else {
            const direction = desiredDirection(readStick(input), basisFor(world, data));
            const target = {
                x: direction.x * data.moveSpeed,
                z: direction.z * data.moveSpeed,
            };
            // Off the ground the player has only as much say as airControl allows.
            const authority = character.isOnFloor ? 1 : Math.max(0, Math.min(1, data.airControl));
            next = approachVelocity(
                { x: character.velocity.x, z: character.velocity.z }, target,
                data.acceleration * authority, data.deceleration * authority, dt,
            );
        }

        // A jump is the one time the vertical is ours to set; every other frame
        // it stays 0, which the character controller reads as "walk". Not while an
        // animation is driving: two things setting the vertical is one too many.
        const jumping = !driven && data.jumpSpeed > 0 && character.isOnFloor
            && (input.isKeyPressed('Space') || input.isKeyDown('Space'));

        world.update(entity, CharacterController3D, (c: CharacterController3DData) => {
            c.velocity.x = next.x;
            c.velocity.z = next.z;
            c.velocity.y = jumping ? data.jumpSpeed : 0;
        });
    }
}

/**
 * Observe what happened. The animator is told the speed the character REACHED,
 * so walking into a wall reads as standing still, and the character turns to
 * face where it actually went.
 */
export function observeMotion(world: World, animator: AnimatorControllerAPI | null, dt: number): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonController, CharacterController3D])) {
        const data = world.get(entity, ThirdPersonController) as ThirdPersonControllerData;
        if (!data.enabled) continue;

        const character = world.get(entity, CharacterController3D) as CharacterController3DData;
        const moved = character.realVelocity;
        const speed = Math.hypot(moved.x, moved.z);

        if (animator && world.has(entity, Animator)) {
            animator.setFloat(entity, TPC_SPEED, speed < data.idleThreshold ? 0 : speed);
            animator.setBool(entity, TPC_GROUNDED, character.isOnFloor);
        }

        if (!world.has(entity, Transform)) continue;

        // While an animation is driving, the heading is the animation's too —
        // turning to face the motion as well would be a second author of the
        // yaw, and the two disagree the moment a dodge goes sideways.
        const driven = rootMotionRequest(world, entity);
        if (driven) {
            if (driven.deltaTime <= 0) continue;
            // This step's share of the frame's turn: the animator states one per
            // rendered frame, and this runs once per fixed step inside it.
            const step = q.scaled(driven.deltaRotation, Math.min(dt / driven.deltaTime, 1));
            world.update(entity, Transform, (t: TransformData) => {
                const turned = q.normalize(q.mul(t.rotation, step));
                t.rotation.w = turned.w; t.rotation.x = turned.x;
                t.rotation.y = turned.y; t.rotation.z = turned.z;
            });
            continue;
        }

        // Face where it is going, not where it was asked to go - and hold the
        // last heading when it stops, rather than snapping back to world forward.
        if (speed < data.idleThreshold) continue;
        const wanted = facingYaw({ x: moved.x, y: 0, z: moved.z });
        world.update(entity, Transform, (t: TransformData) => {
            const turned = turnToward(yawOfQuaternion(t.rotation), wanted, data.rotationSpeed, dt);
            const yaw = yawQuaternion(turned);
            t.rotation.w = yaw.w; t.rotation.x = yaw.x; t.rotation.y = yaw.y; t.rotation.z = yaw.z;
        });
    }
}

/** Per-camera pointer state, so a delta exists without the input layer keeping one. */
const lastPointer = new Map<Entity, { x: number; y: number }>();

/**
 * How far back the eye may sit before something solid is in the way. The probe
 * is a sphere so the eye stops short of a wall rather than touching it.
 */
function clearDistance(
    queries: Physics3DQueries | null, data: ThirdPersonCameraData,
    pivot: { x: number; y: number; z: number }, offset: { x: number; y: number; z: number },
): number {
    if (!data.obstruction || !queries || data.distance <= 0) return data.distance;
    const hit = queries.sphereCast(
        pivot, data.obstructionRadius,
        { x: offset.x * data.distance, y: offset.y * data.distance, z: offset.z * data.distance },
        data.obstructionLayers,
    );
    if (!hit) return data.distance;
    // The hit is a FRACTION of the sweep, and the sweep was the full distance.
    return Math.max(0, Math.min(data.distance, hit.fraction * data.distance));
}

export function updateCameras(
    world: World, input: InputState, queries: Physics3DQueries | null, dt: number,
): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonCamera, Transform])) {
        const data = world.get(entity, ThirdPersonCamera) as ThirdPersonCameraData;
        if (!data.enabled || !data.target || !world.has(data.target, Transform)) continue;

        const pointer = input.getMousePosition();
        const previous = lastPointer.get(entity);
        lastPointer.set(entity, { x: pointer.x, y: pointer.y });
        // Only while a button is held: a free pointer over the window is not
        // someone turning the camera.
        const dragging = input.isMouseButtonDown(0) || input.isMouseButtonDown(2);
        let { yaw, pitch } = data;
        if (previous && dragging) {
            yaw -= (pointer.x - previous.x) * data.sensitivity;
            pitch = clampPitch(pitch + (pointer.y - previous.y) * data.sensitivity,
                               data.minPitch, data.maxPitch);
        }
        if (yaw !== data.yaw || pitch !== data.pitch) {
            world.update(entity, ThirdPersonCamera, (c: ThirdPersonCameraData) => {
                c.yaw = yaw; c.pitch = pitch;
            });
        }

        const targetTransform = world.get(data.target, Transform) as TransformData;
        const pivot = {
            x: targetTransform.position.x + data.targetOffset.x,
            y: targetTransform.position.y + data.targetOffset.y,
            z: targetTransform.position.z + data.targetOffset.z,
        };
        const offset = orbitOffset(yaw, pitch);
        const distance = clearDistance(queries, data, pivot, offset);
        const wanted = {
            x: pivot.x + offset.x * distance,
            y: pivot.y + offset.y * distance,
            z: pivot.z + offset.z * distance,
        };

        const k = dampFactor(data.followDamping, dt);
        world.update(entity, Transform, (t: TransformData) => {
            t.position.x += (wanted.x - t.position.x) * k;
            t.position.y += (wanted.y - t.position.y) * k;
            t.position.z += (wanted.z - t.position.z) * k;
            // Looking back down the offset it sits along: pitch tips the eye
            // down when the camera is above, which is the negative turn about X.
            const half = { p: -pitch * Math.PI / 360, y: yaw * Math.PI / 360 };
            const cp = Math.cos(half.p), sp = Math.sin(half.p);
            const cy = Math.cos(half.y), sy = Math.sin(half.y);
            t.rotation.w = cp * cy;
            t.rotation.x = sp * cy;
            t.rotation.y = cp * sy;
            t.rotation.z = -sp * sy;
        });
    }
}

export class GameplayPlugin implements Plugin {
    name = 'gameplay';
    private offDespawn_: (() => void) | null = null;
    /** Per App, not per module: two Apps in one process must not share swings. */
    private readonly attacks_ = new MeleeAttacks();

    build(app: App): void {
        const world = app.world;
        const attacks = this.attacks_;
        this.offDespawn_ = world.onDespawn((entity: Entity) => {
            lastPointer.delete(entity);
            attacks.forget(entity);
        });

        // BEFORE this frame's animator: the events are last frame's, and the
        // joints still hold the pose that posted them. Running after would ask
        // the query about a swing that has already moved on.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [EventReader(AnimatorEvent), EventWriter(Damage)],
            (
                events: Iterable<AnimatorEventPayload>,
                damage: EventWriterInstance<DamagePayload>,
            ) => {
                const queries = app.hasResource(Physics3D) ? app.getResource(Physics3D) : null;
                resolveMeleeHits(world, attacks, queries, events, damage);
            },
            { name: 'MeleeAttackSystem' },
        ), { runIf: playModeOnly });

        // The only writer of Health, and it reads a request rather than being
        // called by whatever swung.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [EventReader(Damage)],
            (blows: Iterable<DamagePayload>) => { applyDamage(world, blows); },
            { name: 'DamageSystem' },
        ), { runIf: playModeOnly });

        // Before the physics step: what the player is asking for.
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => {
                const animator = app.hasResource(AnimatorController)
                    ? app.getResource(AnimatorController) : null;
                requestMotion(world, input, time.fixedDelta, animator);
            },
            { name: 'ThirdPersonControllerSystem' },
        ), { runIf: playModeOnly });

        // After it: what the world allowed. The animator hears this one.
        app.addSystemToSchedule(Schedule.FixedPostUpdate, defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                const animator = app.hasResource(AnimatorController)
                    ? app.getResource(AnimatorController) : null;
                observeMotion(world, animator, time.fixedDelta);
            },
            { name: 'ThirdPersonObserveSystem' },
        ), { runIf: playModeOnly });

        // Once a frame, after everything it follows has moved.
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => {
                const queries = app.hasResource(Physics3D) ? app.getResource(Physics3D) : null;
                updateCameras(world, input, queries, time.delta);
            },
            { name: 'ThirdPersonCameraSystem' },
        ), { runIf: playModeOnly });
    }

    cleanup(): void {
        this.offDespawn_?.();
        this.offDespawn_ = null;
        lastPointer.clear();
        this.attacks_.clear();
    }
}

export const gameplayPlugin = new GameplayPlugin();
