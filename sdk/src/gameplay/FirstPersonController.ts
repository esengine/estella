// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FirstPersonController.ts
 * @brief   Looking, walking, jumping and crouching as the one who stands in the world, and a hand-held thing that does not go through walls.
 *
 * @details It decides what the player WANTS (where to look, which way to go, whether to jump or crouch) and asks the 3D character controller for it, as the third-person
 *          layer does: it solves no collision and owns no gravity. The body turns about world up with the player's yaw; the camera under it tilts with the pitch.
 *
 *          Crouching changes the capsule. The physics world has no way to resize a character, so a crouch makes it again at the new height, with the feet where they were, and
 *          standing up first asks whether there is room over the head.
 *
 *          The view model is a second camera drawn over the first, with a field of view and a near plane of its own, over the layer the held thing is on, so that it neither
 *          stretches with a wide view of the world nor goes through the wall it is held against.
 */
import { defineComponent, type ComponentDef } from '../ecs/component';
import type { Entity } from '../types';

/** The fields of the `FirstPersonController` component. @experimental */
export interface FirstPersonControllerData {
    /** Top speed on the ground, world units per second. */
    moveSpeed: number;
    /** What the speed is multiplied by while the sprint key is held. */
    sprintMultiplier: number;
    /** What the speed is multiplied by while crouched. */
    crouchMultiplier: number;
    /** How fast it reaches its speed, units per second squared. */
    acceleration: number;
    /** How fast it sheds it when nothing is asked for. */
    deceleration: number;
    /** How much of `acceleration` applies while off the ground, 0..1. */
    airControl: number;
    /** Upward speed a jump starts with; 0 disables jumping. */
    jumpSpeed: number;
    /** Degrees of turn for each pixel the pointer moves. */
    lookSensitivity: number;
    /** Degrees of turn for each pixel a finger drags. */
    touchSensitivity: number;
    /** The lowest the player may look, in degrees (negative is down). */
    pitchMin: number;
    /** The highest the player may look, in degrees. */
    pitchMax: number;
    /** Where the eye is above the character's centre when standing, in world units. */
    eyeHeight: number;
    /** Where it is when crouched. */
    crouchEyeHeight: number;
    /** The capsule's half height when crouched; the standing one is the character controller's own. */
    crouchHalfHeight: number;
    /** How fast the eye moves between the two heights, units per second. */
    eyeSpeed: number;
    /** The camera that looks: a child of this entity. 0 is the first child that carries a Camera. */
    camera: Entity;
    /** Take the pointer for looking once the player clicks (web), instead of looking while a button is held. A mini game has no pointer to take. */
    pointerLock: boolean;
    /** Look by dragging a finger on the right of the screen, from `touchLookFrom` pixels across. */
    touchLook: boolean;
    touchLookFrom: number;
    enabled: boolean;
    /** Where it is looking, in degrees: set them to turn the player (a spawn point, a teleport). */
    yaw: number;
    pitch: number;
    /** Whether it is crouched now; set by the controller. */
    crouching: boolean;
    /** The capsule's standing half height, remembered from the character controller the first time it is seen; 0 until then. */
    standHalfHeight: number;
    /** Where the eye is now, between the two heights. */
    eye: number;
    /** A rebuild of the capsule in progress: 0 none, 1 the old one is let go and the new one made on the next step. */
    rebuild: number;
}

/**
 * A player who looks through a camera and walks, jumps and crouches in a CharacterController3D.
 *
 * @experimental
 */
export const FirstPersonController: ComponentDef<FirstPersonControllerData> = defineComponent<FirstPersonControllerData>('FirstPersonController', {
    moveSpeed: 320, sprintMultiplier: 1.6, crouchMultiplier: 0.5, acceleration: 2400, deceleration: 3200, airControl: 0.3, jumpSpeed: 420,
    lookSensitivity: 0.12, touchSensitivity: 0.2, pitchMin: -85, pitchMax: 85,
    eyeHeight: 70, crouchEyeHeight: 28, crouchHalfHeight: 45, eyeSpeed: 400,
    camera: 0 as Entity, pointerLock: true, touchLook: true, touchLookFrom: 480, enabled: true,
    yaw: 0, pitch: 0, crouching: false, standHalfHeight: 0, eye: -1, rebuild: 0,
}, {
    entityFields: ['camera'],
    readonlyFields: ['crouching', 'standHalfHeight', 'eye', 'rebuild'],
    fields: {
        moveSpeed: { min: 0, category: 'Movement' },
        sprintMultiplier: { min: 1, step: 0.05, category: 'Movement' },
        crouchMultiplier: { min: 0, max: 1, step: 0.05, category: 'Movement' },
        acceleration: { min: 0, category: 'Movement', advanced: true },
        deceleration: { min: 0, category: 'Movement', advanced: true },
        airControl: { min: 0, max: 1, step: 0.05, category: 'Movement', advanced: true },
        jumpSpeed: { min: 0, category: 'Movement', tooltip: 'Upward speed a jump starts with. 0 = cannot jump.' },
        lookSensitivity: { min: 0, step: 0.01, unit: '°/px', category: 'Look' },
        touchSensitivity: { min: 0, step: 0.01, unit: '°/px', category: 'Look' },
        pitchMin: { min: -90, max: 0, unit: '°', category: 'Look' },
        pitchMax: { min: 0, max: 90, unit: '°', category: 'Look' },
        eyeHeight: { category: 'Body', tooltip: 'Where the eye is above the character\'s centre when standing.' },
        crouchEyeHeight: { category: 'Body' },
        crouchHalfHeight: { min: 1, category: 'Body', tooltip: 'The capsule\'s half height when crouched. The standing one is the character controller\'s own.' },
        eyeSpeed: { min: 0, category: 'Body', advanced: true },
        camera: { category: 'Look', tooltip: 'The camera that looks, under this entity. Empty is the first child that carries one.' },
        pointerLock: { category: 'Look', tooltip: 'Take the pointer for looking once the player clicks, instead of looking while a button is held.' },
        touchLook: { category: 'Look', tooltip: 'Look by dragging a finger on the right of the screen.' },
        touchLookFrom: { min: 0, category: 'Look', tooltip: 'How far across the screen, in pixels, a finger must start to look. The left is left for a stick.', shownWhen: { field: 'touchLook', values: [1] } },
        yaw: { category: 'State', advanced: true },
        pitch: { category: 'State', advanced: true },
    },
});

