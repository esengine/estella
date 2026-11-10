// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    implicitStatic.ts
 * @brief   Which entities are a static body with no RigidBody3D: one answer for the world that builds them and the
 *          wireframe that draws them, so the two cannot disagree.
 */
import { Parent } from '../ecs/component';
import type { ParentData } from '../ecs/component.generated';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { RigidBody3D, CharacterController3D } from './Physics3DComponents';

/**
 * A collider with no RigidBody3D is a static body, as in Unity: an imported level collides with a MeshCollider3D on
 * each mesh and nothing else. Not when a character controller owns the entity, and not under a RigidBody3D, whose
 * child colliders belong to that body.
 */
export function isImplicitStatic(world: World, entity: Entity): boolean {
    if (world.has(entity, RigidBody3D) || world.has(entity, CharacterController3D)) return false;
    let at = entity;
    for (let depth = 0; depth < 64 && world.has(at, Parent); depth++) {
        at = (world.get(at, Parent) as ParentData).entity;
        if (!world.valid(at)) return true;
        if (world.has(at, RigidBody3D)) return false;
    }
    return true;
}
