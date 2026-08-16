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
} from '../ecs/component.generated';

export type {
    RigidBody3DData, BoxCollider3DData, SphereCollider3DData, CapsuleCollider3DData,
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
