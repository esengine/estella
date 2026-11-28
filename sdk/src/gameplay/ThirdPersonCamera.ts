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
    /**
     * How fast position catches up, per second; 0 holds the camera rigidly on the character. Rigid by default: a camera
     * that trails a character moved on the fixed step sees the character jolt against the world every frame the step
     * does not run, which on a fast display is most of them.
     */
    followDamping: number;
    /** Lifted off the target's origin, so the eye frames the chest not the feet. */
    targetOffset: Vec3;
    /** Pull in when something solid stands between the pivot and the eye. */
    obstruction: boolean;
    /** How fat the probe is, so the eye stops before it clips a wall. */
    obstructionRadius: number;
    /** Physics layers the probe collides with; 0 = every layer. */
    obstructionLayers: number;
    /** How far right of the target the eye sits, world units (negative: left), drawn in when a wall is beside it. */
    shoulder?: number;
    /**
     * How fast the eye goes back out once what pulled it in is out of the way, per second. Pulling in is at once, so
     * nothing comes between; going back out is eased, so a pillar passed does not snap the view. 0 = at once.
     */
    recoverDamping?: number;
    /** How far a foe may be for the lock key to lock onto it, world units; 0 = no lock-on. */
    lockRange?: number;
    /** The foe it is locked onto, or 0. Set by the lock key, or by a game; let go when it dies or gets too far. */
    lockTarget?: Entity;
    /** How fast the view turns to keep a locked foe ahead, per second. */
    lockTurnRate?: number;
    /** Degrees the view widens while its target sprints, the rush of speed. 0 = none. */
    sprintFov?: number;
    /** How fast the field of view follows, per second. */
    fovDamping?: number;
    /** Seconds without the pointer turning it before the view swings round behind a moving target; 0 = never. */
    recenterDelay?: number;
    /** How far the view is thrown when its target takes a blow, world units (half when its target lands one). 0 = none. */
    hitShake?: number;
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
        followDamping: 0,
        targetOffset: { x: 0, y: 90, z: 0 },
        obstruction: true,
        obstructionRadius: 15,
        obstructionLayers: 0,
        shoulder: 0,
        recoverDamping: 4,
        lockRange: 0,
        lockTarget: 0 as Entity,
        lockTurnRate: 4.5,
        sprintFov: 7,
        fovDamping: 5,
        recenterDelay: 0,
        hitShake: 0,
        enabled: true,
    }, {
    // World lengths and speeds: written at 100 units a metre, scaled to the project (ecs/worldUnits.ts).
    worldUnitFields: ['distance', 'targetOffset', 'obstructionRadius', 'shoulder', 'lockRange', 'hitShake'],
        entityFields: ['target', 'lockTarget'],
        fields: {
            target: { tooltip: 'The transform this camera orbits.' },
            minPitch: { unit: '°' },
            maxPitch: { unit: '°' },
            yaw: { unit: '°' },
            pitch: { unit: '°' },
            obstructionRadius: { min: 0, advanced: true },
            obstructionLayers: { min: 0, max: 15, step: 1, advanced: true },
            followDamping: { min: 0, tooltip: 'How fast the camera catches up with the character, per second. 0 holds it rigidly on the character.' },
            shoulder: { tooltip: 'How far right of the character the eye sits (negative: left). Drawn in when a wall is beside it.' },
            recoverDamping: { min: 0, step: 0.5, advanced: true, tooltip: 'How fast the eye goes back out after something pulled it in, per second. 0 = at once.' },
            lockRange: { min: 0, tooltip: 'How far a foe may be for Q to lock onto it. 0 = no lock-on.' },
            lockTarget: { tooltip: 'The foe it is locked onto. Set by Q or by a game; let go when it dies or gets too far.' },
            lockTurnRate: { min: 0, step: 0.5, advanced: true, tooltip: 'How fast the view turns to keep a locked foe ahead, per second.' },
            sprintFov: { min: 0, max: 30, step: 1, unit: '°', tooltip: 'Degrees the view widens while the character sprints. 0 = none.' },
            fovDamping: { min: 0, step: 0.5, advanced: true, tooltip: 'How fast the field of view follows, per second.' },
            recenterDelay: { min: 0, step: 0.1, unit: 's', tooltip: 'Seconds without turning the camera before it swings round behind a moving character. 0 = never.' },
            hitShake: { min: 0, tooltip: 'How far the view is thrown when the character takes a blow (half when it lands one). 0 = none.' },
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
