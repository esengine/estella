// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DSystem.ts
 * @brief   Keeps the 3D world and the ECS saying the same thing.
 * @details Each fixed step: entities that gained a RigidBody3D get a body, ones
 *          that lost it give theirs back, the world advances, and what moved is
 *          written to its Transform.
 *
 *          Positions cross in METRES and land in world units, the same
 *          pixels-per-unit contract the 2D world uses: a solver tuned for metres
 *          behaves nothing like itself when a character is 180 units tall.
 */
import type { App } from '../app/app';
import { Transform } from '../ecs/component';
import type { TransformData } from '../ecs/component.generated';
import {
    RigidBody3D, BoxCollider3D, SphereCollider3D, CapsuleCollider3D,
    type RigidBody3DData, type BoxCollider3DData, type SphereCollider3DData,
    type CapsuleCollider3DData,
} from './Physics3DComponents';
import type { Entity } from '../types';
import type { Physics3DWasmModule } from './Physics3DModule';
import { PHYSICS3D_TRANSFORM_STRIDE } from './Physics3DModule';

/** Body kinds, in the order the module reads them. */
const MOTION = { Static: 0, Kinematic: 1, Dynamic: 2 } as const;

export interface Physics3DConfig {
    gravity: { x: number; y: number; z: number };
    fixedTimestep: number;
    collisionSteps: number;
    pixelsPerUnit: number;
    maxBodies: number;
}

export const DEFAULT_PHYSICS3D_CONFIG: Physics3DConfig = {
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedTimestep: 1 / 60,
    collisionSteps: 1,
    pixelsPerUnit: 100,
    maxBodies: 1024,
};

/** Which body an entity owns, so a removed component takes its body with it. */
type BodyMap = Map<Entity, number>;

function motionOf(body: RigidBody3DData): number {
    // BodyType is the 2D enum, reused: static/kinematic/dynamic mean the same here.
    return body.bodyType === 0 ? MOTION.Static
        : body.bodyType === 1 ? MOTION.Kinematic : MOTION.Dynamic;
}

/**
 * Create the body an entity's collider describes.
 * @returns the module's body id, or 0 when the entity carries no 3D collider.
 */
function createBody(app: App, module: Physics3DWasmModule, entity: Entity,
                    body: RigidBody3DData, ppu: number): number {
    const t = app.world.get(entity, Transform) as TransformData | undefined;
    const p = t?.worldPosition ?? { x: 0, y: 0, z: 0 };
    const r = t?.worldRotation ?? { x: 0, y: 0, z: 0, w: 1 };
    const px = p.x / ppu, py = p.y / ppu, pz = p.z / ppu;
    // How the body answers to the world, in the order the module reads it.
    const how = [motionOf(body), body.gravityScale, body.linearDamping,
                 body.angularDamping, body.fixedRotation ? 1 : 0] as const;

    const box = app.world.get(entity, BoxCollider3D) as BoxCollider3DData | undefined;
    if (box?.enabled) {
        return module._physics3d_addBox(
            entity as number, box.halfExtents.x / ppu, box.halfExtents.y / ppu,
            box.halfExtents.z / ppu, px, py, pz, r.x, r.y, r.z, r.w,
            ...how, box.friction, box.restitution, box.isSensor ? 1 : 0);
    }
    const sphere = app.world.get(entity, SphereCollider3D) as SphereCollider3DData | undefined;
    if (sphere?.enabled) {
        return module._physics3d_addSphere(
            entity as number, sphere.radius / ppu, px, py, pz, r.x, r.y, r.z, r.w,
            ...how, sphere.friction, sphere.restitution, sphere.isSensor ? 1 : 0);
    }
    const capsule = app.world.get(entity, CapsuleCollider3D) as CapsuleCollider3DData | undefined;
    if (capsule?.enabled) {
        return module._physics3d_addCapsule(
            entity as number, capsule.radius / ppu, capsule.halfHeight / ppu,
            px, py, pz, r.x, r.y, r.z, r.w,
            ...how, capsule.friction, capsule.restitution, capsule.isSensor ? 1 : 0);
    }
    // A body with no shape has no extent to collide with, so it is not registered
    // at all — the alternative is an invisible point that falls forever.
    return 0;
}

/** Bring the world's population in line with the ECS, then step and read back. */
export function stepPhysics3D(app: App, module: Physics3DWasmModule,
                              bodies: BodyMap, config: Physics3DConfig): void {
    const ppu = config.pixelsPerUnit;

    const live = new Set<Entity>();
    for (const entity of app.world.queryEntities([RigidBody3D])) {
        const body = app.world.get(entity, RigidBody3D) as RigidBody3DData;
        if (!body.enabled) continue;
        live.add(entity);
        if (!bodies.has(entity)) {
            const id = createBody(app, module, entity, body, ppu);
            if (id !== 0) bodies.set(entity, id);
        }
    }
    for (const [entity, id] of bodies) {
        if (live.has(entity) && app.world.valid(entity)) continue;
        module._physics3d_removeBody(id);
        bodies.delete(entity);
    }

    module._physics3d_step(config.fixedTimestep, config.collisionSteps);

    // Only bodies the solver moved are in the buffer, so this is the frame's
    // moving population rather than every body in the world.
    const bytes = module._physics3d_transformsBytes();
    if (bytes === 0) return;
    const base = module._physics3d_transforms() >> 2;
    const f32 = module.HEAPF32;
    const count = bytes / 4 / PHYSICS3D_TRANSFORM_STRIDE;
    for (let i = 0; i < count; i++) {
        const o = base + i * PHYSICS3D_TRANSFORM_STRIDE;
        const entity = f32[o] as Entity;
        if (!app.world.valid(entity) || !app.world.has(entity, Transform)) continue;
        const t = app.world.get(entity, Transform) as TransformData;
        // Position and rotation are the solver's; scale is the scene's and is
        // left alone, the same division of ownership the 2D path makes.
        t.position.x = f32[o + 1]! * ppu;
        t.position.y = f32[o + 2]! * ppu;
        t.position.z = f32[o + 3]! * ppu;
        t.rotation.x = f32[o + 4]!;
        t.rotation.y = f32[o + 5]!;
        t.rotation.z = f32[o + 6]!;
        t.rotation.w = f32[o + 7]!;
        app.world.set(entity, Transform, t);
    }
}
