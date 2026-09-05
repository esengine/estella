// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ThirdPersonCamera.ts
 * @brief   An eye that orbits a target and does not go through walls.
 *
 * @details Owns where the camera is and which way it looks: yaw, pitch, how far
 *          back it sits and how it catches up. It moves nothing else - a
 *          character's motion is {@link ThirdPersonController}'s, and the two
 *          only meet where the controller reads this yaw to know what "forward"
 *          means to the player.
 *
 *          Obstruction asks the physics world the same way anything else does.
 *          A camera that owned a second notion of solid would drift from the one
 *          the character walks against.
 */

import { defineComponent, type ComponentDef } from '../ecs/component';
import type { Entity } from '../types';
import type { Vec3 } from '../types';

/** The fields of the `ThirdPersonCamera` component. @experimental */
export interface ThirdPersonCameraData {
    /** What it orbits. 0 = inert. */
    target: Entity;
    /** How far back it sits when nothing is in the way, world units. */
    distance: number;
    /** Turn about world up, degrees. */
    yaw: number;
    /** Turn above the horizon, degrees; positive looks down at the target. */
    pitch: number;
    minPitch: number;
    maxPitch: number;
    /** Degrees per pixel of pointer travel. */
    sensitivity: number;
    /** How fast position catches up, per second. 0 = rigid. */
    followDamping: number;
    /** Lifted off the target's origin, so the eye frames the chest not the feet. */
    targetOffset: Vec3;
    /** Pull in when something solid stands between the pivot and the eye. */
    obstruction: boolean;
    /** How fat the probe is, so the eye stops before it clips a wall. */
    obstructionRadius: number;
    /** Physics layers the probe collides with; 0 = every layer. */
    obstructionLayers: number;
    enabled: boolean;
}

/**
 * A camera that orbits a target under pointer control.
 *
 * @experimental
 */
export const ThirdPersonCamera: ComponentDef<ThirdPersonCameraData> =
    defineComponent<ThirdPersonCameraData>('ThirdPersonCamera', {
        target: 0 as Entity,
        distance: 420,
        yaw: 0,
        pitch: 15,
        minPitch: -30,
        maxPitch: 70,
        sensitivity: 0.2,
        followDamping: 12,
        targetOffset: { x: 0, y: 90, z: 0 },
        obstruction: true,
        obstructionRadius: 15,
        obstructionLayers: 0,
        enabled: true,
    }, {
        entityFields: ['target'],
        fields: {
            target: { tooltip: 'The transform this camera orbits.' },
            minPitch: { unit: '°' },
            maxPitch: { unit: '°' },
            yaw: { unit: '°' },
            pitch: { unit: '°' },
            obstructionRadius: { min: 0, advanced: true },
            obstructionLayers: { min: 0, max: 15, step: 1, advanced: true },
            followDamping: { min: 0, advanced: true },
        },
    });

const DEG2RAD = Math.PI / 180;

/**
 * Where the eye sits relative to its pivot, at these angles. Length 1, and
 * pointing BEHIND the target: the camera looks back down it.
 */
export function orbitOffset(yawDeg: number, pitchDeg: number): Vec3 {
    const yaw = yawDeg * DEG2RAD;
    const pitch = pitchDeg * DEG2RAD;
    const flat = Math.cos(pitch);
    return { x: Math.sin(yaw) * flat, y: Math.sin(pitch), z: Math.cos(yaw) * flat };
}

/**
 * The ground-plane basis the player's input is read in, for a camera at this
 * yaw. PITCH IS ABSENT on purpose: forward is where the player looks ALONG the
 * ground, so an eye angled steeply down still walks the character across the
 * floor rather than into it.
 */
export function cameraGroundBasis(yawDeg: number): { forward: Vec3; right: Vec3 } {
    const yaw = yawDeg * DEG2RAD;
    return {
        forward: { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
        right: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) },
    };
}

/**
 * How much of the way to the target a damped value travels in `dt`.
 * `damping` is a rate per second; 0 means "arrive now", which is what a gate
 * that wants to read the settled value asks for.
 */
export function dampFactor(damping: number, dt: number): number {
    if (damping <= 0) return 1;
    return 1 - Math.exp(-damping * dt);
}

/** Keep `pitch` inside its limits, whichever way round they were authored. */
export function clampPitch(pitch: number, min: number, max: number): number {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.min(Math.max(pitch, lo), hi);
}
