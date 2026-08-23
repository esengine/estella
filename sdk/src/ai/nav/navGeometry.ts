// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    navGeometry.ts
 * @brief   The world's static collision surface, as triangles a navmesh can be
 *          baked from.
 *
 * The bodies a scene collides against ARE the ground it can walk on, so the bake
 * takes them as its source rather than a second authored description that can
 * disagree with them. Which collider on an entity counts is decided by the same
 * projection the editor gizmo and the physics overlay read, so a navmesh cannot
 * be baked from a shape nobody can see.
 *
 * STATIC bodies only. A crate that is about to be pushed is not floor, and a
 * mesh baked over one describes the world for exactly as long as nobody touches
 * it — a moving obstacle is a job for avoidance, not for the bake.
 */

import type { Entity, Quat, Vec3 } from '../../types';
import type { World } from '../../ecs/world';
import { Transform } from '../../ecs/component';
import {
    RigidBody3D, MeshCollider3D, ConvexCollider3D,
    type RigidBody3DData, type MeshCollider3DData, type ConvexCollider3DData,
} from '../../physics3d/Physics3DComponents';
import {
    readCollider3DShapes, collider3DTriangles, rotateVec3ByQuat,
    type Collider3DInstance,
} from '../../physics3d/ColliderShape3D';
import { getMeshCollision } from '../../asset/meshCollision';

/** World-space triangle soup: `verts` is `vertexCount * 3` floats. */
export interface NavGeometry {
    verts: Float32Array;
    indices: Uint32Array;
    /** How many bodies went into it — zero is the difference between "baked an
     *  empty world" and "baked a world with no static geometry in it". */
    bodyCount: number;
}

export interface CollectNavGeometryOptions {
    /** Only geometry touching this box is collected. */
    min: Vec3;
    max: Vec3;
    /** Physics layers the ground is on, as a mask; 0 (the default) takes them all. */
    layers?: number;
}

/**
 * Whether every static body's shape is available — a mesh collider has none until
 * its asset loads, and a bake that ran first would leave a hole where the level
 * is. Read from the components, not the shape projection: an unloaded mesh
 * produces no shape at all, so the projection would always report nothing amiss.
 */
export function navGeometryReady(world: World, layers = 0): boolean {
    for (const entity of world.getEntitiesWithComponents([RigidBody3D, Transform])) {
        if (!isBakeable(world, entity, layers)) continue;
        const handle = namedMesh(world, entity);
        if (handle !== 0 && getMeshCollision(handle) === null) return false;
    }
    return true;
}

/** The mesh handle an entity's collider names, loaded or not; 0 for none. */
function namedMesh(world: World, entity: Entity): number {
    for (const def of [MeshCollider3D, ConvexCollider3D] as const) {
        if (!world.has(entity, def)) continue;
        const data = world.get(entity, def) as MeshCollider3DData | ConvexCollider3DData;
        if (data.enabled !== false && data.mesh !== 0) return data.mesh;
    }
    return 0;
}

export function collectNavGeometry(world: World, opts: CollectNavGeometryOptions): NavGeometry {
    const layers = opts.layers ?? 0;
    const verts: number[] = [];
    const indices: number[] = [];
    let bodyCount = 0;

    for (const entity of world.getEntitiesWithComponents([RigidBody3D, Transform])) {
        if (!isBakeable(world, entity, layers)) continue;
        const local = localTriangles(world, entity);
        if (!local) continue;

        // The transform the 3D SOLVER builds its bodies from. A mesh baked from
        // anywhere else would describe a world the agent does not collide with.
        const tf = world.get(entity, Transform);
        const at = tf.position as Vec3;
        const rot = tf.rotation as Quat;

        const base = verts.length / 3;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i + 2 < local.positions.length; i += 3) {
            const p = rotateVec3ByQuat(rot, {
                x: local.positions[i]!, y: local.positions[i + 1]!, z: local.positions[i + 2]!,
            });
            const x = at.x + p.x;
            const y = at.y + p.y;
            const z = at.z + p.z;
            verts.push(x, y, z);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        // Whole bodies are culled, not triangles: the rasteriser clips what
        // crosses the edge of the box, and a body that misses it entirely is the
        // only thing worth not transforming.
        if (maxX < opts.min.x || minX > opts.max.x || maxY < opts.min.y || minY > opts.max.y
            || maxZ < opts.min.z || minZ > opts.max.z) {
            verts.length = base * 3;
            continue;
        }

        for (let i = 0; i < local.indices.length; i++) indices.push(base + local.indices[i]!);
        bodyCount++;
    }

    return { verts: Float32Array.from(verts), indices: Uint32Array.from(indices), bodyCount };
}

function isBakeable(world: World, entity: Entity, layers: number): boolean {
    const body = world.get(entity, RigidBody3D) as RigidBody3DData;
    if (body.enabled === false || body.bodyType !== STATIC) return false;
    return layers === 0 || (layers & (1 << body.layer)) !== 0;
}

/** The one shape the solver builds for this entity, if it is part of the ground.
 *  A character is an agent walking the mesh rather than part of what it walks
 *  on, and a sensor is a trigger nobody bumps into. */
function activeCollider(world: World, entity: Entity): Collider3DInstance | null {
    for (const instance of readCollider3DShapes(world, entity)) {
        if (!instance.active || instance.isSensor) continue;
        if (instance.component === 'CharacterController3D') continue;
        return instance;
    }
    return null;
}

function localTriangles(
    world: World, entity: Entity,
): { positions: Float32Array; indices: ArrayLike<number> } | null {
    const active = activeCollider(world, entity);
    if (!active) return null;
    if (active.component === 'MeshCollider3D' || active.component === 'ConvexCollider3D') {
        const data = getMeshCollision(namedMesh(world, entity));
        // The hull a convex collider builds is not the mesh, but the mesh's own
        // triangles are what describe where it is; the difference is a dent the
        // voxeliser would have rounded away in any case.
        return data ? { positions: data.positions, indices: data.indices } : null;
    }
    return collider3DTriangles(active.shape);
}

const STATIC = 0;
