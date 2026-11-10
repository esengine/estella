// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    firstPersonSystems.ts
 * @brief   What a first-person player does each frame: look, ask for a walk, change height, and keep the view model's camera over the world's.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { playModeOnly } from '../ecs/env';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { Camera, Children, Transform, type ChildrenData, type TransformData } from '../ecs/component';
import { ClearFlags, ProjectionType } from '../wasm/wasm.generated';
import type { InputState } from '../input/input';
import { CharacterController3D, type CharacterController3DData } from '../physics3d/Physics3DComponents';
import type { Physics3DQueries } from '../physics3d/Physics3DQueries';
import { Device } from '../device';
import { approachVelocity } from './ThirdPersonController';
import {
    FirstPersonController, FirstPersonViewModel, lookAfter, pitchRotation, walkDirection, yawRotation, crouchAfter,
    type FirstPersonControllerData, type FirstPersonViewModelData,
} from './FirstPersonController';

/** The keys a keyboard stands in for a stick with. */
function stickOf(input: InputState): { x: number; y: number } {
    const x = ((input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) ? 1 : 0) - ((input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) ? 1 : 0);
    const y = ((input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) ? 1 : 0) - ((input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) ? 1 : 0);
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

const wantsCrouch = (input: InputState): boolean => input.isKeyDown('ControlLeft') || input.isKeyDown('KeyC');

/** The camera a controller looks through: the one it names, or the first child that carries one. */
function cameraOf(world: World, entity: Entity, data: FirstPersonControllerData): Entity | null {
    if (data.camera > 0 && world.valid(data.camera) && world.has(data.camera, Camera)) return data.camera;
    if (!world.has(entity, Children)) return null;
    for (const c of (world.get(entity, Children) as ChildrenData).entities) if (world.valid(c) && world.has(c, Camera)) return c;
    return null;
}

/** Fingers dragging to look: the ones that began far enough across the screen, and where each was last seen. */
export class TouchLook {
    private readonly last_ = new Map<number, { x: number; y: number }>();

    /** How far the looking fingers moved since the last call. */
    delta(input: InputState, from: number): { x: number; y: number } {
        let dx = 0, dy = 0;
        for (const t of input.getTouchesStarted()) if (t.x >= from) this.last_.set(t.id, { x: t.x, y: t.y });
        for (const t of input.getTouches()) {
            const was = this.last_.get(t.id);
            if (!was) continue;
            dx += t.x - was.x; dy += t.y - was.y;
            was.x = t.x; was.y = t.y;
        }
        for (const t of input.getTouchesEnded()) this.last_.delete(t.id);
        return { x: dx, y: dy };
    }
}

/** Once a frame: where the player is looking, and the body and the camera turned to match. */
export function look(world: World, input: InputState, dt: number, touch: TouchLook): void {
    for (const entity of world.getEntitiesWithComponents([FirstPersonController, Transform])) {
        const data = world.get(entity, FirstPersonController) as FirstPersonControllerData;
        if (!data.enabled) continue;

        let dx = 0, dy = 0;
        const locked = data.pointerLock && Device.state().pointerLocked;
        if (data.pointerLock && !locked && input.isMouseButtonPressed(0)) void Device.pointerLock(true);
        if (locked || (!data.pointerLock && input.isMouseButtonDown(0))) {
            const m = input.getMouseDelta();
            dx += m.x * data.lookSensitivity; dy += m.y * data.lookSensitivity;
        }
        if (data.touchLook) {
            const t = touch.delta(input, data.touchLookFrom);
            dx += t.x * data.touchSensitivity; dy += t.y * data.touchSensitivity;
        }
        const next = lookAfter(data.yaw, data.pitch, dx, dy, 1, data.pitchMin, data.pitchMax);

        // The eye settles toward the height of the stance it is in, a little a frame rather than all at once.
        const target = data.crouching ? data.crouchEyeHeight : data.eyeHeight;
        let eye = data.eye < 0 ? target : data.eye;
        const step = data.eyeSpeed * dt;
        eye = Math.abs(target - eye) <= step ? target : eye + Math.sign(target - eye) * step;

        world.update(entity, FirstPersonController, (c: FirstPersonControllerData) => { c.yaw = next.yaw; c.pitch = next.pitch; c.eye = eye; });
        const body = world.get(entity, Transform) as TransformData;
        const turn = yawRotation(next.yaw);
        body.rotation.x = turn.x; body.rotation.y = turn.y; body.rotation.z = turn.z; body.rotation.w = turn.w;
        world.set(entity, Transform, body);

        const eyeEntity = cameraOf(world, entity, data);
        if (eyeEntity !== null && world.has(eyeEntity, Transform)) {
            const t = world.get(eyeEntity, Transform) as TransformData;
            const tilt = pitchRotation(next.pitch);
            t.rotation.x = tilt.x; t.rotation.y = tilt.y; t.rotation.z = tilt.z; t.rotation.w = tilt.w;
            t.position.x = 0; t.position.y = eye; t.position.z = 0;
            world.set(eyeEntity, Transform, t);
        }
    }
}

/** Before the physics step: what the player asks of the character, and the height it asks to be. */
export function move(world: World, input: InputState, queries: Physics3DQueries | null, dt: number, gravity = 0): void {
    for (const entity of world.getEntitiesWithComponents([FirstPersonController, CharacterController3D])) {
        const data = world.get(entity, FirstPersonController) as FirstPersonControllerData;
        if (!data.enabled) continue;
        const character = world.get(entity, CharacterController3D) as CharacterController3DData;
        const standHalf = data.standHalfHeight > 0 ? data.standHalfHeight : character.halfHeight;

        // A capsule being made again: it was let go on the last step, and is made at its new height on this one.
        if (data.rebuild === 1) {
            world.update(entity, CharacterController3D, (c: CharacterController3DData) => { c.enabled = true; });
            world.update(entity, FirstPersonController, (c: FirstPersonControllerData) => { c.rebuild = 0; });
            continue;
        }

        const body = world.get(entity, Transform) as TransformData;
        const roomToStand = (): boolean => {
            if (!queries) return true;
            // From the top of the crouched capsule, up as far as standing would take it, and a little more.
            const top = { x: body.worldPosition.x, y: body.worldPosition.y + data.crouchHalfHeight + character.radius, z: body.worldPosition.z };
            return queries.raycast(top, { x: 0, y: (standHalf - data.crouchHalfHeight) + 2, z: 0 }) === null;
        };
        const crouching = crouchAfter(data.crouching, wantsCrouch(input), data.crouching ? roomToStand() : true);

        if (crouching !== data.crouching) {
            // Feet stay where they are: the centre moves by the change in half height, and the character is made again at the new height.
            const half = crouching ? data.crouchHalfHeight : standHalf;
            const shift = half - character.halfHeight;
            world.update(entity, CharacterController3D, (c: CharacterController3DData) => { c.halfHeight = half; c.enabled = false; });
            const t = world.get(entity, Transform) as TransformData;
            t.position.y += shift;
            world.set(entity, Transform, t);
            world.update(entity, FirstPersonController, (c: FirstPersonControllerData) => {
                c.crouching = crouching; c.rebuild = 1; if (c.standHalfHeight <= 0) c.standHalfHeight = standHalf;
            });
            continue;
        }
        if (data.standHalfHeight <= 0) world.update(entity, FirstPersonController, (c: FirstPersonControllerData) => { c.standHalfHeight = standHalf; });

        const direction = walkDirection(stickOf(input), data.yaw);
        const speed = data.moveSpeed * (data.crouching ? data.crouchMultiplier : input.isKeyDown('ShiftLeft') ? data.sprintMultiplier : 1);
        const authority = character.isOnFloor ? 1 : Math.max(0, Math.min(1, data.airControl));
        const next = approachVelocity({ x: character.velocity.x, z: character.velocity.z }, { x: direction.x * speed, z: direction.z * speed },
            data.acceleration * authority, data.deceleration * authority, dt);
        // Coyote time and a jump buffer: a jump just after walking off an edge, or pressed just before landing, still
        // takes off. Holding the key on the floor jumps as it always did.
        const airTime = character.isOnFloor ? 0 : (data.airTime ?? 0) + dt;
        const pressed = input.isKeyPressed('Space');
        const jumpHeld = pressed ? (data.jumpBuffer ?? 0) : Math.max(0, (data.jumpHeld ?? 0) - dt);
        const grounded = character.isOnFloor || (!data.jumped && airTime <= (data.coyoteTime ?? 0));
        const wants = (character.isOnFloor && input.isKeyDown('Space')) || pressed || jumpHeld > 0;
        const jumping = data.jumpSpeed > 0 && grounded && !data.crouching && wants;
        // The player's own gravity: in the air at a scale other than 1, the vertical speed is carried here (the solver
        // takes a non-zero one as given), from what the character really moved at the last step.
        const scale = data.gravityScale ?? 1;
        let vy = jumping ? data.jumpSpeed : 0;
        if (!jumping && !character.isOnFloor && scale !== 1 && gravity !== 0) {
            vy = character.realVelocity.y + gravity * scale * dt;
            if (vy === 0) vy = gravity * scale * dt;
        }
        world.update(entity, CharacterController3D, (c: CharacterController3DData) => {
            c.velocity.x = next.x; c.velocity.z = next.z; c.velocity.y = vy;
        });
        world.update(entity, FirstPersonController, (c: FirstPersonControllerData) => {
            c.airTime = airTime;
            c.jumpHeld = jumping ? 0 : jumpHeld;
            c.jumped = jumping ? true : character.isOnFloor ? false : c.jumped;
        });
    }
}

/**
 * Keeps the view model's camera over the player's: one under each camera that carries a `FirstPersonViewModel`, with the field of view, near plane and layer it asks for, and the
 * player's camera told not to draw that layer.
 */
export function installViewModels(app: App): () => void {
    const world = app.world;
    const cameras = new Map<Entity, Entity>();
    const off = world.onDespawn((entity: Entity) => {
        const own = cameras.get(entity);
        cameras.delete(entity);
        if (own !== undefined && world.valid(own)) world.despawn(own);
    });
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        for (const entity of world.getEntitiesWithComponents([FirstPersonViewModel, Camera])) {
            const model = world.get(entity, FirstPersonViewModel) as FirstPersonViewModelData;
            const mask = (1 << (model.layer & 31)) >>> 0;
            const parent = world.get(entity, Camera) as { priority: number; cullingMask: number };
            let child = cameras.get(entity);
            if (child === undefined || !world.valid(child)) {
                child = world.spawn('ViewModel');
                world.insert(child, Transform, {});
                world.setParent(child, entity);
                world.insert(child, Camera, {});
                cameras.set(entity, child);
            }
            // The world's camera does not draw what is held; the held thing's camera draws nothing else.
            const without = (parent.cullingMask & ~mask) >>> 0;
            if (parent.cullingMask !== without) world.update(entity, Camera, (c: { cullingMask: number }) => { c.cullingMask = without; });
            const own = world.get(child, Camera) as { projectionType: number; fov: number; nearPlane: number; farPlane: number; priority: number; cullingMask: number; clearFlags: number; isActive: boolean };
            if (own.projectionType !== ProjectionType.Perspective || own.fov !== model.fov || own.nearPlane !== model.nearPlane || own.farPlane !== model.farPlane || own.cullingMask !== mask
                || own.priority !== parent.priority + 1 || own.clearFlags !== ClearFlags.Depth || !own.isActive) {
                world.update(child, Camera, (c: typeof own) => {
                    c.projectionType = ProjectionType.Perspective; c.fov = model.fov; c.nearPlane = model.nearPlane; c.farPlane = model.farPlane; c.cullingMask = mask;
                    c.priority = parent.priority + 1; c.clearFlags = ClearFlags.Depth; c.isActive = true;
                });
            }
        }
    }, { name: 'FirstPersonViewModelSystem' }), { runIf: playModeOnly });
    return off;
}
