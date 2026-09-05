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
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import {
    ThirdPersonController, type ThirdPersonControllerData,
    desiredDirection, approachVelocity, facingYaw, turnToward,
    yawQuaternion, yawOfQuaternion, WORLD_BASIS, type MoveBasis,
} from './ThirdPersonController';
import {
    ThirdPersonCamera, type ThirdPersonCameraData,
    orbitOffset, cameraGroundBasis, dampFactor, clampPitch,
} from './ThirdPersonCamera';

/** Animator parameters this controller writes. Names, not clips. */
export const TPC_SPEED = 'speed';
export const TPC_GROUNDED = 'grounded';

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
export function requestMotion(world: World, input: InputState, dt: number): void {
    for (const entity of world.getEntitiesWithComponents([ThirdPersonController, CharacterController3D])) {
        const data = world.get(entity, ThirdPersonController) as ThirdPersonControllerData;
        if (!data.enabled) continue;

        const character = world.get(entity, CharacterController3D) as CharacterController3DData;
        const direction = desiredDirection(readStick(input), basisFor(world, data));
        const target = {
            x: direction.x * data.moveSpeed,
            z: direction.z * data.moveSpeed,
        };
        // Off the ground the player has only as much say as airControl allows.
        const authority = character.isOnFloor ? 1 : Math.max(0, Math.min(1, data.airControl));
        const next = approachVelocity(
            { x: character.velocity.x, z: character.velocity.z }, target,
            data.acceleration * authority, data.deceleration * authority, dt,
        );

        // A jump is the one time the vertical is ours to set; every other frame
        // it stays 0, which the character controller reads as "walk".
        const jumping = data.jumpSpeed > 0 && character.isOnFloor
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

        // Face where it is going, not where it was asked to go - and hold the
        // last heading when it stops, rather than snapping back to world forward.
        if (speed < data.idleThreshold || !world.has(entity, Transform)) continue;
        const wanted = facingYaw({ x: moved.x, y: 0, z: moved.z });
        world.update(entity, Transform, (t: TransformData) => {
            const turned = turnToward(yawOfQuaternion(t.rotation), wanted, data.rotationSpeed, dt);
            const q = yawQuaternion(turned);
            t.rotation.w = q.w; t.rotation.x = q.x; t.rotation.y = q.y; t.rotation.z = q.z;
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

    build(app: App): void {
        const world = app.world;
        this.offDespawn_ = world.onDespawn((entity: Entity) => { lastPointer.delete(entity); });

        // Before the physics step: what the player is asking for.
        app.addSystemToSchedule(Schedule.FixedPreUpdate, defineSystem(
            [Res(Time), Res(Input)],
            (time: TimeData, input: InputState) => {
                requestMotion(world, input, time.fixedDelta);
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
    }
}

export const gameplayPlugin = new GameplayPlugin();