/** The fields of the `FirstPersonViewModel` component. @experimental */
export interface FirstPersonViewModelData {
    /** The sorting layer the held thing is on; its entities carry this `layer` on their renderers. */
    layer: number;
    /** The view model's own field of view, in degrees. */
    fov: number;
    nearPlane: number;
    farPlane: number;
}

/**
 * Put on the player's camera: a second camera is drawn over it, showing only the entities on `layer`, with a field of view and near plane of its own, and the camera is told
 * not to draw that layer itself. Whatever is held goes under the camera, on the layer.
 *
 * @experimental
 */
export const FirstPersonViewModel: ComponentDef<FirstPersonViewModelData> = defineComponent<FirstPersonViewModelData>('FirstPersonViewModel', {
    layer: 20, fov: 60, nearPlane: 1, farPlane: 1000,
}, {
    fields: {
        layer: { min: 0, max: 31, category: 'View model', tooltip: 'The sorting layer the held thing is on: put it on its renderers, under this camera.' },
        fov: { min: 1, max: 170, unit: '°', category: 'View model', tooltip: 'The held thing\'s own field of view, so it does not stretch with a wide view of the world.' },
        nearPlane: { min: 0.01, category: 'View model', tooltip: 'How close it may come before it is cut, so it can be held against a wall without going through it.' },
        farPlane: { min: 1, category: 'View model', advanced: true },
    },
});

const DEG2RAD = Math.PI / 180;

/** A turn about world up, as a quaternion. Zero is looking down -z; a positive turn is to the left. */
export function yawRotation(yawDeg: number): { w: number; x: number; y: number; z: number } {
    const h = yawDeg * DEG2RAD / 2;
    return { w: Math.cos(h), x: 0, y: Math.sin(h), z: 0 };
}

/** A tilt about the camera's own right, as a quaternion. A positive tilt looks up. */
export function pitchRotation(pitchDeg: number): { w: number; x: number; y: number; z: number } {
    const h = pitchDeg * DEG2RAD / 2;
    return { w: Math.cos(h), x: Math.sin(h), y: 0, z: 0 };
}

/** Where the player looks after the pointer has moved (`dx`, `dy` in pixels, screen down being positive): to the right and up are what the pointer says. */
export function lookAfter(yaw: number, pitch: number, dx: number, dy: number, degreesPerPixel: number, pitchMin: number, pitchMax: number): { yaw: number; pitch: number } {
    const turned = yaw - dx * degreesPerPixel;
    // Kept in -180..180 so a long play does not grow it without end.
    const wrapped = ((turned + 180) % 360 + 360) % 360 - 180;
    return { yaw: wrapped, pitch: Math.min(Math.max(pitch - dy * degreesPerPixel, pitchMin), pitchMax) };
}

/** The ground direction a stick asks for when the player has turned `yaw` degrees: `y` is forward, `x` is right. Zero when centred. */
export function walkDirection(stick: { x: number; y: number }, yaw: number): { x: number; z: number } {
    const s = Math.sin(yaw * DEG2RAD), c = Math.cos(yaw * DEG2RAD);
    // Forward at yaw 0 is -z, and a positive yaw turns it to -x.
    const x = -s * stick.y + c * stick.x;
    const z = -c * stick.y - s * stick.x;
    const length = Math.hypot(x, z);
    return length < 1e-6 ? { x: 0, z: 0 } : { x: x / length, z: z / length };
}

/** Whether the player is crouched after this step: crouched if asked to be, and kept down where there is no room to stand. */
export function crouchAfter(crouching: boolean, wantsCrouch: boolean, roomToStand: boolean): boolean {
    if (wantsCrouch) return true;
    return crouching && !roomToStand;
}
