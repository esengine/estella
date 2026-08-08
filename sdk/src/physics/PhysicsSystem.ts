// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PhysicsSystem.ts
 * @brief   Per-frame physics driver: entity tracking, shape/joint create,
 *          step, transform readback, event collection.
 *
 * `registerPhysicsSystem` owns all closure state (tracked bodies, joint
 * cache, cached RigidBody props). `PhysicsPlugin.build()` calls it once
 * the wasm module finishes loading.
 */

import type { App } from '../app/app';
import type { Entity } from '../types';
import type { TransformData, ParentData, CanvasData } from '../ecs/component';
import { Transform, Parent, Canvas } from '../ecs/component';
import { Res, Time, type TimeData } from '../ecs/resource';
import { Schedule, defineSystem } from '../ecs/system';
import { playModeOnly } from '../ecs/env';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';
import { Physics } from './Physics';
import {
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider,
    SegmentCollider, PolygonCollider, ChainCollider, OneWayPlatform,
    RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint, MotorJoint,
    BodyType, activeCollider,
    type RigidBodyData, type BoxColliderData, type CircleColliderData,
    type CapsuleColliderData, type SegmentColliderData, type PolygonColliderData,
    type ChainColliderData, type OneWayPlatformData, type RevoluteJointData,
    type DistanceJointData, type PrismaticJointData, type WeldJointData, type WheelJointData,
    type MotorJointData,
} from './PhysicsComponents';
import {
    PhysicsEvents,
    COLLISION_EVENT_STRIDE,
    HIT_EVENT_STRIDE,
    quatToAngleZ,
    type ResolvedPhysicsConfig,
    type CollisionEnterEvent,
    type CollisionHitEvent,
    type SensorEvent,
} from './PhysicsTypes';
import { withMalloc } from '../wasm/wasmScratch';
import { engineApi, type EngineApi } from '../ecs/bridge/engineApi';

/**
 * The engine surface this file drives. `getTransformPtr` is the web module's own
 * (it hands back a pointer into wasm memory); a native host answers the batched
 * entry instead, which is the path every unparented body takes.
 */
type PhysicsEngineApi = EngineApi & {
    getTransformPtr?(registry: unknown, entity: number): number;
};

// =============================================================================
// Canvas pixelsPerUnit live read
// =============================================================================

/** The scene's live pixels-per-unit — the one reader of Canvas.pixelsPerUnit. @internal */
export function readPixelsPerUnit(app: App): number {
    const entities = app.world.getEntitiesWithComponents([Canvas]);
    for (const entity of entities) {
        const canvas = app.world.get(entity, Canvas) as CanvasData;
        if (canvas && canvas.pixelsPerUnit) {
            return canvas.pixelsPerUnit;
        }
    }
    return 100;
}

// =============================================================================
// Collision filter resolution
// =============================================================================

const MAX_COLLISION_LAYERS = 16;

function resolveCollisionMask(categoryBits: number, maskBits: number, layerMasks?: number[]): number {
    if (!layerMasks) return maskBits;
    for (let i = 0; i < MAX_COLLISION_LAYERS; i++) {
        if (categoryBits === (1 << i)) return layerMasks[i];
    }
    return maskBits;
}

// =============================================================================
// Shape attachment (one collider component per body)
// =============================================================================

