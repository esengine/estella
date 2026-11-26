// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    xrComponents.ts
 * @brief   Entities a headset moves: one that follows a controller (to hold a hand, a sword, a ray), one that follows the head.
 *
 * @details While a headset presents, an entity with {@link XRController} is placed where that controller is each frame, and
 *          one with {@link XRHead} where the player's head is, both in the world: the session's pose (metres, relative to
 *          where it began) through the rig, the camera the eyes are drawn from, exactly as the eyes are placed. A child of
 *          another entity is given the local pose that puts it there. Outside a headset, and while a controller is not
 *          tracked, the entity stays where it was left, so a scene authored with a hand at the camera's side looks right in
 *          the editor and on a flat screen.
 *
 *          The pose is set after the game's Update has moved the rig (PostUpdate), so a hand does not trail the player by a
 *          frame while they walk.
 */
import type { App } from '../app/app';
import { defineComponent, defineTag, Transform } from '../ecs/component';
import { parentEntity } from '../ecs/hierarchy';
import { worldUnitsPerMeter } from '../ecs/worldUnits';
import type { Entity } from '../types';
import { headingOf, placePose, xrPresentation, type QuatLike, type Vec3Like, type XRPoseLike } from './xrPresentation';

/** Which of a controller's two poses an entity follows. @experimental */
export enum XRControllerPose {
    /** Where the hand holds it: what a controller model or a held object is placed at. */
    Grip = 0,
    /** Where it points: the origin and direction (-Z) of a pointing ray. */
    Aim = 1,
}

/** @experimental */
export interface XRControllerData {
    /** 0 = left hand, 1 = right hand. */
    hand: number;
    pose: XRControllerPose;
}

/** Places its entity at a VR controller each frame while a headset presents. @experimental */
export const XRController = defineComponent<XRControllerData>('XRController', {
    hand: 1,
    pose: XRControllerPose.Grip,
}, {
    fields: {
        hand: { enum: [{ label: 'Left', value: 0 }, { label: 'Right', value: 1 }], tooltip: 'The hand whose controller this entity follows.' },
        pose: {
            enum: [{ label: 'Grip', value: XRControllerPose.Grip }, { label: 'Aim', value: XRControllerPose.Aim }],
            tooltip: 'Grip: where the hand holds the controller, for a model or a held object. Aim: where it points (forward is -Z), for a ray.',
        },
    },
});

/** Places its entity at the player's head each frame while a headset presents. @experimental */
export const XRHead = defineTag('XRHead');

function multiplyQuat(a: QuatLike, b: QuatLike): QuatLike {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}
const conjugate = (q: QuatLike): QuatLike => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
function rotate(q: QuatLike, v: Vec3Like): Vec3Like {
    const r = multiplyQuat(multiplyQuat(q, { x: v.x, y: v.y, z: v.z, w: 0 }), conjugate(q));
    return { x: r.x, y: r.y, z: r.z };
}
function normalize(q: QuatLike): QuatLike {
    const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

interface TransformLike {
    position: Vec3Like;
    rotation: QuatLike;
    worldPosition: Vec3Like;
    worldRotation: QuatLike;
    worldScale: Vec3Like;
}

/** Sets `entity` to the world pose given, through its parent's world transform when it has one. */
function placeAt(app: App, entity: Entity, position: Vec3Like, orientation: QuatLike): void {
    const world = app.world;
    const t = world.get(entity, Transform);
    const parent = parentEntity(world, entity);
    let local = { position, rotation: normalize(orientation) };
    if (parent !== undefined && world.valid(parent) && world.has(parent, Transform)) {
        const p = world.get(parent, Transform) as TransformLike;
        const inv = conjugate(normalize(p.worldRotation));
        const d = rotate(inv, { x: position.x - p.worldPosition.x, y: position.y - p.worldPosition.y, z: position.z - p.worldPosition.z });
        const s = p.worldScale;
        local = {
            position: { x: s.x ? d.x / s.x : 0, y: s.y ? d.y / s.y : 0, z: s.z ? d.z / s.z : 0 },
            rotation: normalize(multiplyQuat(inv, orientation)),
        };
    }
    world.set(entity, Transform, { ...t, position: local.position, rotation: local.rotation, worldPosition: position, worldRotation: normalize(orientation) });
}

/**
 * Moves every {@link XRController} and {@link XRHead} entity to what it follows, while a headset presents. Called each frame
 * by the camera plugin; a no-op outside a headset.
 */
export function syncXRPoses(app: App): void {
    const xr = xrPresentation(app);
    if (!xr || !xr.rigEntity) return;
    const world = app.world;
    const rigEntity = xr.rigEntity as Entity;
    if (!world.valid(rigEntity) || !world.has(rigEntity, Transform)) return;
    const rigT = world.get(rigEntity, Transform) as TransformLike;
    const rig = { position: rigT.worldPosition, heading: headingOf(rigT.worldRotation) };
    const unitsPerMeter = worldUnitsPerMeter();
    const place = (entity: Entity, pose: XRPoseLike | null): void => {
        if (!pose) return;
        const placed = placePose(rig, pose, unitsPerMeter);
        placeAt(app, entity, placed.position, placed.orientation);
    };
    for (const e of world.getEntitiesWithComponents([XRController, Transform])) {
        const c = world.get(e, XRController) as XRControllerData;
        const hand = c.hand === 0 ? 'left' : 'right';
        const controller = xr.controllers.find((k) => k.hand === hand);
        if (!controller) continue;
        // A controller with no grip (a tracked hand on some browsers) is held where it points.
        place(e, c.pose === XRControllerPose.Aim ? controller.aim : controller.grip ?? controller.aim);
    }
    for (const e of world.getEntitiesWithComponents([XRHead, Transform])) {
        place(e, { position: xr.headPosition, orientation: xr.headOrientation });
    }
}
