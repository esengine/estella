// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics.ts
 * @brief   User-facing physics API + PhysicsAPI resource
 *
 * `Physics` is the ergonomic wrapper game code uses to drive bodies
 * (forces, impulses, joints, raycasts). It is published as the
 * `PhysicsAPI` resource once `PhysicsPlugin` finishes loading the
 * wasm module; instantiation before that throws.
 */

import type { App } from '../app';
import type { Entity, Vec2 } from '../types';
import { defineResource } from '../resource';
import type { PhysicsWasmModule } from './PhysicsModuleLoader';
import { PhysicsRuntime } from './PhysicsRuntime';
import { PhysicsDebugDraw, type PhysicsDebugDrawConfig } from './PhysicsDebugDraw';
import {
    CAST_HIT_STRIDE,
    type RaycastHit,
    type ShapeCastHit,
    type MassData,
    type MoverResult,
} from './PhysicsTypes';

// =============================================================================
// Physics API Helper
// =============================================================================

export class Physics {
    private module_: PhysicsWasmModule;
    // Live pixels-per-unit, pushed each frame by PhysicsSystem from the Canvas, so
    // a query that omits `ppu` is scaled correctly instead of silently assuming 100.
    private ppu_ = 100;

    /** @internal Update the pixels-per-unit used to scale queries by default. */
    setPixelsPerUnit(ppu: number): void {
        if (ppu > 0) this.ppu_ = ppu;
    }

    /**
     * Live pixels-per-unit (world pixels per Box2D meter). Collider dimensions are
     * stored in meters, so consumers that cast a collider's shape through the
     * pixel-space query API (raycast/shapeCast) must scale by this.
     */
    getPixelsPerUnit(): number {
        return this.ppu_;
    }

