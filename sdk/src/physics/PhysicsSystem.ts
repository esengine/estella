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
    quatToAngleZ,
    type ResolvedPhysicsConfig,
    type CollisionEnterEvent,
    type SensorEvent,
} from './PhysicsTypes';

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
        const ptr = module._malloc(byteSize);
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
        module._free(ptr);
    }

    if (world.has(entity, ChainCollider)) {
        const chain = world.get(entity, ChainCollider) as ChainColliderData;
        const pts = chain.points;
        if (pts.length < 4) return;
        const byteSize = pts.length * 2 * 4;
        const ptr = module._malloc(byteSize);
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
        module._free(ptr);
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

/** @internal exported for testing */
export function syncDynamicTransforms(
    app: App,
    module: PhysicsWasmModule,
    ppu: number,
    parentedBodies: Set<Entity>,
): void {
    const count = module._physics_getDynamicBodyCount();
    if (count === 0) return;

    const ptr = module._physics_getDynamicBodyTransforms();
    const baseU32 = ptr >> 2;
    const physU32 = module.HEAPU32;
    const physF32 = module.HEAPF32;

    const registry = app.world.getCppRegistry();
    if (!registry) return;

    const engineMod = app.world.getWasmModule();
    const hasParented = parentedBodies.size > 0;

    if (!hasParented && engineMod?.registry_batchSyncPhysicsTransforms) {
        const byteLen = count * PHYSICS_BODY_BYTES;
        const engineBuf = engineMod._malloc(byteLen);
        engineMod.HEAPU8.set(
            new Uint8Array(module.HEAPU8.buffer, ptr, byteLen),
            engineBuf,
        );
        engineMod.registry_batchSyncPhysicsTransforms(registry, engineBuf, count, ppu);
        engineMod._free(engineBuf);
        return;
    }

    const getTransformPtr = engineMod?.getTransformPtr
        ? (e: Entity) => engineMod!.getTransformPtr(registry!, e as number)
        : null;
    const engF32 = engineMod?.HEAPF32;
    const addFn = (!getTransformPtr || !engF32)
        ? registry.addTransform.bind(registry)
        : null;

    const t = syncTransformBuf_;

    for (let i = 0; i < count; i++) {
        const offset = baseU32 + i * PHYSICS_BODY_STRIDE;
        const entityId = physU32[offset] as Entity;
        let localX = physF32[offset + 1] * ppu;
        let localY = physF32[offset + 2] * ppu;
        let localAngle = physF32[offset + 3];

        if (hasParented && parentedBodies.has(entityId)) {
            const parentData = app.world.get(entityId, Parent) as ParentData;
            if (parentData && app.world.valid(parentData.entity) && app.world.has(parentData.entity, Transform)) {
                const pwt = app.world.get(parentData.entity, Transform) as TransformData;
                const parentAngleZ = quatToAngleZ(pwt.worldRotation);
                const worldX = localX;
                const worldY = localY;
                const dx = worldX - pwt.worldPosition.x;
                const dy = worldY - pwt.worldPosition.y;
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

function collectEvents(app: App, module: PhysicsWasmModule, ppu: number): void {
    module._physics_collectEvents();

    const collisionEnters: CollisionEnterEvent[] = [];
    const enterCount = module._physics_getCollisionEnterCount();
    if (enterCount > 0) {
        const enterPtr = module._physics_getCollisionEnterBuffer() >> 2;
        for (let i = 0; i < enterCount; i++) {
            const base = enterPtr + i * COLLISION_EVENT_STRIDE;
            collisionEnters.push({
                entityA: module.HEAPU32[base] as Entity,
                entityB: module.HEAPU32[base + 1] as Entity,
                normalX: module.HEAPF32[base + 2],
                normalY: module.HEAPF32[base + 3],
                contactX: module.HEAPF32[base + 4] * ppu,
                contactY: module.HEAPF32[base + 5] * ppu,
            });
        }
    }

    const collisionExits: Array<{ entityA: Entity; entityB: Entity }> = [];
    const exitCount = module._physics_getCollisionExitCount();
    if (exitCount > 0) {
        const exitPtr = module._physics_getCollisionExitBuffer() >> 2;
        for (let i = 0; i < exitCount; i++) {
            const base = exitPtr + i * 2;
            collisionExits.push({
                entityA: module.HEAPU32[base] as Entity,
                entityB: module.HEAPU32[base + 1] as Entity,
            });
        }
    }

    const sensorEnters: SensorEvent[] = [];
    const sensorEnterCount = module._physics_getSensorEnterCount();
    if (sensorEnterCount > 0) {
        const sensorEnterPtr = module._physics_getSensorEnterBuffer() >> 2;
        for (let i = 0; i < sensorEnterCount; i++) {
            const base = sensorEnterPtr + i * 2;
            sensorEnters.push({
                sensorEntity: module.HEAPU32[base] as Entity,
                visitorEntity: module.HEAPU32[base + 1] as Entity,
            });
        }
    }

    const sensorExits: SensorEvent[] = [];
    const sensorExitCount = module._physics_getSensorExitCount();
    if (sensorExitCount > 0) {
        const sensorExitPtr = module._physics_getSensorExitBuffer() >> 2;
        for (let i = 0; i < sensorExitCount; i++) {
            const base = sensorExitPtr + i * 2;
            sensorExits.push({
                sensorEntity: module.HEAPU32[base] as Entity,
                visitorEntity: module.HEAPU32[base + 1] as Entity,
            });
        }
    }

    app.insertResource(PhysicsEvents, {
        collisionEnters,
        collisionExits,
        sensorEnters,
        sensorExits
    });
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
        }
    });

    app.addSystemToSchedule(
        Schedule.PostUpdate,
        defineSystem(
            [Res(Time)],
            (time: TimeData) => {
                // Read pixelsPerUnit live each tick so a Canvas property
                // change at runtime (editor: user edits Canvas.pixelsPerUnit)
                // propagates to physics transforms instead of staying at the
                // value captured when the wasm module first loaded.
                const ppu = readPixelsPerUnit(app);
                const invPpu = 1 / ppu;
                const entities = world.getEntitiesWithComponents([RigidBody, Transform]);
                const currentEntities = new Set<Entity>();

                for (const entity of entities) {
                    currentEntities.add(entity);

                    if (!trackedEntities.has(entity)) {
                        const rb = world.get(entity, RigidBody) as RigidBodyData;
                        if (!rb.enabled) continue;
                        const wt = world.get(entity, Transform) as TransformData;
                        const hasParent = world.has(entity, Parent);
                        const posX = hasParent ? wt.worldPosition.x : wt.position.x;
                        const posY = hasParent ? wt.worldPosition.y : wt.position.y;
                        const rot = hasParent ? wt.worldRotation : wt.rotation;
                        const angle = quatToAngleZ(rot);

                        module._physics_createBody(
                            entity, rb.bodyType,
                            posX * invPpu, posY * invPpu, angle,
                            rb.gravityScale, rb.linearDamping, rb.angularDamping,
                            rb.fixedRotation ? 1 : 0, rb.bullet ? 1 : 0
                        );

                        addShapeForEntity(app, module, entity, config.collisionLayerMasks);
                        trackedEntities.add(entity);
                        if (world.has(entity, Parent)) {
                            parentedBodies.add(entity);
                        }
                        cachedProps.set(entity, {
                            bodyType: rb.bodyType,
                            gravityScale: rb.gravityScale,
                            linearDamping: rb.linearDamping,
                            angularDamping: rb.angularDamping,
                            fixedRotation: rb.fixedRotation,
                            bullet: rb.bullet,
                        });
                    } else {
                        if (world.isChangedSince(entity, RigidBody, lastEntitySyncTick)) {
                            const rb = world.get(entity, RigidBody) as RigidBodyData;
                            const prev = cachedProps.get(entity);
                            if (prev &&
                                (prev.bodyType !== rb.bodyType ||
                                 prev.gravityScale !== rb.gravityScale ||
                                 prev.linearDamping !== rb.linearDamping ||
                                 prev.angularDamping !== rb.angularDamping ||
                                 prev.fixedRotation !== rb.fixedRotation ||
                                 prev.bullet !== rb.bullet)) {
                                module._physics_updateBodyProperties(
                                    entity, rb.bodyType,
                                    rb.gravityScale, rb.linearDamping, rb.angularDamping,
                                    rb.fixedRotation ? 1 : 0, rb.bullet ? 1 : 0
                                );
                                prev.bodyType = rb.bodyType;
                                prev.gravityScale = rb.gravityScale;
                                prev.linearDamping = rb.linearDamping;
                                prev.angularDamping = rb.angularDamping;
                                prev.fixedRotation = rb.fixedRotation;
                                prev.bullet = rb.bullet;
                            }
                        }

                        const cached = cachedProps.get(entity);
                        if (cached && cached.bodyType === BodyType.Kinematic) {
                            const wt = world.get(entity, Transform) as TransformData;
                            const angle = quatToAngleZ(wt.worldRotation);
                            module._physics_setBodyTransform(
                                entity,
                                wt.worldPosition.x * invPpu, wt.worldPosition.y * invPpu,
                                angle
                            );
                        }
                    }
                }

                lastEntitySyncTick = world.getWorldTick();

                for (const entity of trackedEntities) {
                    if (!currentEntities.has(entity)) {
                        module._physics_destroyBody(entity);
                        trackedEntities.delete(entity);
                        cachedProps.delete(entity);
                    }
                }

                createPendingJoints(world, module, trackedEntities, trackedJoints, invPpu);

                if (trackedEntities.size > 0 && time.delta > 0) {
                    module._physics_step(time.delta);
                }

                syncDynamicTransforms(app, module, ppu, parentedBodies);
                collectEvents(app, module, ppu);
            },
            { name: 'PhysicsSystem' }
        ),
        { runIf: playModeOnly }
    );
}
