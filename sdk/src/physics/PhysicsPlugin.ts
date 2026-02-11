/**
 * @file    PhysicsPlugin.ts
 * @brief   Physics plugin using standalone Physics WASM module
 */

import type { Plugin, App } from '../app';
import type { Entity, Vec2 } from '../types';
import type { LocalTransformData } from '../component';
import { LocalTransform, RigidBody, BoxCollider, CircleCollider, CapsuleCollider } from '../component';
import { defineResource, Res, Time, type TimeData } from '../resource';
import { Schedule, defineSystem } from '../system';
import {
    loadPhysicsModule,
    type PhysicsWasmModule,
    type PhysicsModuleFactory,
} from './PhysicsModuleLoader';
import type { RigidBodyData } from './PhysicsComponents';
import { BodyType } from './PhysicsComponents';

// =============================================================================
// Physics Config
// =============================================================================

export interface PhysicsPluginConfig {
    gravity?: Vec2;
    fixedTimestep?: number;
    subStepCount?: number;
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

export class PhysicsPlugin implements Plugin {
    private config_: Required<PhysicsPluginConfig>;
    private wasmUrl_: string;
    private factory_?: PhysicsModuleFactory;

    constructor(wasmUrl: string, config: PhysicsPluginConfig = {}, factory?: PhysicsModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
        this.config_ = {
            gravity: config.gravity ?? { x: 0, y: -9.81 },
            fixedTimestep: config.fixedTimestep ?? 1 / 60,
            subStepCount: config.subStepCount ?? 4
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

        const initPromise = loadPhysicsModule(this.wasmUrl_, this.factory_).then(
            (module: PhysicsWasmModule) => {
                module._physics_init(
                    this.config_.gravity.x,
                    this.config_.gravity.y,
                    this.config_.fixedTimestep,
                    this.config_.subStepCount
                );

                const world = app.world;

                app.addSystemToSchedule(
                    Schedule.PostUpdate,
                    defineSystem(
                        [Res(Time)],
                        (time: TimeData) => {
                            const entities = world.getEntitiesWithComponents([RigidBody, LocalTransform]);
                            const currentEntities = new Set<Entity>();

                            for (const entity of entities) {
                                currentEntities.add(entity);
                                const rb = world.get(entity, RigidBody) as RigidBodyData;
                                const transform = world.get(entity, LocalTransform) as LocalTransformData;

                                if (!trackedEntities.has(entity)) {
                                    if (!rb.enabled) continue;

                                    const angle = quatToAngleZ(transform.rotation);

                                    module._physics_createBody(
                                        entity, rb.bodyType,
                                        transform.position.x, transform.position.y, angle,
                                        rb.gravityScale, rb.linearDamping, rb.angularDamping,
                                        rb.fixedRotation ? 1 : 0, rb.bullet ? 1 : 0
                                    );

                                    addShapeForEntity(app, module, entity);
                                    trackedEntities.add(entity);
                                }

                                if (rb.bodyType === BodyType.Kinematic) {
                                    const angle = quatToAngleZ(transform.rotation);
                                    module._physics_setBodyTransform(
                                        entity,
                                        transform.position.x, transform.position.y,
                                        angle
                                    );
                                }
                            }

                            for (const entity of trackedEntities) {
                                if (!currentEntities.has(entity)) {
                                    module._physics_destroyBody(entity);
                                    trackedEntities.delete(entity);
                                }
                            }

                            module._physics_step(time.delta);

                            syncDynamicTransforms(app, module);
                            collectEvents(app, module);
                        },
                        { name: 'PhysicsSystem' }
                    )
                );

                (app as any).__physicsModule = module;
            }
        );

        (app as any).__physicsInitPromise = initPromise;
    }
}

// =============================================================================
// Internal helpers
// =============================================================================

function addShapeForEntity(app: App, module: PhysicsWasmModule, entity: Entity): void {
    const world = app.world;

    if (world.has(entity, BoxCollider)) {
        const box = world.get(entity, BoxCollider) as { halfExtents: Vec2; offset: Vec2; density: number; friction: number; restitution: number; isSensor: boolean };
        module._physics_addBoxShape(
            entity, box.halfExtents.x, box.halfExtents.y,
            box.offset.x, box.offset.y,
            box.density, box.friction, box.restitution, box.isSensor ? 1 : 0
        );
        return;
    }

    if (world.has(entity, CircleCollider)) {
        const circle = world.get(entity, CircleCollider) as { radius: number; offset: Vec2; density: number; friction: number; restitution: number; isSensor: boolean };
        module._physics_addCircleShape(
            entity, circle.radius,
            circle.offset.x, circle.offset.y,
            circle.density, circle.friction, circle.restitution, circle.isSensor ? 1 : 0
        );
        return;
    }

    if (world.has(entity, CapsuleCollider)) {
        const capsule = world.get(entity, CapsuleCollider) as { radius: number; halfHeight: number; offset: Vec2; density: number; friction: number; restitution: number; isSensor: boolean };
        module._physics_addCapsuleShape(
            entity, capsule.radius, capsule.halfHeight,
            capsule.offset.x, capsule.offset.y,
            capsule.density, capsule.friction, capsule.restitution, capsule.isSensor ? 1 : 0
        );
    }
}

function syncDynamicTransforms(app: App, module: PhysicsWasmModule): void {
    const count = module._physics_getDynamicBodyCount();
    if (count === 0) return;

    const ptr = module._physics_getDynamicBodyTransforms();
    const baseU32 = ptr >> 2;

    for (let i = 0; i < count; i++) {
        const offset = baseU32 + i * 4;
        const entityId = module.HEAPU32[offset] as Entity;
        const x = module.HEAPF32[offset + 1];
        const y = module.HEAPF32[offset + 2];
        const angle = module.HEAPF32[offset + 3];

        if (!app.world.valid(entityId)) continue;

        const transform = app.world.get(entityId, LocalTransform) as LocalTransformData;
        if (!transform) continue;

        transform.position.x = x;
        transform.position.y = y;
        const q = angleZToQuat(angle);
        transform.rotation.w = q.w;
        transform.rotation.x = q.x;
        transform.rotation.y = q.y;
        transform.rotation.z = q.z;
    }
}

function collectEvents(app: App, module: PhysicsWasmModule): void {
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
                contactX: module.HEAPF32[base + 4],
                contactY: module.HEAPF32[base + 5],
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
        this.module_ = (app as any).__physicsModule as PhysicsWasmModule;
        if (!this.module_) {
            throw new Error('Physics module not loaded. Ensure PhysicsPlugin init is complete.');
        }
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
}
