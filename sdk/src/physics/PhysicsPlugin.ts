/**
 * @file    PhysicsPlugin.ts
 * @brief   Physics plugin using standalone Physics WASM module
 */

import type { Plugin, App } from '../app';
import type { Entity, Vec2 } from '../types';
import type { TransformData, ParentData, CanvasData } from '../component';
import { Transform, Parent, Canvas } from '../component';
import { defineResource, Res, Time, type TimeData } from '../resource';
import { Schedule, defineSystem } from '../system';
import { isEditor, isPlayMode } from '../env';
import {
    loadPhysicsModule,
    type PhysicsWasmModule,
    type PhysicsModuleFactory,
} from './PhysicsModuleLoader';
import {
    RigidBody, BoxCollider, CircleCollider, CapsuleCollider,
    SegmentCollider, PolygonCollider, ChainCollider,
    RevoluteJoint,
    BodyType,
    type RigidBodyData, type BoxColliderData, type CircleColliderData,
    type CapsuleColliderData, type SegmentColliderData, type PolygonColliderData,
    type ChainColliderData, type RevoluteJointData,
} from './PhysicsComponents';
import { setupPhysicsDebugDraw, PhysicsDebugDraw, type PhysicsDebugDrawConfig } from './PhysicsDebugDraw';

// =============================================================================
// Physics Config
// =============================================================================

export interface PhysicsPluginConfig {
    gravity?: Vec2;
    fixedTimestep?: number;
    subStepCount?: number;
    contactHertz?: number;
    contactDampingRatio?: number;
    contactSpeed?: number;
    collisionLayerMasks?: number[];
}

// =============================================================================
// Collision Event Types
// =============================================================================

export interface CollisionEnterEvent {
    entityA: Entity;
    entityB: Entity;
    normalX: number;
    normalY: number;
    contactX: number;
    contactY: number;
}

export interface SensorEvent {
    sensorEntity: Entity;
    visitorEntity: Entity;
}

export interface PhysicsEventsData {
    collisionEnters: CollisionEnterEvent[];
    collisionExits: Array<{ entityA: Entity; entityB: Entity }>;
    sensorEnters: SensorEvent[];
    sensorExits: SensorEvent[];
}

export const PhysicsEvents = defineResource<PhysicsEventsData>({
    collisionEnters: [],
    collisionExits: [],
    sensorEnters: [],
    sensorExits: []
}, 'PhysicsEvents');

export const PhysicsAPI = defineResource<Physics>(null!, 'PhysicsAPI');

// =============================================================================
// Quaternion <-> angle helpers
// =============================================================================

function quatToAngleZ(q: { w: number; x: number; y: number; z: number }): number {
    return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

function angleZToQuat(angle: number): { w: number; x: number; y: number; z: number } {
    const half = angle * 0.5;
    return { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) };
}

// =============================================================================
// Physics Plugin
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

export class PhysicsPlugin implements Plugin {
    private config_: Required<Omit<PhysicsPluginConfig, 'collisionLayerMasks'>> & Pick<PhysicsPluginConfig, 'collisionLayerMasks'>;
    private wasmUrl_: string;
    private factory_?: PhysicsModuleFactory;

    constructor(wasmUrl: string, config: PhysicsPluginConfig = {}, factory?: PhysicsModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = {
            gravity: config.gravity ?? { x: 0, y: -9.81 },
            fixedTimestep: config.fixedTimestep ?? 1 / 30,
            subStepCount: config.subStepCount ?? 4,
            contactHertz: config.contactHertz ?? 30,
            contactDampingRatio: config.contactDampingRatio ?? 10,
            contactSpeed: config.contactSpeed ?? 3,
            collisionLayerMasks: config.collisionLayerMasks,
        };
    }

