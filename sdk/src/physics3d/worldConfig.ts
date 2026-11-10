// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    worldConfig.ts
 * @brief   The project's say in how its 3D physics world is made (Project Settings → Physics → 3D).
 *
 * Types and one pure function only: the scene loader reads this without pulling the 3D physics code in.
 */
import type { Vec3 } from '../types';
import type { Physics3DConfig } from './Physics3DSystem';

export interface Physics3DWorldConfig {
    /**
     * Scene units in one metre. 100 (the default): a unit is a centimetre. 1: a unit is a metre, as glTF and most imported
     * 3D scenes are. The solver works in metres, so this is what makes a 1.8-unit character in a metre scene 1.8 m tall
     * rather than 1.8 cm, and keeps its gravity at 9.81 m/s² rather than 9.81 units/s².
     */
    unitsPerMeter: number;
    /** Metres per second squared, whatever the scene unit is. */
    gravity: Vec3;
    /** Collision passes per fixed step: more keeps fast bodies from tunnelling, at their cost. */
    collisionSteps: number;
    /** Bodies the world is sized for; the solver refuses one past it. */
    maxBodies: number;
    /** 0 = the backend's own (Jolt 10 / PhysX 1). */
    velocityIterations: number;
    /** 0 = the backend's own (Jolt 2 / PhysX 6). */
    positionIterations: number;
    enableSleep: boolean;
    /** m/s; slower impacts do not bounce. 0 = the backend's own (Jolt 1 / PhysX 2). */
    bounceThreshold: number;
}

export const DEFAULT_PHYSICS3D_WORLD: Physics3DWorldConfig = {
    unitsPerMeter: 100,
    gravity: { x: 0, y: -9.81, z: 0 },
    collisionSteps: 1,
    maxBodies: 1024,
    velocityIterations: 0,
    positionIterations: 0,
    enableSleep: true,
    bounceThreshold: 0,
};

/** The plugin config a project's 3D world settings ask for; only what is valid and set. */
export function physics3DPluginConfigOf(world: Partial<Physics3DWorldConfig> | undefined): Partial<Physics3DConfig> {
    const out: Partial<Physics3DConfig> = {};
    if (!world) return out;
    const u = world.unitsPerMeter;
    if (typeof u === 'number' && Number.isFinite(u) && u > 0) out.pixelsPerUnit = u;
    const g = world.gravity;
    if (g && [g.x, g.y, g.z].every((v) => typeof v === 'number' && Number.isFinite(v))) out.gravity = { x: g.x, y: g.y, z: g.z };
    const count = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
    if (count(world.collisionSteps, 1)) out.collisionSteps = world.collisionSteps;
    if (count(world.maxBodies, 1)) out.maxBodies = world.maxBodies;
    if (count(world.velocityIterations, 0)) out.velocityIterations = world.velocityIterations;
    if (count(world.positionIterations, 0)) out.positionIterations = world.positionIterations;
    if (typeof world.enableSleep === 'boolean') out.enableSleep = world.enableSleep;
    const b = world.bounceThreshold;
    if (typeof b === 'number' && Number.isFinite(b) && b >= 0) out.bounceThreshold = b;
    return out;
}

/**
 * Everything the 3D world is made with: the project's 3D world settings, plus the two a game has only one of —
 * the fixed step and the collision matrix — taken from the project's physics settings, as 2D takes them.
 */
export function physics3DInstallConfig(world: Partial<Physics3DWorldConfig> | undefined,
                                       shared: { fixedTimestep?: number; collisionLayerMasks?: number[] } | undefined): Partial<Physics3DConfig> {
    const out = physics3DPluginConfigOf(world);
    const step = shared?.fixedTimestep;
    if (typeof step === 'number' && Number.isFinite(step) && step > 0) out.fixedTimestep = step;
    if (Array.isArray(shared?.collisionLayerMasks)) out.layerMasks = shared.collisionLayerMasks.slice(0, 16);
    return out;
}
