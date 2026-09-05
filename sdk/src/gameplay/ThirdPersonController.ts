// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ThirdPersonController.ts
 * @brief   Input to a walking character, and the character's real motion back
 *          out to its animator.
 *
 * @details It decides what the player WANTS - a direction in the camera's ground
 *          plane, a speed to reach it at, a jump - and asks
 *          CharacterController3D for it. What actually happens is the physics
 *          world's answer, and that answer, not the request, is what reaches the
 *          animator: a character shoving a wall has a full stick and no motion,
 *          and it must not be running on the spot.
 *
 *          It solves no collision, owns no gravity (the character controller
 *          carries the vertical component), and names no animation clip.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import type { Entity } from '../types';
import type { Vec3 } from '../types';

/** The key a dodge is asked for on; the animator decides whether there is one. */
export const DODGE_KEY = 'ShiftLeft';

/** The key an attack is asked for on. Same rule: a request, not a clip name. */
export const ATTACK_KEY = 'KeyJ';

/** The fields of the `ThirdPersonController` component. @experimental */
export interface ThirdPersonControllerData {
    /** Top speed on the ground, world units per second. */
    moveSpeed: number;
    /** How fast it reaches that speed, units per second squared. */
    acceleration: number;
    /** How fast it sheds it when the stick centres. */
    deceleration: number;
    /** How fast it turns to face where it is going, degrees per second. */
    rotationSpeed: number;
    /** Upward speed a jump starts with; 0 disables jumping. */
    jumpSpeed: number;
    /** How much of `acceleration` applies while off the ground, 0..1. */
    airControl: number;
    /** Read the stick in the camera's ground plane rather than the world's. */
    cameraRelative: boolean;
    /** The camera that defines "forward". 0 = the first ThirdPersonCamera found. */
    camera: Entity;
    /** Speed under which the animator is told the character is standing still. */
    idleThreshold: number;
    enabled: boolean;
}

/**
 * Drives a CharacterController3D from player input, and reports what the
 * character actually did to its Animator.
 *
 * @experimental
 */
export const ThirdPersonController: ComponentDef<ThirdPersonControllerData> =
    defineComponent<ThirdPersonControllerData>('ThirdPersonController', {
        moveSpeed: 320,
        acceleration: 2400,
        deceleration: 3200,
        rotationSpeed: 720,
        jumpSpeed: 0,
        airControl: 0.3,
        cameraRelative: true,
        camera: 0 as Entity,
        idleThreshold: 8,
        enabled: true,
    }, {
        entityFields: ['camera'],
        fields: {
            camera: { tooltip: 'Whose forward the stick is read against.' },
            rotationSpeed: { unit: '°/s' },
            airControl: { min: 0, max: 1, step: 0.05, advanced: true },
            idleThreshold: { min: 0, step: 0.05, advanced: true },
            jumpSpeed: { min: 0, tooltip: 'Upward speed a jump starts with. 0 = cannot jump.' },
        },
    });

// =============================================================================
// The decisions, as pure functions
// =============================================================================

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** A basis to read the stick against: two ground-plane axes. */
export interface MoveBasis {
    forward: Vec3;
    right: Vec3;
}

/** The world basis, for a controller reading its stick without a camera. */
export const WORLD_BASIS: MoveBasis = {
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
};

/**
 * Where the player is asking to go, as a unit vector on the ground plane.
 * Zero-length when the stick is centred, which is a stop rather than a
 * direction. `input.y` is forward on the stick, `input.x` is right.
 */
export function desiredDirection(
    input: { x: number; y: number }, basis: MoveBasis,
): Vec3 {
    const x = basis.forward.x * input.y + basis.right.x * input.x;
    const z = basis.forward.z * input.y + basis.right.z * input.x;
    const length = Math.hypot(x, z);
    if (length < 1e-6) return { x: 0, y: 0, z: 0 };
    return { x: x / length, y: 0, z: z / length };
}

/**
 * Move a horizontal velocity toward what was asked for. Accelerating and
 * stopping are separate rates because a character that coasts to a halt as
 * slowly as it gets going feels like it is on ice.
 */
export function approachVelocity(
    current: { x: number; z: number }, target: { x: number; z: number },
    acceleration: number, deceleration: number, dt: number,
): { x: number; z: number } {
    const dx = target.x - current.x;
    const dz = target.z - current.z;
    const gap = Math.hypot(dx, dz);
    if (gap < 1e-6) return { x: target.x, z: target.z };

    const slowing = Math.hypot(target.x, target.z) < Math.hypot(current.x, current.z);
    const step = (slowing ? deceleration : acceleration) * dt;
    if (step >= gap) return { x: target.x, z: target.z };
    return { x: current.x + (dx / gap) * step, z: current.z + (dz / gap) * step };
}

/** The heading, in degrees about world up, that a ground direction points at. */
export function facingYaw(direction: Vec3): number {
    return Math.atan2(-direction.x, -direction.z) * RAD2DEG;
}

/** The signed shortest way from `from` to `to`, in degrees. */
export function shortestAngleDelta(from: number, to: number): number {
    let delta = (to - from) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
}

/**
 * The velocity a root-motion request comes to over the seconds it covers. A RATE,
 * because the animator states one per rendered frame while the character steps on
 * its own clock: adding the displacement moves twice on a frame with two steps.
 */
export function rootMotionVelocity(
    delta: { x: number; z: number }, seconds: number,
): { x: number; z: number } {
    if (seconds <= 0) return { x: 0, z: 0 };
    return { x: delta.x / seconds, z: delta.z / seconds };
}

/**
 * Turn `from` toward `to` at a rate. The shortest way round, so a character
 * crossing the -180/180 seam does not spin the long way to get there.
 */
export function turnToward(from: number, to: number, degreesPerSecond: number, dt: number): number {
    const delta = shortestAngleDelta(from, to);
    if (degreesPerSecond <= 0) return to;
    const step = degreesPerSecond * dt;
    if (Math.abs(delta) <= step) return to;
    return from + Math.sign(delta) * step;
}

/** A yaw in degrees as the rotation quaternion about world up. */
export function yawQuaternion(yawDeg: number): { w: number; x: number; y: number; z: number } {
    const half = yawDeg * DEG2RAD * 0.5;
    return { w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 };
}

/** The yaw a rotation about world up carries, in degrees. */
export function yawOfQuaternion(q: { w: number; y: number }): number {
    return 2 * Math.atan2(q.y, q.w) * RAD2DEG;
}
