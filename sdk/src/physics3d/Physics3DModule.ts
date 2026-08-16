// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DModule.ts
 * @brief   The 3D physics wasm module's surface, and how it is loaded.
 */

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

    _physics3d_addBox(entity: number, hx: number, hy: number, hz: number,
                      px: number, py: number, pz: number,
                      qx: number, qy: number, qz: number, qw: number,
                      motion: number, gravityScale: number, linearDamping: number,
                      angularDamping: number, fixedRotation: number,
                      friction: number, restitution: number, isSensor: number): number;
    _physics3d_addSphere(entity: number, radius: number,
                         px: number, py: number, pz: number,
                         qx: number, qy: number, qz: number, qw: number,
                         motion: number, gravityScale: number, linearDamping: number,
                         angularDamping: number, fixedRotation: number,
                         friction: number, restitution: number, isSensor: number): number;
    _physics3d_addCapsule(entity: number, radius: number, halfHeight: number,
                          px: number, py: number, pz: number,
                          qx: number, qy: number, qz: number, qw: number,
                          motion: number, gravityScale: number, linearDamping: number,
                          angularDamping: number, fixedRotation: number,
                          friction: number, restitution: number, isSensor: number): number;
    _physics3d_removeBody(bodyId: number): void;
    _physics3d_setTransform(bodyId: number, px: number, py: number, pz: number,
                            qx: number, qy: number, qz: number, qw: number): void;
    _physics3d_setLinearVelocity(bodyId: number, vx: number, vy: number, vz: number): void;
    _physics3d_getBodyState(bodyId: number): number;

    _physics3d_raycast(ox: number, oy: number, oz: number,
                       dx: number, dy: number, dz: number): number;

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
