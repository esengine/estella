// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DModule.ts
 * @brief   The 3D physics wasm module's surface, and how it is loaded.
 */

import { defineResource } from '../ecs/resource';
import type { Entity } from '../types';

/** What the module exports. Kept in step with Physics3DModuleEntry.cpp by
 *  {@link assertPhysics3DContract} — a TypeScript interface is gone at run time,
 *  and a module built before the JS that drives it installs happily and then
 *  throws once per frame for the length of the session. */
export interface Physics3DWasmModule {
    _physics3d_init(gx: number, gy: number, gz: number, maxBodies: number): void;
    _physics3d_shutdown(): void;
    _physics3d_isReady(): number;
    _physics3d_step(dt: number, collisionSteps: number): void;
    _physics3d_optimize(): void;
    _physics3d_setLayerMask(layer: number, mask: number): void;

    _physics3d_addBox(entity: number, hx: number, hy: number, hz: number,
                      px: number, py: number, pz: number,
                      qx: number, qy: number, qz: number, qw: number,
                      motion: number, gravityScale: number, linearDamping: number,
                      angularDamping: number, fixedRotation: number, layer: number,
                      continuous: number, friction: number, restitution: number,
                      isSensor: number): number;
    _physics3d_addSphere(entity: number, radius: number,
                         px: number, py: number, pz: number,
                         qx: number, qy: number, qz: number, qw: number,
                         motion: number, gravityScale: number, linearDamping: number,
                         angularDamping: number, fixedRotation: number, layer: number,
                         continuous: number, friction: number, restitution: number,
                         isSensor: number): number;
    _physics3d_addCapsule(entity: number, radius: number, halfHeight: number,
                          px: number, py: number, pz: number,
                          qx: number, qy: number, qz: number, qw: number,
                          motion: number, gravityScale: number, linearDamping: number,
                          angularDamping: number, fixedRotation: number, layer: number,
                          continuous: number, friction: number, restitution: number,
                          isSensor: number): number;
    _physics3d_addMeshBody(entity: number, vertexPtr: number, vertexCount: number,
                           indexPtr: number, indexCount: number,
                           px: number, py: number, pz: number,
                           qx: number, qy: number, qz: number, qw: number,
                           layer: number, friction: number, restitution: number): number;
    _physics3d_addConvexBody(entity: number, vertexPtr: number, vertexCount: number,
                             px: number, py: number, pz: number,
                             qx: number, qy: number, qz: number, qw: number,
                             motion: number, gravityScale: number, linearDamping: number,
                             angularDamping: number, fixedRotation: number, layer: number,
                             continuous: number, friction: number, restitution: number,
                             isSensor: number): number;
    _physics3d_removeBody(bodyId: number): void;

    _malloc(bytes: number): number;
    _free(ptr: number): void;
    _physics3d_setTransform(bodyId: number, px: number, py: number, pz: number,
                            qx: number, qy: number, qz: number, qw: number): void;
    _physics3d_setLinearVelocity(bodyId: number, vx: number, vy: number, vz: number): void;
    _physics3d_getBodyState(bodyId: number): number;

    _physics3d_addCharacter(entity: number, radius: number, halfHeight: number,
                            px: number, py: number, pz: number,
                            maxSlope: number, mass: number, layer: number,
                            pushForce: number): number;
    _physics3d_removeCharacter(characterId: number): void;
    _physics3d_moveCharacter(characterId: number, vx: number, vy: number, vz: number,
                             dt: number, stepUp: number, stepDown: number): void;
    _physics3d_setCharacterPosition(characterId: number, px: number, py: number,
                                    pz: number): void;

    _physics3d_raycast(ox: number, oy: number, oz: number,
                       dx: number, dy: number, dz: number, layerMask: number): number;
    _physics3d_sphereCast(px: number, py: number, pz: number, radius: number,
                          dx: number, dy: number, dz: number, layerMask: number): number;
    _physics3d_overlapSphere(px: number, py: number, pz: number, radius: number,
                             layerMask: number): number;
    _physics3d_overlapBox(px: number, py: number, pz: number,
                          hx: number, hy: number, hz: number, layerMask: number): number;

    _physics3d_addPointJoint(entity: number, bodyA: number, bodyB: number,
                             px: number, py: number, pz: number,
                             collideConnected: number): number;
    _physics3d_addHingeJoint(entity: number, bodyA: number, bodyB: number,
                             px: number, py: number, pz: number,
                             ax: number, ay: number, az: number,
                             enableLimit: number, lower: number, upper: number,
                             enableMotor: number, motorSpeed: number, maxTorque: number,
                             collideConnected: number): number;
    _physics3d_addSliderJoint(entity: number, bodyA: number, bodyB: number,
                              px: number, py: number, pz: number,
                              ax: number, ay: number, az: number,
                              enableLimit: number, lower: number, upper: number,
                              enableMotor: number, motorSpeed: number, maxForce: number,
                              collideConnected: number): number;
    _physics3d_addDistanceJoint(entity: number, bodyA: number, bodyB: number,
                                ax: number, ay: number, az: number,
                                bx: number, by: number, bz: number,
                                minLength: number, maxLength: number,
                                frequency: number, damping: number,
                                collideConnected: number): number;
    _physics3d_addFixedJoint(entity: number, bodyA: number, bodyB: number,
                             collideConnected: number): number;
    _physics3d_removeJoint(entity: number, bodyA: number, bodyB: number): void;
    _physics3d_setJointMotor(entity: number, enable: number, speed: number): void;
    _physics3d_jointValue(entity: number): number;