    build(app: App): void {
        app.insertResource(PhysicsEvents, {
            collisionEnters: [],
            collisionExits: [],
            sensorEnters: [],
            sensorExits: []
        });

        const trackedEntities = new Set<Entity>();
        const trackedJoints = new Set<Entity>();
        const parentedBodies = new Set<Entity>();
        const cachedProps = new Map<Entity, { bodyType: number; gravityScale: number; linearDamping: number; angularDamping: number; fixedRotation: boolean; bullet: boolean }>();
        let lastEntitySyncTick = -1;

        const initPromise = loadPhysicsModule(this.wasmUrl_, this.factory_).then(
            (module: PhysicsWasmModule) => {
                module._physics_init(
                    this.config_.gravity.x,
                    this.config_.gravity.y,
                    this.config_.fixedTimestep,
                    this.config_.subStepCount,
                    this.config_.contactHertz,
                    this.config_.contactDampingRatio,
                    this.config_.contactSpeed
                );

                const ppu = readPixelsPerUnit(app);
                const invPpu = 1 / ppu;
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
                            if (isEditor() && !isPlayMode()) return;

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

                                    addShapeForEntity(app, module, entity, this.config_.collisionLayerMasks);
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
                    )
                );

                app.physicsModule = module;
                app.insertResource(PhysicsAPI, Physics._fromModule(module));
                setupPhysicsDebugDraw(app, PhysicsAPI, PhysicsEvents);
                app.setFixedTimestep(this.config_.fixedTimestep);
            }
        );

        initPromise.catch((e) => {
            console.error('[ESEngine] Physics initialization failed:', e);
        });
        app.physicsInitPromise = initPromise;
    }
}

// =============================================================================
// Internal helpers
// =============================================================================

const MAX_COLLISION_LAYERS = 16;

function resolveCollisionMask(categoryBits: number, maskBits: number, layerMasks?: number[]): number {
    if (!layerMasks) return maskBits;
    for (let i = 0; i < MAX_COLLISION_LAYERS; i++) {
        if (categoryBits === (1 << i)) return layerMasks[i];
    }
    return maskBits;
}

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
        return;
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
        return;
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
        return;
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
        return;
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
        return;
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

        const connectedEntity = joint.connectedEntity as Entity;
        if (!trackedEntities.has(connectedEntity)) continue;

        module._physics_createRevoluteJoint(
            connectedEntity, entity,
            joint.anchorA.x * invPpu, joint.anchorA.y * invPpu,
            joint.anchorB.x * invPpu, joint.anchorB.y * invPpu,
            joint.enableMotor ? 1 : 0, joint.motorSpeed, joint.maxMotorTorque,
            joint.enableLimit ? 1 : 0, joint.lowerAngle, joint.upperAngle,
            joint.collideConnected ? 1 : 0,
        );
        trackedJoints.add(entity);
    }
}

const syncTransformBuf_ = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    worldPosition: { x: 0, y: 0, z: 0 },
    worldRotation: { w: 1, x: 0, y: 0, z: 0 },
    worldScale: { x: 1, y: 1, z: 1 },
};

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
    const heap32 = module.HEAPU32;
    const heapF = module.HEAPF32;

    const registry = app.world.getCppRegistry();
    if (!registry) return;
    const addFn = registry.addTransform.bind(registry);
    const hasParented = parentedBodies.size > 0;
    const t = syncTransformBuf_;

    for (let i = 0; i < count; i++) {
        const offset = baseU32 + i * 4;
        const entityId = heap32[offset] as Entity;
        let localX = heapF[offset + 1] * ppu;
        let localY = heapF[offset + 2] * ppu;
        let localAngle = heapF[offset + 3];

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

        addFn(entityId, t);
    }
}