/** Attach a Box2D shape for each enabled collider on the entity. @internal */
export function addShapeForEntity(
    world: App['world'], module: PhysicsWasmModule, entity: Entity, layerMasks?: number[],
): void {
    const box = activeCollider(world, entity, BoxCollider) as BoxColliderData | null;
    if (box) {
        const category = box.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, box.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addBoxShape(
            entity, box.halfExtents.x, box.halfExtents.y,
            box.offset.x, box.offset.y, box.radius ?? 0.05,
            box.density, box.friction, box.restitution, box.isSensor ? 1 : 0,
            category, mask
        );
    }

    const circle = activeCollider(world, entity, CircleCollider) as CircleColliderData | null;
    if (circle) {
        const category = circle.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, circle.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addCircleShape(
            entity, circle.radius,
            circle.offset.x, circle.offset.y,
            circle.density, circle.friction, circle.restitution, circle.isSensor ? 1 : 0,
            category, mask
        );
    }

    const capsule = activeCollider(world, entity, CapsuleCollider) as CapsuleColliderData | null;
    if (capsule) {
        const category = capsule.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, capsule.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addCapsuleShape(
            entity, capsule.radius, capsule.halfHeight,
            capsule.offset.x, capsule.offset.y,
            capsule.density, capsule.friction, capsule.restitution, capsule.isSensor ? 1 : 0,
            category, mask
        );
    }

    const seg = activeCollider(world, entity, SegmentCollider) as SegmentColliderData | null;
    if (seg) {
        const category = seg.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, seg.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addSegmentShape(
            entity, seg.point1.x, seg.point1.y, seg.point2.x, seg.point2.y,
            seg.density, seg.friction, seg.restitution, seg.isSensor ? 1 : 0,
            category, mask
        );
    }

    const poly = activeCollider(world, entity, PolygonCollider) as PolygonColliderData | null;
    if (poly) {
        const category = poly.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, poly.maskBits ?? 0xFFFF, layerMasks);
        const verts = poly.vertices;
        const count = Math.min(verts.length, 8);
        const byteSize = count * 2 * 4;
        withMalloc(module, byteSize, ptr => {
            const base = ptr >> 2;
            for (let i = 0; i < count; i++) {
                module.HEAPF32[base + i * 2] = verts[i].x;
                module.HEAPF32[base + i * 2 + 1] = verts[i].y;
            }
            module._physics_addPolygonShape(
                entity, ptr, count, poly.radius ?? 0,
                poly.density, poly.friction, poly.restitution, poly.isSensor ? 1 : 0,
                category, mask
            );
        });
    }

    const chain = activeCollider(world, entity, ChainCollider) as ChainColliderData | null;
    if (chain) {
        const pts = chain.points;
        if (pts.length < 4) return;
        const byteSize = pts.length * 2 * 4;
        withMalloc(module, byteSize, ptr => {
            const base = ptr >> 2;
            for (let i = 0; i < pts.length; i++) {
                module.HEAPF32[base + i * 2] = pts[i].x;
                module.HEAPF32[base + i * 2 + 1] = pts[i].y;
            }
            module._physics_addChainShape(
                entity, ptr, pts.length, chain.isLoop ? 1 : 0,
                chain.friction, chain.restitution,
                chain.categoryBits ?? 0x0001, chain.maskBits ?? 0xFFFF
            );
        });
    }
}

// =============================================================================
// Joint pending-list drain
// =============================================================================