    _physics3d_contactEnters(): number;
    _physics3d_contactEntersBytes(): number;
    _physics3d_contactExits(): number;
    _physics3d_contactExitsBytes(): number;
    _physics3d_sensorEnters(): number;
    _physics3d_sensorEntersBytes(): number;
    _physics3d_sensorExits(): number;
    _physics3d_sensorExitsBytes(): number;

    _physics3d_transforms(): number;
    _physics3d_transformsBytes(): number;
    _physics3d_queryResult(): number;
    _physics3d_queryResultBytes(): number;

    HEAPF32: Float32Array;
    HEAPU32: Uint32Array;
}

export type Physics3DModuleFactory =
    (options?: { wasmBinary?: ArrayBuffer }) => Promise<Physics3DWasmModule>;

/** One readback record: entity, position, rotation. */
export const PHYSICS3D_TRANSFORM_STRIDE = 8;

const REQUIRED_EXPORTS = [
    '_physics3d_init', '_physics3d_shutdown', '_physics3d_isReady', '_physics3d_step',
    '_physics3d_addBox', '_physics3d_addSphere', '_physics3d_addCapsule',
    '_physics3d_removeBody', '_physics3d_setTransform', '_physics3d_raycast',
    '_physics3d_transforms', '_physics3d_transformsBytes',
    '_physics3d_addCharacter', '_physics3d_moveCharacter', '_physics3d_removeCharacter',
    '_physics3d_sphereCast', '_physics3d_overlapSphere', '_physics3d_overlapBox',
    '_physics3d_contactEnters', '_physics3d_contactEntersBytes',
    '_physics3d_sensorEnters', '_physics3d_sensorEntersBytes',
    '_physics3d_addHingeJoint', '_physics3d_removeJoint',
] as const;

/** Throws naming what is missing, rather than letting the first frame do it. */
export function assertPhysics3DContract(module: unknown): void {
    const bag = module as Record<string, unknown>;
    const missing = REQUIRED_EXPORTS.filter((name) => typeof bag?.[name] !== 'function');
    if (missing.length > 0) {
        throw new Error(`physics3d.wasm is missing ${missing.join(', ')} — it was built `
            + 'from sources older than the code driving it');
    }
}

/** Load the module from `url`, or adopt a factory a host already resolved. */
export async function loadPhysics3DModule(
    url: string, factory?: Physics3DModuleFactory,
): Promise<Physics3DWasmModule> {
    const resolved = factory
        ?? ((await import(/* @vite-ignore */ url)) as { default: Physics3DModuleFactory }).default;
    const module = await resolved();
    assertPhysics3DContract(module);
    return module;
}

// =============================================================================
// Events
// =============================================================================

/** Two bodies met, and where. */
export interface Contact3DEvent {
    entityA: Entity;
    entityB: Entity;
    normalX: number;
    normalY: number;
    normalZ: number;
    pointX: number;
    pointY: number;
    pointZ: number;
}

/** A sensor was entered or left. The SENSOR is always named first. */
export interface Sensor3DEvent {
    sensorEntity: Entity;
    visitorEntity: Entity;
}

export interface Physics3DEventsData {
    contactEnters: Contact3DEvent[];
    /** Ends carry only the pair: at that moment the bodies are locked and one may
     *  already be gone, so there is no geometry left to report. */
    contactExits: Array<{ entityA: Entity; entityB: Entity }>;
    sensorEnters: Sensor3DEvent[];
    sensorExits: Sensor3DEvent[];
}

/**
 * This step's 3D collision and trigger events. Drained per fixed step, so a
 * system reading it must run inside one — a read from `Update` sees whatever the
 * last step left.
 *
 * @beta
 */
export const Physics3DEvents = defineResource<Physics3DEventsData>({
    contactEnters: [],
    contactExits: [],
    sensorEnters: [],
    sensorExits: [],
}, 'Physics3DEvents');

/** Refill `events` from the module's four buffers. */
export function drainPhysics3DEvents(module: Physics3DWasmModule,
                                     events: Physics3DEventsData): void {
    const f32 = module.HEAPF32;
    const read = <T>(ptr: number, bytes: number, stride: number,
                     make: (base: number) => T): T[] => {
        const out: T[] = [];
        const base = ptr >> 2;
        for (let i = 0; i < bytes / 4; i += stride) out.push(make(base + i));
        return out;
    };

    events.contactEnters = read(
        module._physics3d_contactEnters(), module._physics3d_contactEntersBytes(), 8,
        (o) => ({
            entityA: f32[o] as Entity, entityB: f32[o + 1] as Entity,
            normalX: f32[o + 2]!, normalY: f32[o + 3]!, normalZ: f32[o + 4]!,
            pointX: f32[o + 5]!, pointY: f32[o + 6]!, pointZ: f32[o + 7]!,
        }));
    events.contactExits = read(
        module._physics3d_contactExits(), module._physics3d_contactExitsBytes(), 2,
        (o) => ({ entityA: f32[o] as Entity, entityB: f32[o + 1] as Entity }));
    events.sensorEnters = read(
        module._physics3d_sensorEnters(), module._physics3d_sensorEntersBytes(), 2,
        (o) => ({ sensorEntity: f32[o] as Entity, visitorEntity: f32[o + 1] as Entity }));
    events.sensorExits = read(
        module._physics3d_sensorExits(), module._physics3d_sensorExitsBytes(), 2,
        (o) => ({ sensorEntity: f32[o] as Entity, visitorEntity: f32[o + 1] as Entity }));
}