function collectEvents(app: App, module: PhysicsWasmModule, ppu: number): void {
    module._physics_collectEvents();

    const collisionEnters: CollisionEnterEvent[] = [];
    const enterCount = module._physics_getCollisionEnterCount();
    if (enterCount > 0) {
        const enterPtr = module._physics_getCollisionEnterBuffer() >> 2;
        for (let i = 0; i < enterCount; i++) {
            const base = enterPtr + i * 6;
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
// Physics API Helper
// =============================================================================

export class Physics {
    private module_: PhysicsWasmModule;

    constructor(app: App) {
        this.module_ = app.physicsModule as PhysicsWasmModule;
        if (!this.module_) {
            throw new Error('Physics module not loaded. Ensure PhysicsPlugin init is complete.');
        }
    }

    /** @internal */
    static _fromModule(module: PhysicsWasmModule): Physics {
        const instance = Object.create(Physics.prototype) as Physics;
        instance.module_ = module;
        return instance;
    }

    applyForce(entity: Entity, force: Vec2): void {
        this.module_._physics_applyForce(entity, force.x, force.y);
    }

    applyImpulse(entity: Entity, impulse: Vec2): void {
        this.module_._physics_applyImpulse(entity, impulse.x, impulse.y);
    }

    setLinearVelocity(entity: Entity, velocity: Vec2): void {
        this.module_._physics_setLinearVelocity(entity, velocity.x, velocity.y);
    }

    getLinearVelocity(entity: Entity): Vec2 {
        const ptr = this.module_._physics_getLinearVelocity(entity);
        const base = ptr >> 2;
        return { x: this.module_.HEAPF32[base], y: this.module_.HEAPF32[base + 1] };
    }

    setGravity(gravity: Vec2): void {
        this.module_._physics_setGravity(gravity.x, gravity.y);
    }

    getGravity(): Vec2 {
        const ptr = this.module_._physics_getGravity();
        const base = ptr >> 2;
        return { x: this.module_.HEAPF32[base], y: this.module_.HEAPF32[base + 1] };
    }

    setAngularVelocity(entity: Entity, omega: number): void {
        this.module_._physics_setAngularVelocity(entity, omega);
    }

    getAngularVelocity(entity: Entity): number {
        return this.module_._physics_getAngularVelocity(entity);
    }

    applyTorque(entity: Entity, torque: number): void {
        this.module_._physics_applyTorque(entity, torque);
    }

    applyAngularImpulse(entity: Entity, impulse: number): void {
        this.module_._physics_applyAngularImpulse(entity, impulse);
    }

    createRevoluteJoint(
        entityA: Entity, entityB: Entity,
        anchorA: Vec2, anchorB: Vec2,
        options?: {
            enableMotor?: boolean; motorSpeed?: number; maxMotorTorque?: number;
            enableLimit?: boolean; lowerAngle?: number; upperAngle?: number;
            collideConnected?: boolean;
        }
    ): boolean {
        const o = options ?? {};
        return this.module_._physics_createRevoluteJoint(
            entityA, entityB,
            anchorA.x, anchorA.y, anchorB.x, anchorB.y,
            o.enableMotor ? 1 : 0, o.motorSpeed ?? 0, o.maxMotorTorque ?? 0,
            o.enableLimit ? 1 : 0, o.lowerAngle ?? 0, o.upperAngle ?? 0,
            o.collideConnected ? 1 : 0,
        ) !== 0;
    }

    destroyJoint(entity: Entity): void {
        this.module_._physics_destroyJoint(entity);
    }

    setRevoluteMotorSpeed(entity: Entity, speed: number): void {
        this.module_._physics_setRevoluteMotorSpeed(entity, speed);
    }

    setRevoluteMaxMotorTorque(entity: Entity, torque: number): void {
        this.module_._physics_setRevoluteMaxMotorTorque(entity, torque);
    }

    enableRevoluteMotor(entity: Entity, enable: boolean): void {
        this.module_._physics_enableRevoluteMotor(entity, enable ? 1 : 0);
    }

    enableRevoluteLimit(entity: Entity, enable: boolean): void {
        this.module_._physics_enableRevoluteLimit(entity, enable ? 1 : 0);
    }

    setRevoluteLimits(entity: Entity, lower: number, upper: number): void {
        this.module_._physics_setRevoluteLimits(entity, lower, upper);
    }

    getRevoluteAngle(entity: Entity): number {
        return this.module_._physics_getRevoluteAngle(entity);
    }

    getRevoluteMotorTorque(entity: Entity): number {
        return this.module_._physics_getRevoluteMotorTorque(entity);
    }

    static setDebugDraw(app: App, enabled: boolean): void {
        const config = app.getResource<PhysicsDebugDrawConfig>(PhysicsDebugDraw);
        if (config) {
            config.enabled = enabled;
            app.insertResource(PhysicsDebugDraw, config);
        }
    }

    static setDebugDrawConfig(app: App, config: Partial<PhysicsDebugDrawConfig>): void {
        const current = app.getResource<PhysicsDebugDrawConfig>(PhysicsDebugDraw);
        if (current) {
            app.insertResource(PhysicsDebugDraw, { ...current, ...config });
        }
    }
}
