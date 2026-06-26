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

import type { App } from '../app';
import type { Entity } from '../types';
import type { TransformData, ParentData, CanvasData } from '../component';
import { Transform, Parent, Canvas } from '../component';
import { Res, Time, type TimeData } from '../resource';
import { Schedule, defineSystem } from '../system';
import { playModeOnly } from '../env';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';
import { PhysicsAPI } from './Physics';
import {
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider,
    SegmentCollider, PolygonCollider, ChainCollider,
    RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint,
    BodyType,
    type RigidBodyData, type BoxColliderData, type CircleColliderData,
    type CapsuleColliderData, type SegmentColliderData, type PolygonColliderData,
    type ChainColliderData, type RevoluteJointData,
    type DistanceJointData, type PrismaticJointData, type WeldJointData, type WheelJointData,
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
import { withMalloc } from '../wasmScratch';

// =============================================================================
// Canvas pixelsPerUnit live read
// =============================================================================

function readPixelsPerUnit(app: App): number {
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

function addShapeForEntity(app: App, module: PhysicsWasmModule, entity: Entity, layerMasks?: number[]): void {
    const world = app.world;

    if (world.has(entity, BoxCollider)) {
        const box = world.get(entity, BoxCollider) as BoxColliderData;
        const category = box.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, box.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addBoxShape(
            entity, box.halfExtents.x, box.halfExtents.y,
            box.offset.x, box.offset.y, box.radius ?? 0.05,
            box.density, box.friction, box.restitution, box.isSensor ? 1 : 0,
            category, mask
        );
    }

    if (world.has(entity, CircleCollider)) {
        const circle = world.get(entity, CircleCollider) as CircleColliderData;
        const category = circle.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, circle.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addCircleShape(
            entity, circle.radius,
            circle.offset.x, circle.offset.y,
            circle.density, circle.friction, circle.restitution, circle.isSensor ? 1 : 0,
            category, mask
        );
    }

    if (world.has(entity, CapsuleCollider)) {
        const capsule = world.get(entity, CapsuleCollider) as CapsuleColliderData;
        const category = capsule.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, capsule.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addCapsuleShape(
            entity, capsule.radius, capsule.halfHeight,
            capsule.offset.x, capsule.offset.y,
            capsule.density, capsule.friction, capsule.restitution, capsule.isSensor ? 1 : 0,
            category, mask
        );
    }

    if (world.has(entity, SegmentCollider)) {
        const seg = world.get(entity, SegmentCollider) as SegmentColliderData;
        const category = seg.categoryBits ?? 0x0001;
        const mask = resolveCollisionMask(category, seg.maskBits ?? 0xFFFF, layerMasks);
        module._physics_addSegmentShape(
            entity, seg.point1.x, seg.point1.y, seg.point2.x, seg.point2.y,
            seg.density, seg.friction, seg.restitution, seg.isSensor ? 1 : 0,
            category, mask
        );
    }

    if (world.has(entity, PolygonCollider)) {
        const poly = world.get(entity, PolygonCollider) as PolygonColliderData;
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

    if (world.has(entity, ChainCollider)) {
        const chain = world.get(entity, ChainCollider) as ChainColliderData;
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

/** Raw physics-space pose (meters + radians) of one body, for interpolation. */
interface Pose { x: number; y: number; angle: number; }
/** The two most recent fixed-step poses, keyed by entity, for render interp. */
export interface PoseSnapshots { prev: Map<Entity, Pose>; cur: Map<Entity, Pose>; }

// Shortest-arc angle interpolation (radians).
function lerpAngle(a: number, b: number, t: number): number {
    let d = (b - a) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
}

/**
 * Capture post-step body poses for render interpolation: the previous `cur`
 * becomes `prev`, then `cur` is refilled from the batched read-back. A body seen
 * for the first time seeds `prev = cur`, so it doesn't smear on its first frame.
 * @internal exported for testing
 */
export function capturePhysicsPoses(module: PhysicsWasmModule, snaps: PoseSnapshots): void {
    const tmp = snaps.prev;
    snaps.prev = snaps.cur;
    snaps.cur = tmp;
    snaps.cur.clear();

    const count = module._physics_getDynamicBodyCount();
    if (count === 0) return;
    const baseU32 = module._physics_getDynamicBodyTransforms() >> 2;
    const u32 = module.HEAPU32;
    const f32 = module.HEAPF32;
    for (let i = 0; i < count; i++) {
        const o = baseU32 + i * PHYSICS_BODY_STRIDE;
        const e = u32[o] as Entity;
        const x = f32[o + 1], y = f32[o + 2], angle = f32[o + 3];
        snaps.cur.set(e, { x, y, angle });
        if (!snaps.prev.has(e)) snaps.prev.set(e, { x, y, angle });
    }
}

/**
 * Write interpolated body poses into ECS Transforms: each `cur` body is lerped
 * from `prev` by `alpha` (linear position, shortest-arc angle) and applied via
 * the engine's batched sync (or a per-entity path for parented bodies). With
 * `alpha = 1` this reproduces a direct post-step sync.
 * @internal exported for testing
 */
export function applyPhysicsTransforms(
    app: App,
    ppu: number,
    parentedBodies: Set<Entity>,
    snaps: PoseSnapshots,
    alpha: number,
): void {
    const cur = snaps.cur;
    const count = cur.size;
    if (count === 0) return;

    const registry = app.world.getCppRegistry();
    if (!registry) return;
    const engineMod = app.world.getWasmModule();
    const hasParented = parentedBodies.size > 0;

    // Batched fast path: build [u32 entity, f32 x, y, angle] (meters) interpolated.
    if (!hasParented && engineMod?.registry_batchSyncPhysicsTransforms) {
        withMalloc(engineMod, count * PHYSICS_BODY_BYTES, engineBuf => {
            const u32 = engineMod.HEAPU32;
            const f32 = engineMod.HEAPF32;
            const base = engineBuf >> 2;
            let i = 0;
            for (const [e, c] of cur) {
                const p = snaps.prev.get(e) ?? c;
                const o = base + i * PHYSICS_BODY_STRIDE;
                u32[o] = e as number;
                f32[o + 1] = p.x + (c.x - p.x) * alpha;
                f32[o + 2] = p.y + (c.y - p.y) * alpha;
                f32[o + 3] = lerpAngle(p.angle, c.angle, alpha);
                i++;
            }
            engineMod.registry_batchSyncPhysicsTransforms(registry, engineBuf, count, ppu);
        });
        return;
    }

    const getTransformPtr = engineMod?.getTransformPtr
        ? (e: Entity) => engineMod!.getTransformPtr(registry!, e as number)
        : null;
    const engF32 = engineMod?.HEAPF32;
    const addFn = (!getTransformPtr || !engF32) ? registry.addTransform.bind(registry) : null;
    const t = syncTransformBuf_;

    for (const [entityId, c] of cur) {
        const p = snaps.prev.get(entityId) ?? c;
        let localX = (p.x + (c.x - p.x) * alpha) * ppu;
        let localY = (p.y + (c.y - p.y) * alpha) * ppu;
        let localAngle = lerpAngle(p.angle, c.angle, alpha);

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
                engF32[fi]      = localX;
                engF32[fi + 1]  = localY;
                engF32[fi + 2]  = 0;
                engF32[fi + 3]  = 0;
                engF32[fi + 4]  = 0;
                engF32[fi + 5]  = sinH;
                engF32[fi + 6]  = cosH;
                engF32[fi + 7]  = 1;
                engF32[fi + 8]  = 1;
                engF32[fi + 9]  = 1;
                engF32[fi + 10] = localX;
                engF32[fi + 11] = localY;
                engF32[fi + 12] = 0;
                engF32[fi + 13] = 0;
                engF32[fi + 14] = 0;
                engF32[fi + 15] = sinH;
                engF32[fi + 16] = cosH;
                engF32[fi + 17] = 1;
                engF32[fi + 18] = 1;
                engF32[fi + 19] = 1;
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
 * Drain this fixed step's events into the per-frame accumulator. Physics may step
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

const JOINT_TYPES = [RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint] as const;

/** Bitmask of which collider components an entity currently has. @internal */
export function colliderSignature(world: App['world'], entity: Entity): number {
    let sig = 0;
    for (let i = 0; i < COLLIDER_TYPES.length; i++) {
        if (world.has(entity, COLLIDER_TYPES[i])) sig |= 1 << i;
    }
    return sig;
}

/** True if any present collider component changed since `sinceTick`. */
function collidersChangedSince(world: App['world'], entity: Entity, sinceTick: number): boolean {
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
    const parentedBodies = new Set<Entity>();
    const cachedProps = new Map<Entity, CachedBodyProps>();
    let lastEntitySyncTick = -1;
    // The two most recent fixed-step poses, for render interpolation (the
    // PostUpdate system lerps prev→cur by Time.fixedAlpha).
    const snaps: PoseSnapshots = { prev: new Map(), cur: new Map() };
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
    const physicsComponents = [RigidBody, ...COLLIDER_TYPES, ...JOINT_TYPES];
    for (const c of physicsComponents) app.world.enableChangeTracking(c);
    const kinematicEntities = new Set<Entity>();
    let lastStructuralVersion = -1;

    const world = app.world;

    world.onDespawn((entity: Entity) => {
        if (trackedJoints.has(entity)) {
            module._physics_destroyJoint(entity);
            trackedJoints.delete(entity);
        }
        if (trackedEntities.has(entity)) {
            module._physics_destroyBody(entity);
            trackedEntities.delete(entity);
            cachedProps.delete(entity);
            parentedBodies.delete(entity);
            kinematicEntities.delete(entity);
            snaps.prev.delete(entity);
            snaps.cur.delete(entity);
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
                // Watchdog beat: gated by playModeOnly, so a fresh beat means
                // "physics is actually stepping" (vs loaded-but-frozen in edit mode).
                app.subsystems.markStepped('physics');
                // Read pixelsPerUnit live each tick so a Canvas property
                // change at runtime (editor: user edits Canvas.pixelsPerUnit)
                // propagates to physics transforms instead of staying at the
                // value captured when the wasm module first loaded.
                const ppu = readPixelsPerUnit(app);
                const invPpu = 1 / ppu;
                // Keep the query API's default scale in sync with the live Canvas,
                // so raycast/overlap that omit `ppu` aren't silently scaled to 100.
                if (app.hasResource(PhysicsAPI)) app.getResource(PhysicsAPI).setPixelsPerUnit(ppu);
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
                        addShapeForEntity(app, module, entity, config.collisionLayerMasks);
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
                        addShapeForEntity(app, module, entity, config.collisionLayerMasks);
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
                    if (jointChangedOrGone(world, entity, lastEntitySyncTick)) {
                        module._physics_destroyJoint(entity);
                        trackedJoints.delete(entity);
                    }
                }
                createPendingJoints(world, module, trackedEntities, trackedJoints, invPpu);

                lastEntitySyncTick = world.getWorldTick();
                lastStructuralVersion = structuralVersion;
                } // end if (needReconcile)

                // Kinematic bodies are driven by their Transform (changed via gameplay,
                // not tracked as a physics edit) — push every step, even when the
                // reconcile above was skipped.
                for (const entity of kinematicEntities) {
                    const wt = world.get(entity, Transform) as TransformData;
                    module._physics_setBodyTransform(
                        entity,
                        wt.worldPosition.x * invPpu, wt.worldPosition.y * invPpu,
                        quatToAngleZ(wt.worldRotation),
                    );
                }

                if (trackedEntities.size > 0) {
                    module._physics_step(fixedDt);
                }

                collectEvents(module, ppu, events);
                capturePhysicsPoses(module, snaps);
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
                applyPhysicsTransforms(app, ppu, parentedBodies, snaps, time.fixedAlpha);
            },
            { name: 'PhysicsInterpolateSystem' }
        ),
        { runIf: playModeOnly }
    );
}