    constructor(app: App) {
        const module = app.hasResource(PhysicsRuntime)
            ? app.getResource(PhysicsRuntime).module
            : null;
        if (!module) {
            throw new Error('Physics module not loaded. Ensure PhysicsPlugin init is complete.');
        }
        this.module_ = module;
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

    raycast(
        origin: Vec2, direction: Vec2, maxDistance: number,
        maskBits = 0xFFFF, ppu = this.ppu_,
    ): RaycastHit[] {
        const invPpu = 1 / ppu;
        const count = this.module_._physics_raycast(
            origin.x * invPpu, origin.y * invPpu,
            direction.x, direction.y,
            maxDistance * invPpu, maskBits,
        );
        if (count === 0) return [];

        const ptr = this.module_._physics_getRaycastBuffer() >> 2;
        const results: RaycastHit[] = [];
        for (let i = 0; i < count; i++) {
            const base = ptr + i * CAST_HIT_STRIDE;
            results.push({
                entity: this.module_.HEAPU32[base] as Entity,
                point: { x: this.module_.HEAPF32[base + 1] * ppu, y: this.module_.HEAPF32[base + 2] * ppu },
                normal: { x: this.module_.HEAPF32[base + 3], y: this.module_.HEAPF32[base + 4] },
                fraction: this.module_.HEAPF32[base + 5],
            });
        }
        results.sort((a, b) => a.fraction - b.fraction);
        return results;
    }

    overlapCircle(center: Vec2, radius: number, maskBits = 0xFFFF, ppu = this.ppu_): Entity[] {
        const invPpu = 1 / ppu;
        const count = this.module_._physics_overlapCircle(
            center.x * invPpu, center.y * invPpu,
            radius * invPpu, maskBits,
        );
        return this.readUniqueEntityBuffer_(count);
    }

    setAwake(entity: Entity, awake: boolean): void {
        this.module_._physics_setAwake(entity, awake ? 1 : 0);
    }

    isAwake(entity: Entity): boolean {
        return this.module_._physics_isAwake(entity) !== 0;
    }

    shapeCastCircle(
        center: Vec2, radius: number, translation: Vec2,
        maskBits = 0xFFFF, ppu = this.ppu_,
    ): ShapeCastHit[] {
        const invPpu = 1 / ppu;
        const count = this.module_._physics_shapeCastCircle(
            center.x * invPpu, center.y * invPpu, radius * invPpu,
            translation.x * invPpu, translation.y * invPpu, maskBits,
        );
        return this.readShapeCastBuffer_(count, ppu);
    }

    shapeCastBox(
        center: Vec2, halfExtents: Vec2, angle: number, translation: Vec2,
        maskBits = 0xFFFF, ppu = this.ppu_,
    ): ShapeCastHit[] {
        const invPpu = 1 / ppu;
        const count = this.module_._physics_shapeCastBox(
            center.x * invPpu, center.y * invPpu,
            halfExtents.x * invPpu, halfExtents.y * invPpu, angle,
            translation.x * invPpu, translation.y * invPpu, maskBits,
        );
        return this.readShapeCastBuffer_(count, ppu);
    }

    shapeCastCapsule(
        center1: Vec2, center2: Vec2, radius: number, translation: Vec2,
        maskBits = 0xFFFF, ppu = this.ppu_,
    ): ShapeCastHit[] {
        const invPpu = 1 / ppu;
        const count = this.module_._physics_shapeCastCapsule(
            center1.x * invPpu, center1.y * invPpu,
            center2.x * invPpu, center2.y * invPpu,
            radius * invPpu,
            translation.x * invPpu, translation.y * invPpu, maskBits,
        );
        return this.readShapeCastBuffer_(count, ppu);
    }

    /**
     * Advance a kinematic capsule character one step against the world using Box2D's
     * native mover (collide-into-planes + depenetrating slide). Unlike a raw shape
     * cast this resolves resting/touching contacts with valid normals, so a grounded
     * character slides instead of wedging. Capsule endpoints/radius and `pos`/`velocity`
     * are world pixels; `dt` seconds; `up` a unit vector; `floorCos = cos(floorMaxAngle)`.
     * `self` is excluded from the collision. Returns null if the module isn't ready.
     */
    moveCharacter(
        pos: Vec2, c1: Vec2, c2: Vec2, radius: number,
        velocity: Vec2, dt: number, up: Vec2, floorCos: number,
        maskBits: number, self: Entity, ppu = this.ppu_,
    ): MoverResult | null {
        const invPpu = 1 / ppu;
        const ok = this.module_._physics_moveCharacter(
            pos.x * invPpu, pos.y * invPpu,
            c1.x * invPpu, c1.y * invPpu, c2.x * invPpu, c2.y * invPpu, radius * invPpu,
            velocity.x * invPpu, velocity.y * invPpu, dt,
            up.x, up.y, floorCos, maskBits, self >>> 0,
        );
        if (!ok) return null;
        const base = this.module_._physics_getMoveCharacterBuffer() >> 2;
        const h = this.module_.HEAPF32;
        return {
            dx: h[base] * ppu, dy: h[base + 1] * ppu,
            velX: h[base + 2] * ppu, velY: h[base + 3] * ppu,
            isOnFloor: h[base + 4] !== 0, isOnWall: h[base + 5] !== 0, isOnCeiling: h[base + 6] !== 0,
            floorNormalX: h[base + 7], floorNormalY: h[base + 8],
        };
    }

    overlapAABB(min: Vec2, max: Vec2, maskBits = 0xFFFF, ppu = this.ppu_): Entity[] {
        const invPpu = 1 / ppu;
        const count = this.module_._physics_overlapAABB(
            min.x * invPpu, min.y * invPpu,
            max.x * invPpu, max.y * invPpu, maskBits,
        );
        return this.readUniqueEntityBuffer_(count);
    }

    getMass(entity: Entity): number {
        return this.module_._physics_getBodyMass(entity);
    }

    getInertia(entity: Entity): number {
        return this.module_._physics_getBodyInertia(entity);
    }

    getCenterOfMass(entity: Entity, ppu = this.ppu_): Vec2 {
        const ptr = this.module_._physics_getBodyCenterOfMass(entity);
        const base = ptr >> 2;
        return {
            x: this.module_.HEAPF32[base] * ppu,
            y: this.module_.HEAPF32[base + 1] * ppu,
        };
    }

    getMassData(entity: Entity, ppu = this.ppu_): MassData {
        return {
            mass: this.getMass(entity),
            inertia: this.getInertia(entity),
            centerOfMass: this.getCenterOfMass(entity, ppu),
        };
    }

    getDistanceJointLength(entity: Entity, ppu = this.ppu_): number {
        return this.module_._physics_getDistanceJointLength(entity) * ppu;
    }

    getDistanceJointCurrentLength(entity: Entity, ppu = this.ppu_): number {
        return this.module_._physics_getDistanceJointCurrentLength(entity) * ppu;
    }

    setDistanceJointLength(entity: Entity, length: number, ppu = this.ppu_): void {
        this.module_._physics_setDistanceJointLength(entity, length / ppu);
    }

    enableDistanceJointSpring(entity: Entity, enable: boolean): void {
        this.module_._physics_enableDistanceJointSpring(entity, enable ? 1 : 0);
    }

    enableDistanceJointLimit(entity: Entity, enable: boolean): void {
        this.module_._physics_enableDistanceJointLimit(entity, enable ? 1 : 0);
    }

    setDistanceJointLimits(entity: Entity, minLength: number, maxLength: number, ppu = this.ppu_): void {
        this.module_._physics_setDistanceJointLimits(entity, minLength / ppu, maxLength / ppu);
    }

    enableDistanceJointMotor(entity: Entity, enable: boolean): void {
        this.module_._physics_enableDistanceJointMotor(entity, enable ? 1 : 0);
    }

    setDistanceJointMotorSpeed(entity: Entity, speed: number): void {
        this.module_._physics_setDistanceJointMotorSpeed(entity, speed);
    }

    setDistanceJointMaxMotorForce(entity: Entity, force: number): void {
        this.module_._physics_setDistanceJointMaxMotorForce(entity, force);
    }

    getDistanceJointMotorForce(entity: Entity): number {
        return this.module_._physics_getDistanceJointMotorForce(entity);
    }

    getPrismaticJointTranslation(entity: Entity, ppu = this.ppu_): number {
        return this.module_._physics_getPrismaticJointTranslation(entity) * ppu;
    }

    getPrismaticJointSpeed(entity: Entity, ppu = this.ppu_): number {
        return this.module_._physics_getPrismaticJointSpeed(entity) * ppu;
    }

    enablePrismaticJointSpring(entity: Entity, enable: boolean): void {
        this.module_._physics_enablePrismaticJointSpring(entity, enable ? 1 : 0);
    }

    enablePrismaticJointLimit(entity: Entity, enable: boolean): void {
        this.module_._physics_enablePrismaticJointLimit(entity, enable ? 1 : 0);
    }

    setPrismaticJointLimits(entity: Entity, lower: number, upper: number, ppu = this.ppu_): void {
        this.module_._physics_setPrismaticJointLimits(entity, lower / ppu, upper / ppu);
    }

    enablePrismaticJointMotor(entity: Entity, enable: boolean): void {
        this.module_._physics_enablePrismaticJointMotor(entity, enable ? 1 : 0);
    }

    setPrismaticJointMotorSpeed(entity: Entity, speed: number): void {
        this.module_._physics_setPrismaticJointMotorSpeed(entity, speed);
    }

    setPrismaticJointMaxMotorForce(entity: Entity, force: number): void {
        this.module_._physics_setPrismaticJointMaxMotorForce(entity, force);
    }

    getPrismaticJointMotorForce(entity: Entity): number {
        return this.module_._physics_getPrismaticJointMotorForce(entity);
    }

    enableWheelJointSpring(entity: Entity, enable: boolean): void {
        this.module_._physics_enableWheelJointSpring(entity, enable ? 1 : 0);
    }

    enableWheelJointLimit(entity: Entity, enable: boolean): void {
        this.module_._physics_enableWheelJointLimit(entity, enable ? 1 : 0);
    }

    setWheelJointLimits(entity: Entity, lower: number, upper: number, ppu = this.ppu_): void {
        this.module_._physics_setWheelJointLimits(entity, lower / ppu, upper / ppu);
    }

    enableWheelJointMotor(entity: Entity, enable: boolean): void {
        this.module_._physics_enableWheelJointMotor(entity, enable ? 1 : 0);
    }

    setWheelJointMotorSpeed(entity: Entity, speed: number): void {
        this.module_._physics_setWheelJointMotorSpeed(entity, speed);
    }

    setWheelJointMaxMotorTorque(entity: Entity, torque: number): void {
        this.module_._physics_setWheelJointMaxMotorTorque(entity, torque);
    }

    getWheelJointMotorTorque(entity: Entity): number {
        return this.module_._physics_getWheelJointMotorTorque(entity);
    }

    private readUniqueEntityBuffer_(count: number): Entity[] {
        if (count === 0) return [];
        const ptr = this.module_._physics_getOverlapBuffer() >> 2;
        const results: Entity[] = [];
        const seen = new Set<number>();
        for (let i = 0; i < count; i++) {
            const entityId = this.module_.HEAPU32[ptr + i] as Entity;
            if (!seen.has(entityId)) {
                seen.add(entityId);
                results.push(entityId);
            }
        }
        return results;
    }

    private readShapeCastBuffer_(count: number, ppu: number): ShapeCastHit[] {
        if (count === 0) return [];
        const ptr = this.module_._physics_getShapeCastBuffer() >> 2;
        const results: ShapeCastHit[] = [];
        for (let i = 0; i < count; i++) {
            const base = ptr + i * CAST_HIT_STRIDE;
            results.push({
                entity: this.module_.HEAPU32[base] as Entity,
                point: { x: this.module_.HEAPF32[base + 1] * ppu, y: this.module_.HEAPF32[base + 2] * ppu },
                normal: { x: this.module_.HEAPF32[base + 3], y: this.module_.HEAPF32[base + 4] },
                fraction: this.module_.HEAPF32[base + 5],
            });
        }
        results.sort((a, b) => a.fraction - b.fraction);
        return results;
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

/**
 * Resource published by `PhysicsPlugin` once the wasm module is ready.
 * Game code reads it as `app.getResource(PhysicsAPI)` to call forces,
 * impulses, joint helpers, raycasts, etc.
 */
export const PhysicsAPI = defineResource<Physics>(null!, 'PhysicsAPI');