function createPendingJoints(
    world: App['world'],
    module: PhysicsWasmModule,
    trackedEntities: Set<Entity>,
    trackedJoints: Set<Entity>,
    invPpu: number,
): void {
    const jointEntities = world.getEntitiesWithComponents([RevoluteJoint, RigidBody]);
    for (const entity of jointEntities) {
        if (trackedJoints.has(entity)) continue;
        if (!trackedEntities.has(entity)) continue;
        const joint = world.get(entity, RevoluteJoint) as RevoluteJointData;
        if (!joint.enabled) continue;
        const connected = joint.connectedEntity as Entity;
        if (!trackedEntities.has(connected)) continue;
        module._physics_createRevoluteJoint(
            connected, entity,
            joint.anchorA.x * invPpu, joint.anchorA.y * invPpu,
            joint.anchorB.x * invPpu, joint.anchorB.y * invPpu,
            joint.enableMotor ? 1 : 0, joint.motorSpeed, joint.maxMotorTorque,
            joint.enableLimit ? 1 : 0, joint.lowerAngle, joint.upperAngle,
            joint.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }

    for (const entity of world.getEntitiesWithComponents([DistanceJoint, RigidBody])) {
        if (trackedJoints.has(entity)) continue;
        if (!trackedEntities.has(entity)) continue;
        const j = world.get(entity, DistanceJoint) as DistanceJointData;
        if (!j.enabled) continue;
        const connected = j.connectedEntity as Entity;
        if (!trackedEntities.has(connected)) continue;
        module._physics_createDistanceJoint(
            connected, entity,
            j.anchorA.x * invPpu, j.anchorA.y * invPpu,
            j.anchorB.x * invPpu, j.anchorB.y * invPpu,
            j.length * invPpu,
            j.enableSpring ? 1 : 0, j.hertz, j.dampingRatio,
            j.enableLimit ? 1 : 0, j.minLength * invPpu, j.maxLength * invPpu,
            j.enableMotor ? 1 : 0, j.maxMotorForce, j.motorSpeed,
            j.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }

    for (const entity of world.getEntitiesWithComponents([PrismaticJoint, RigidBody])) {
        if (trackedJoints.has(entity)) continue;
        if (!trackedEntities.has(entity)) continue;
        const j = world.get(entity, PrismaticJoint) as PrismaticJointData;
        if (!j.enabled) continue;
        const connected = j.connectedEntity as Entity;
        if (!trackedEntities.has(connected)) continue;
        module._physics_createPrismaticJoint(
            connected, entity,
            j.anchorA.x * invPpu, j.anchorA.y * invPpu,
            j.anchorB.x * invPpu, j.anchorB.y * invPpu,
            j.axis.x, j.axis.y,
            j.enableSpring ? 1 : 0, j.hertz, j.dampingRatio,
            j.enableLimit ? 1 : 0, j.lowerTranslation * invPpu, j.upperTranslation * invPpu,
            j.enableMotor ? 1 : 0, j.maxMotorForce, j.motorSpeed,
            j.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }

    for (const entity of world.getEntitiesWithComponents([WeldJoint, RigidBody])) {
        if (trackedJoints.has(entity)) continue;
        if (!trackedEntities.has(entity)) continue;
        const j = world.get(entity, WeldJoint) as WeldJointData;
        if (!j.enabled) continue;
        const connected = j.connectedEntity as Entity;
        if (!trackedEntities.has(connected)) continue;
        module._physics_createWeldJoint(
            connected, entity,
            j.anchorA.x * invPpu, j.anchorA.y * invPpu,
            j.anchorB.x * invPpu, j.anchorB.y * invPpu,
            j.linearHertz, j.angularHertz,
            j.linearDampingRatio, j.angularDampingRatio,
            j.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }

    for (const entity of world.getEntitiesWithComponents([WheelJoint, RigidBody])) {
        if (trackedJoints.has(entity)) continue;
        if (!trackedEntities.has(entity)) continue;
        const j = world.get(entity, WheelJoint) as WheelJointData;
        if (!j.enabled) continue;
        const connected = j.connectedEntity as Entity;
        if (!trackedEntities.has(connected)) continue;
        module._physics_createWheelJoint(
            connected, entity,
            j.anchorA.x * invPpu, j.anchorA.y * invPpu,
            j.anchorB.x * invPpu, j.anchorB.y * invPpu,
            j.axis.x, j.axis.y,
            j.enableSpring ? 1 : 0, j.hertz, j.dampingRatio,
            j.enableLimit ? 1 : 0, j.lowerTranslation * invPpu, j.upperTranslation * invPpu,
            j.enableMotor ? 1 : 0, j.maxMotorTorque, j.motorSpeed,
            j.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }

    for (const entity of world.getEntitiesWithComponents([MotorJoint, RigidBody])) {
        if (trackedJoints.has(entity)) continue;
        if (!trackedEntities.has(entity)) continue;
        const j = world.get(entity, MotorJoint) as MotorJointData;
        if (!j.enabled) continue;
        const connected = j.connectedEntity as Entity;
        if (!trackedEntities.has(connected)) continue;
        module._physics_createMotorJoint(
            connected, entity,
            j.linearVelocity.x * invPpu, j.linearVelocity.y * invPpu, j.maxVelocityForce,
            j.angularVelocity, j.maxVelocityTorque,
            j.linearHertz, j.linearDampingRatio, j.maxSpringForce,
            j.angularHertz, j.angularDampingRatio, j.maxSpringTorque,
            j.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }
}

// =============================================================================
// One-way platform sync
// =============================================================================

// Re-applied every reconcile (idempotent): pushes each one-way platform's normal +
// enabled flag to the native pre-solve state and re-arms pre-solve events on shapes
// the collider reconcile may have just rebuilt. Entities that lost the component are
// cleared. `trackedOneWay` mirrors the native state so despawn can tear it down.
function syncOneWayPlatforms(
    world: App['world'],
    module: PhysicsWasmModule,
    trackedEntities: Set<Entity>,
    trackedOneWay: Set<Entity>,
): void {
    const seen = new Set<Entity>();
    for (const entity of world.getEntitiesWithComponents([OneWayPlatform, RigidBody])) {
        if (!trackedEntities.has(entity)) continue;
        const ow = world.get(entity, OneWayPlatform) as OneWayPlatformData;
        module._physics_setOneWayPlatform(entity, ow.normal.x, ow.normal.y, ow.enabled ? 1 : 0);
        trackedOneWay.add(entity);
        seen.add(entity);
    }
    for (const entity of [...trackedOneWay]) {
        if (!seen.has(entity)) {
            module._physics_setOneWayPlatform(entity, 0, 0, 0);
            trackedOneWay.delete(entity);
        }
    }
}

// =============================================================================
// Dynamic transform readback (wasm -> ECS Transform components)
// =============================================================================

const syncTransformBuf_ = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { w: 1, x: 0, y: 0, z: 0 },
    worldScale: { x: 1, y: 1, z: 1 },
};

const PHYSICS_BODY_STRIDE = 4; // u32 entity + 3x f32 (x, y, angle)
const PHYSICS_BODY_BYTES = PHYSICS_BODY_STRIDE * 4;

/**
 * Write interpolated body poses into ECS Transforms. The snapshot pair and the
 * lerp itself belong to the physics module (`physics_capturePoses` /
 * `physics_getInterpolatedTransforms`): they run over every dynamic body every
 * frame, and the no-JIT budget bars that loop from the JS path
 * (docs/REARCH_NATIVE.md §3.2). What is left here is routing the finished buffer
 * to the engine. With `alpha = 1` this reproduces a direct post-step sync.
 * @internal exported for testing
 */
export function applyPhysicsTransforms(
    app: App,
    ppu: number,
    parentedBodies: Set<Entity>,
    module: PhysicsWasmModule,
    alpha: number,
): void {
    const count = module._physics_getInterpolatedCount();
    if (count === 0) return;

    const registry = app.world.getCppRegistry();
    if (!registry) return;
    // Through engineApi, not app.wasmModule: a device has no wasm module, so
    // reaching for one left the batched path web-only and every body on a native
    // host fell back to one addTransform call apiece (see ecs/engineApi.ts).
    const engineMod = engineApi(app) as PhysicsEngineApi | null;
    const hasParented = parentedBodies.size > 0;

    // Already lerped, in the module's memory: [u32 entity, f32 x, y, angle] (meters).
    const srcPtr = module._physics_getInterpolatedTransforms(alpha);

    // Change-tracking boundary (deliberate). Both write paths below sync Transform
    // through a raw C++ / ptr fast path and do NOT record a Changed() tick — the one
    // intentional exception to the unified write surface (Mut / set / insert / remove /
    // Commands all record via world.*). Physics rewrites every dynamic body's transform
    // every fixed step, so firing Changed(Transform) here would flood the changed-set
    // with ~every moving body and make Changed(Transform) useless as a "gameplay wrote
    // this" signal; the batched C++ path also can't record without an O(count) JS loop.
    // To react to physics-driven motion, read the module's per-step pose buffer, not
    // Changed(Transform).

    const batchSync = engineMod?.registry_batchSyncPhysicsTransforms;
    const engineHeap = engineMod?.HEAPU8;
    if (!hasParented && batchSync && engineHeap) {
        // A native host compiles the physics module into the engine's own binary, so
        // both address one heap and the module's buffer is already an engine pointer.
        if (engineHeap.buffer === module.HEAPU8.buffer) {
            batchSync.call(engineMod, registry, srcPtr, count, ppu);
            return;
        }
        // On the web a side module owns separate memory, so it is copied across —
        // one memcpy, not a per-body loop.
        if (engineMod?._malloc && engineMod._free) {
            const bytes = count * PHYSICS_BODY_BYTES;
            withMalloc(engineMod as Required<Pick<EngineApi, '_malloc' | '_free'>>, bytes, engineBuf => {
                engineHeap.set(module.HEAPU8.subarray(srcPtr, srcPtr + bytes), engineBuf);
                batchSync.call(engineMod, registry, engineBuf, count, ppu);
            });
            return;
        }
    }

    const transformPtrFn = engineMod?.getTransformPtr;
    const getTransformPtr = transformPtrFn
        ? (e: Entity) => transformPtrFn.call(engineMod, registry!, e as number)
        : null;
    // engF32 views the ENGINE heap, srcU32/srcF32 the PHYSICS heap. Caching them
    // across the loop is safe only because the loop allocates on neither: it
    // reads the transform buffer and reads/writes EXISTING Transform components.
    // ALLOW_MEMORY_GROWTH detaches a cached view on any allocation that grows
    // the heap — add one to this loop and these must be re-read per iteration.
    const engF32 = engineMod?.HEAPF32;
    const addFn = (!getTransformPtr || !engF32) ? registry.addTransform.bind(registry) : null;
    const t = syncTransformBuf_;

    // A parented body's pose has to be expressed in its parent's space, which only
    // the registry can answer — so these go one at a time, over the same buffer.
    const srcU32 = module.HEAPU32;
    const srcF32 = module.HEAPF32;
    const srcBase = srcPtr >> 2;

    for (let i = 0; i < count; i++) {
        const o = srcBase + i * PHYSICS_BODY_STRIDE;
        const entityId = srcU32[o] as Entity;
        let localX = srcF32[o + 1] * ppu;
        let localY = srcF32[o + 2] * ppu;
        let localAngle = srcF32[o + 3];

        if (hasParented && parentedBodies.has(entityId)) {
            const parentData = app.world.get(entityId, Parent) as ParentData;
            if (parentData && app.world.valid(parentData.entity) && app.world.has(parentData.entity, Transform)) {
                const pwt = app.world.get(parentData.entity, Transform) as TransformData;
                const parentAngleZ = quatToAngleZ(pwt.worldRotation);
                const dx = localX - pwt.worldPosition.x;
                const dy = localY - pwt.worldPosition.y;
                const cos = Math.cos(-parentAngleZ);
                const sin = Math.sin(-parentAngleZ);
                const sx = pwt.worldScale.x !== 0 ? pwt.worldScale.x : 1;
                const sy = pwt.worldScale.y !== 0 ? pwt.worldScale.y : 1;
                localX = (dx * cos - dy * sin) / sx;
                localY = (dx * sin + dy * cos) / sy;
                localAngle = localAngle - parentAngleZ;
            }
        }

        const half = localAngle * 0.5;
        const cosH = Math.cos(half);
        const sinH = Math.sin(half);

        if (getTransformPtr && engF32) {
            const tPtr = getTransformPtr(entityId);
            if (tPtr) {
                const fi = tPtr >> 2;
                // Physics owns position + rotation only; scale (fi+7..9 local,
                // fi+17..19 world) is left untouched, matching the batch path —
                // clobbering it to 1 shrank a scaled dynamic body the moment any
                // physics body gained a Parent (which routes all bodies here).
                engF32[fi]      = localX;
                engF32[fi + 1]  = localY;
                engF32[fi + 2]  = 0;
                engF32[fi + 3]  = 0;
                engF32[fi + 4]  = 0;
                engF32[fi + 5]  = sinH;
                engF32[fi + 6]  = cosH;
                engF32[fi + 10] = localX;
                engF32[fi + 11] = localY;
                engF32[fi + 12] = 0;
                engF32[fi + 13] = 0;
                engF32[fi + 14] = 0;
                engF32[fi + 15] = sinH;
                engF32[fi + 16] = cosH;
                continue;
            }
        }

        t.position.x = localX;
        t.position.y = localY;
        t.rotation.w = cosH;
        t.rotation.x = 0;
        t.rotation.y = 0;
        t.rotation.z = sinH;
        t.worldPosition.x = localX;
        t.worldPosition.y = localY;
        t.worldRotation.w = cosH;
        t.worldRotation.x = 0;
        t.worldRotation.y = 0;
        t.worldRotation.z = sinH;

        addFn!(entityId, t);
    }
}

// =============================================================================
// Collision event drain
// =============================================================================

interface EventAccum {
    collisionEnters: CollisionEnterEvent[];
    collisionExits: Array<{ entityA: Entity; entityB: Entity }>;
    collisionHits: CollisionHitEvent[];
    sensorEnters: SensorEvent[];
    sensorExits: SensorEvent[];
}

/**
 * Drain this fixed step's events into the per-frame accumulator. PhysicsAPI may step
 * several times per rendered frame; accumulating (rather than overwriting) keeps
 * every collision — the interpolation system publishes + clears once per frame.
 */
function collectEvents(module: PhysicsWasmModule, ppu: number, accum: EventAccum): void {
    module._physics_collectEvents();

    const enterCount = module._physics_getCollisionEnterCount();
    if (enterCount > 0) {
        const enterPtr = module._physics_getCollisionEnterBuffer() >> 2;
        for (let i = 0; i < enterCount; i++) {
            const base = enterPtr + i * COLLISION_EVENT_STRIDE;
            accum.collisionEnters.push({
                entityA: module.HEAPU32[base] as Entity,
                entityB: module.HEAPU32[base + 1] as Entity,
                normalX: module.HEAPF32[base + 2],
                normalY: module.HEAPF32[base + 3],
                contactX: module.HEAPF32[base + 4] * ppu,
                contactY: module.HEAPF32[base + 5] * ppu,
            });
        }
    }

    const exitCount = module._physics_getCollisionExitCount();
    if (exitCount > 0) {
        const exitPtr = module._physics_getCollisionExitBuffer() >> 2;
        for (let i = 0; i < exitCount; i++) {
            const base = exitPtr + i * 2;
            accum.collisionExits.push({
                entityA: module.HEAPU32[base] as Entity,
                entityB: module.HEAPU32[base + 1] as Entity,
            });
        }
    }

    const hitCount = module._physics_getHitEventCount();
    if (hitCount > 0) {
        const hitPtr = module._physics_getHitEventBuffer() >> 2;
        for (let i = 0; i < hitCount; i++) {
            const base = hitPtr + i * HIT_EVENT_STRIDE;
            accum.collisionHits.push({
                entityA: module.HEAPU32[base] as Entity,
                entityB: module.HEAPU32[base + 1] as Entity,
                pointX: module.HEAPF32[base + 2] * ppu,
                pointY: module.HEAPF32[base + 3] * ppu,
                normalX: module.HEAPF32[base + 4],
                normalY: module.HEAPF32[base + 5],
                approachSpeed: module.HEAPF32[base + 6] * ppu,
            });
        }
    }

    const sensorEnterCount = module._physics_getSensorEnterCount();
    if (sensorEnterCount > 0) {
        const sensorEnterPtr = module._physics_getSensorEnterBuffer() >> 2;
        for (let i = 0; i < sensorEnterCount; i++) {
            const base = sensorEnterPtr + i * 2;
            accum.sensorEnters.push({
                sensorEntity: module.HEAPU32[base] as Entity,
                visitorEntity: module.HEAPU32[base + 1] as Entity,
            });
        }
    }

    const sensorExitCount = module._physics_getSensorExitCount();
    if (sensorExitCount > 0) {
        const sensorExitPtr = module._physics_getSensorExitBuffer() >> 2;
        for (let i = 0; i < sensorExitCount; i++) {
            const base = sensorExitPtr + i * 2;
            accum.sensorExits.push({
                sensorEntity: module.HEAPU32[base] as Entity,
                visitorEntity: module.HEAPU32[base + 1] as Entity,
            });
        }
    }
}

// =============================================================================
// System registration (ownership of tracked sets + per-frame loop)
// =============================================================================

interface CachedBodyProps {
    bodyType: number;
    gravityScale: number;
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
    bullet: boolean;
    /** Last-applied RigidBody.enabled — drives in-place enable/disable. */
    enabled: boolean;
    /** Bitmask of present collider components — drives shape rebuild on change. */
    colliderSig: number;
}

// The collider component types, in shape-add order. Their index is a stable bit
// in the per-entity collider signature (presence) — a change in the set, or any
// present collider's fields, triggers an in-place shape rebuild.
const COLLIDER_TYPES = [
    BoxCollider, CircleCollider, CapsuleCollider, SegmentCollider, PolygonCollider, ChainCollider,
] as const;

const JOINT_TYPES = [RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint, MotorJoint] as const;

/** Bitmask of which collider components an entity currently has. @internal */
export function colliderSignature(world: App['world'], entity: Entity): number {
    let sig = 0;
    for (let i = 0; i < COLLIDER_TYPES.length; i++) {
        if (world.has(entity, COLLIDER_TYPES[i])) sig |= 1 << i;
    }
    return sig;
}

/** True if any present collider component changed since `sinceTick`. @internal */
export function collidersChangedSince(world: App['world'], entity: Entity, sinceTick: number): boolean {
    for (const C of COLLIDER_TYPES) {
        if (world.has(entity, C) && world.isChangedSince(entity, C, sinceTick)) return true;
    }
    return false;
}

/**
 * For a tracked joint entity (invariant: ≤1 joint component): whether its joint
 * was removed, or its definition changed since `sinceTick` — either way the old
 * Box2D joint must be destroyed (createPendingJoints re-adds it if still present).
 * @internal
 */
export function jointChangedOrGone(world: App['world'], entity: Entity, sinceTick: number): boolean {
    for (const J of JOINT_TYPES) {
        if (world.has(entity, J)) return world.isChangedSince(entity, J, sinceTick);
    }
    return true; // no joint component left → gone
}

/**
 * For a tracked joint entity: whether its connected partner body is no longer
 * tracked (despawned, or its RigidBody removed). Box2D auto-destroys a joint
 * when either connected body dies, but the owner keeps its unchanged joint
 * component and stays in `trackedJoints` — so without re-establishing it here the
 * joint is silently dead forever, even after the partner respawns.
 * @internal
 */
export function jointPartnerGone(world: App['world'], entity: Entity, trackedEntities: Set<Entity>): boolean {
    for (const J of JOINT_TYPES) {
        if (world.has(entity, J)) {
            const connected = (world.get(entity, J) as { connectedEntity: number }).connectedEntity as Entity;
            return !trackedEntities.has(connected);
        }
    }
    return false;
}

/**
 * Wire the per-frame physics system into the app. Owns tracked-entity
 * / tracked-joint / parented sets via the enclosing closure so the
 * plugin doesn't need to thread them through.
 */
export function registerPhysicsSystem(
    app: App,
    module: PhysicsWasmModule,
    config: ResolvedPhysicsConfig,
): void {
    const trackedEntities = new Set<Entity>();
    const trackedJoints = new Set<Entity>();
    const trackedOneWay = new Set<Entity>();
    const parentedBodies = new Set<Entity>();
    const cachedProps = new Map<Entity, CachedBodyProps>();
    let lastEntitySyncTick = -1;
    // Events accumulated across this frame's fixed steps; published once per frame.
    const events: EventAccum = {
        collisionEnters: [], collisionExits: [], collisionHits: [], sensorEnters: [], sensorExits: [],
    };
    const fixedDt = config.fixedTimestep;

    // Change-driven reconcile: track physics components so a value edit is an O(1)
    // signal, letting the per-step reconcile skip the full entity scan in steady
    // state (no structural change + no physics-component edit). Kinematic bodies
    // are driven by their Transform, so they're tracked separately and pushed every
    // step regardless of whether the reconcile ran.
    const physicsComponents = [RigidBody, ...COLLIDER_TYPES, ...JOINT_TYPES, OneWayPlatform];
    for (const c of physicsComponents) app.world.enableChangeTracking(c);
    const kinematicEntities = new Set<Entity>();
    let lastStructuralVersion = -1;

    const world = app.world;

    world.onDespawn((entity: Entity) => {
        if (trackedJoints.has(entity)) {
            module._physics_destroyJoint(entity);
            trackedJoints.delete(entity);
        }
        if (trackedOneWay.has(entity)) {
            module._physics_setOneWayPlatform(entity, 0, 0, 0);
            trackedOneWay.delete(entity);
        }
        if (trackedEntities.has(entity)) {
            module._physics_destroyBody(entity);
            trackedEntities.delete(entity);
            cachedProps.delete(entity);
            parentedBodies.delete(entity);
            kinematicEntities.delete(entity);
            // The module's pose snapshots need no cleanup: destroying the body drops
            // it from the dynamic set the next capture rebuilds from, and the lerp is
            // driven by the current snapshot, so a stale `prev` entry is never read.
        }
    });

    // ── Step + capture (fixed cadence) ──────────────────────────────────────
    // Runs in FixedUpdate (fixed dt, framerate-independent → deterministic step
    // count). Reconciles bodies, steps Box2D once, drains events, snapshots poses.
    app.addSystemToSchedule(
        Schedule.FixedUpdate,
        defineSystem(
            [],
            () => {
                // Liveness is now auto-reported by the scheduler (this system is tagged
                // 'physics' and gated by playModeOnly, so it only beats while stepping).
                // Read pixelsPerUnit live each tick so a Canvas property
                // change at runtime (editor: user edits Canvas.pixelsPerUnit)
                // propagates to physics transforms instead of staying at the
                // value captured when the wasm module first loaded.
                const ppu = readPixelsPerUnit(app);
                const invPpu = 1 / ppu;
                // Keep the query API's default scale in sync with the live Canvas,
                // so raycast/overlap that omit `ppu` aren't silently scaled to 100.
                if (app.hasResource(Physics)) app.getResource(Physics).setPixelsPerUnit(ppu);
                // Steady-state fast path: skip the full entity reconcile unless
                // something structural changed (spawn/despawn/add-remove component →
                // structuralVersion) OR a physics component was edited (O(1) gate).
                // Otherwise the bodies are simulated by Box2D + read back in bulk.
                const structuralVersion = world.getWorldVersion();
                let needReconcile = structuralVersion !== lastStructuralVersion;
                if (!needReconcile) {
                    for (let i = 0; i < physicsComponents.length; i++) {
                        if (world.anyChangedSince(physicsComponents[i], lastEntitySyncTick)) {
                            needReconcile = true;
                            break;
                        }
                    }
                }
                if (needReconcile) {
                const entities = world.getEntitiesWithComponents([RigidBody, Transform]);
                const currentEntities = new Set<Entity>();

                // ── Unified body + collider reconcile ───────────────────────
                // Each entity's Box2D body is a reconciled projection of its
                // components: create on first enable, then bring the body in line
                // (enable/disable, props, shapes) with minimal in-place ops that
                // preserve simulation state — never destroy-and-rebuild.
                for (const entity of entities) {
                    currentEntities.add(entity);
                    const rb = world.get(entity, RigidBody) as RigidBodyData;

                    if (!trackedEntities.has(entity)) {
                        if (!rb.enabled) continue; // lazy-create on first enable
                        const wt = world.get(entity, Transform) as TransformData;
                        const hasParent = world.has(entity, Parent);
                        const posX = hasParent ? wt.worldPosition.x : wt.position.x;
                        const posY = hasParent ? wt.worldPosition.y : wt.position.y;
                        const rot = hasParent ? wt.worldRotation : wt.rotation;

                        module._physics_createBody(
                            entity, rb.bodyType,
                            posX * invPpu, posY * invPpu, quatToAngleZ(rot),
                            rb.gravityScale, rb.linearDamping, rb.angularDamping,
                            rb.fixedRotation ? 1 : 0, rb.bullet ? 1 : 0,
                        );
                        addShapeForEntity(world, module, entity, config.collisionLayerMasks);
                        trackedEntities.add(entity);
                        if (hasParent) parentedBodies.add(entity);
                        cachedProps.set(entity, {
                            bodyType: rb.bodyType,
                            gravityScale: rb.gravityScale,
                            linearDamping: rb.linearDamping,
                            angularDamping: rb.angularDamping,
                            fixedRotation: rb.fixedRotation,
                            bullet: rb.bullet,
                            enabled: true,
                            colliderSig: colliderSignature(world, entity),
                        });
                        if (rb.bodyType === BodyType.Kinematic) kinematicEntities.add(entity);
                        continue;
                    }

                    const cached = cachedProps.get(entity)!;

                    // 1. enabled toggle — in place (keeps shapes/velocity/joints).
                    if (rb.enabled !== cached.enabled) {
                        module._physics_setBodyEnabled(entity, rb.enabled ? 1 : 0);
                        cached.enabled = rb.enabled;
                    }

                    // 2. body properties.
                    if (world.isChangedSince(entity, RigidBody, lastEntitySyncTick) &&
                        (cached.bodyType !== rb.bodyType ||
                         cached.gravityScale !== rb.gravityScale ||
                         cached.linearDamping !== rb.linearDamping ||
                         cached.angularDamping !== rb.angularDamping ||
                         cached.fixedRotation !== rb.fixedRotation ||
                         cached.bullet !== rb.bullet)) {
                        module._physics_updateBodyProperties(
                            entity, rb.bodyType,
                            rb.gravityScale, rb.linearDamping, rb.angularDamping,
                            rb.fixedRotation ? 1 : 0, rb.bullet ? 1 : 0,
                        );
                        cached.bodyType = rb.bodyType;
                        cached.gravityScale = rb.gravityScale;
                        cached.linearDamping = rb.linearDamping;
                        cached.angularDamping = rb.angularDamping;
                        cached.fixedRotation = rb.fixedRotation;
                        cached.bullet = rb.bullet;
                    }

                    // 3. colliders — rebuild shapes in place when the collider set
                    //    or any collider's fields change (body + velocity preserved).
                    const sig = colliderSignature(world, entity);
                    if (sig !== cached.colliderSig ||
                        collidersChangedSince(world, entity, lastEntitySyncTick)) {
                        module._physics_clearShapes(entity);
                        addShapeForEntity(world, module, entity, config.collisionLayerMasks);
                        cached.colliderSig = sig;
                    }

                    // 4. kinematic bodies: maintain the set; the Transform→body push
                    //    runs every step outside the (gated) reconcile so it survives
                    //    skipped frames.
                    if (cached.bodyType === BodyType.Kinematic) kinematicEntities.add(entity);
                    else kinematicEntities.delete(entity);
                }

                // Bodies whose entity left the query without firing onDespawn.
                for (const entity of trackedEntities) {
                    if (!currentEntities.has(entity)) {
                        module._physics_destroyBody(entity);
                        trackedEntities.delete(entity);
                        cachedProps.delete(entity);
                        parentedBodies.delete(entity);
                        kinematicEntities.delete(entity);
                    }
                }

                // ── Joint reconcile ─────────────────────────────────────────
                // Destroy joints whose definition changed or whose component was
                // removed; createPendingJoints re-adds present+enabled ones.
                for (const entity of [...trackedJoints]) {
                    if (jointChangedOrGone(world, entity, lastEntitySyncTick)
                        || jointPartnerGone(world, entity, trackedEntities)) {
                        module._physics_destroyJoint(entity);
                        trackedJoints.delete(entity);
                    }
                }
                createPendingJoints(world, module, trackedEntities, trackedJoints, invPpu);
                syncOneWayPlatforms(world, module, trackedEntities, trackedOneWay);

                lastEntitySyncTick = world.getWorldTick();
                lastStructuralVersion = structuralVersion;
                } // end if (needReconcile)

                // Kinematic bodies are driven by their Transform (changed via gameplay,
                // not tracked as a physics edit) — push every step, even when the
                // reconcile above was skipped. Drive them toward the target over the
                // fixed step so Box2D derives their velocity from the delta: that
                // velocity is what carries/pushes resting dynamic bodies (a plain
                // teleport reports zero velocity, so platforms wouldn't move riders).
                for (const entity of kinematicEntities) {
                    const wt = world.get(entity, Transform) as TransformData;
                    module._physics_setBodyTargetTransform(
                        entity,
                        wt.worldPosition.x * invPpu, wt.worldPosition.y * invPpu,
                        quatToAngleZ(wt.worldRotation),
                        fixedDt,
                    );
                }

                if (trackedEntities.size > 0) {
                    module._physics_step(fixedDt);
                }

                collectEvents(module, ppu, events);
                module._physics_capturePoses();

                // Membership decides batch-vs-parented writeback; a runtime
                // reparent of a live body would otherwise stay on the batch path
                // and get its world pose written as a local one. Only gaining or
                // losing a Parent changes the answer, and that is a structural
                // edit, so this rides the reconcile gate rather than walking
                // every body every step.
                if (needReconcile) {
                    for (const entity of trackedEntities) {
                        if (world.has(entity, Parent)) parentedBodies.add(entity);
                        else parentedBodies.delete(entity);
                    }
                }
            },
            { name: 'PhysicsStepSystem' }
        ),
        { runIf: playModeOnly }
    );

    // ── Interpolate + publish (render cadence) ──────────────────────────────
    // Runs once per rendered frame in PostUpdate: publishes the frame's events,
    // then writes interpolated (prev→cur by Time.fixedAlpha) poses to Transforms.
    app.addSystemToSchedule(
        Schedule.PostUpdate,
        defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                app.insertResource(PhysicsEvents, {
                    collisionEnters: events.collisionEnters,
                    collisionExits: events.collisionExits,
                    collisionHits: events.collisionHits,
                    sensorEnters: events.sensorEnters,
                    sensorExits: events.sensorExits,
                });
                // Fresh arrays for next frame; the published ones stay live on the resource.
                events.collisionEnters = [];
                events.collisionExits = [];
                events.collisionHits = [];
                events.sensorEnters = [];
                events.sensorExits = [];

                const ppu = readPixelsPerUnit(app);
                applyPhysicsTransforms(app, ppu, parentedBodies, module, time.fixedAlpha);
            },
            { name: 'PhysicsInterpolateSystem' }
        ),
        { runIf: playModeOnly }
    );
}
