// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Physics3DComponents.ts
 * @brief   The 3D world's components, as a scene authors them.
 * @details Their own set rather than a third dimension on the 2D ones: a 2D scene
 *          keeps the solver, units and feel it already has, and pays nothing for a
 *          world it never asks for.
 */
import { defineBuiltin } from '../ecs/component';
import type {
    RigidBody3DData, BoxCollider3DData, SphereCollider3DData, CapsuleCollider3DData,
    CharacterController3DData, MeshCollider3DData,
} from '../ecs/component.generated';

export type {
    RigidBody3DData, BoxCollider3DData, SphereCollider3DData, CapsuleCollider3DData,
    CharacterController3DData, MeshCollider3DData,
};

export const RigidBody3D = defineBuiltin<RigidBody3DData>('RigidBody3D', {
    bodyType: 2,
    gravityScale: 1.0,
    linearDamping: 0.05,
    angularDamping: 0.05,
    fixedRotation: false,
    enabled: true,
}, {
    fields: {
        linearDamping: { min: 0, advanced: true },
        angularDamping: { min: 0, advanced: true },
        fixedRotation: { advanced: true },
    },
});

export const BoxCollider3D = defineBuiltin<BoxCollider3DData>('BoxCollider3D', {
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
});

export const SphereCollider3D = defineBuiltin<SphereCollider3DData>('SphereCollider3D', {
    radius: 0.5,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
});

export const CapsuleCollider3D = defineBuiltin<CapsuleCollider3DData>('CapsuleCollider3D', {
    radius: 0.3,
    halfHeight: 0.5,
    friction: 0.3,
    restitution: 0.0,
    isSensor: false,
    enabled: true,
});

/**
 * Imported geometry used as it is, for a level to collide against. Always static:
 * a triangle soup has no inertia tensor, so there is nothing for a solver to push.
 *
 * @beta
 */
export const MeshCollider3D = defineBuiltin<MeshCollider3DData>('MeshCollider3D', {
    mesh: 0,
    friction: 0.3,
    restitution: 0.0,
    enabled: true,
});

/**
 * A kinematic mover for a 3D player or NPC: swept against the world rather than
 * solved in it. Set `velocity` each step and read `isOnFloor` back; the vertical
 * component is carried for you, so a zero there means "walk", not "hang".
 *
 * @beta
 */
export const CharacterController3D = defineBuiltin<CharacterController3DData>(
    'CharacterController3D', {
        velocity: { x: 0, y: 0, z: 0 },
        radius: 0.3,
        halfHeight: 0.5,
        maxSlope: 0.87,
        stepHeight: 0.4,
        snapDown: 0.5,
        mass: 70,
        enabled: true,
        isOnFloor: false,
        floorNormal: { x: 0, y: 0, z: 0 },
        realVelocity: { x: 0, y: 0, z: 0 },
    }, {
        fields: {
            maxSlope: { min: 0, max: 1.5708, step: 0.01, unit: 'rad',
                        tooltip: 'Steepest ground it can stand on' },
            stepHeight: { min: 0, step: 0.05, advanced: true },
            snapDown: { min: 0, step: 0.05, advanced: true },
            mass: { min: 0, advanced: true },
            isOnFloor: { advanced: true },
            floorNormal: { advanced: true },
            realVelocity: { advanced: true },
        },
    });
