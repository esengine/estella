// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ColliderShape3D.ts
 * @brief   The single geometry projection over the 3D collider components — the
 *          shared seam for every visualizer of the 3D world.
 * @details A 3D collider is invisible in a way a 2D one never was: the shape is
 *          not the sprite, the entity may be rotated on three axes, and nothing
 *          on screen says how big the box around a model is. This reads the
 *          components into shape descriptors and emits wireframes from them, so
 *          the editor gizmo and any runtime overlay draw the same geometry.
 *
 *          What it reports is what the SOLVER builds, not what the scene carries:
 *          the running world gives an entity ONE body shape, chosen in the order
 *          {@link readCollider3DShapes} walks, and none at all without an enabled
 *          RigidBody3D. A gizmo that drew every authored collider would promise
 *          collisions that do not happen.
 *
 * Units: 3D collider fields are world units already (the system divides by
 * pixels-per-unit on its way into the solver), so nothing here scales.
 */
import type { Vec3, Quat } from '../types';
import type { World } from '../ecs/world';
import {
    RigidBody3D, BoxCollider3D, SphereCollider3D, CapsuleCollider3D,
    MeshCollider3D, ConvexCollider3D, CharacterController3D,
} from './Physics3DComponents';
import type {
    RigidBody3DData, BoxCollider3DData, SphereCollider3DData, CapsuleCollider3DData,
    MeshCollider3DData, ConvexCollider3DData, CharacterController3DData,
} from './Physics3DComponents';
import { getMeshCollision } from '../asset/meshCollision';

/** Points per full circle in a sphere/capsule wireframe. */
export const COLLIDER3D_RING_SEGMENTS = 24;

/** A 3D collider's geometry in entity-local space, in world units. */
export type Collider3DShape =
    | { kind: 'box'; halfExtents: Vec3; center: Vec3 }
    | { kind: 'sphere'; radius: number }
    | { kind: 'capsule'; radius: number; halfHeight: number };

/** Which component authored a shape — the Inspector target behind a gizmo. */
export type Collider3DComponent =
    | 'BoxCollider3D' | 'SphereCollider3D' | 'CapsuleCollider3D'
    | 'MeshCollider3D' | 'ConvexCollider3D' | 'CharacterController3D';

export interface Collider3DInstance {
    component: Collider3DComponent;
    shape: Collider3DShape;
    isSensor: boolean;
    /** Whether the running world builds this shape. False for a disabled collider,
     *  one shadowed by a higher-priority shape on the same entity, one whose mesh
     *  never loaded, or any collider on an entity with no enabled RigidBody3D —
     *  all authorable, none of them in the solver. */
    active: boolean;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

/** Turn a vector by a rotation — what places an anchor, an axis or a wireframe
 *  vertex in the world, and the one piece of 3D maths every visualizer needs. */
export function rotateVec3ByQuat(q: Quat, v: Vec3): Vec3 {
    // t = 2 * (q.xyz × v); v' = v + q.w * t + q.xyz × t
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
        x: v.x + q.w * tx + q.y * tz - q.z * ty,
        y: v.y + q.w * ty + q.z * tx - q.x * tz,
        z: v.z + q.w * tz + q.x * ty - q.y * tx,
    };
}

/** Local AABB of a loaded mesh's collision triangles, or null when nothing loaded them. */
function meshBounds(handle: number): { center: Vec3; halfExtents: Vec3 } | null {
    const data = handle !== 0 ? getMeshCollision(handle) : null;
    if (!data || data.positions.length < 3) return null;
    const p = data.positions;
    let minX = p[0]!, minY = p[1]!, minZ = p[2]!;
    let maxX = minX, maxY = minY, maxZ = minZ;
    for (let i = 3; i + 2 < p.length; i += 3) {
        const x = p[i]!, y = p[i + 1]!, z = p[i + 2]!;
        if (x < minX) minX = x; else if (x > maxX) maxX = x;
        if (y < minY) minY = y; else if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; else if (z > maxZ) maxZ = z;
    }
    return {
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
        halfExtents: { x: (maxX - minX) / 2, y: (maxY - minY) / 2, z: (maxZ - minZ) / 2 },
    };
}

/**
 * Every 3D collider on `entity`, each marked with whether it is the one the solver
 * ends up building. The order mirrors `createBody` in Physics3DSystem — box, sphere,
 * mesh, hull, capsule — and must keep mirroring it: a visualizer drawing a different
 * shape than the world collides with is worse than none.
 */
export function readCollider3DShapes(world: World, entity: number): Collider3DInstance[] {
    const out: Collider3DInstance[] = [];
    const on = (c: { enabled?: boolean }): boolean => c.enabled !== false;
    const body = world.has(entity, RigidBody3D)
        ? world.get(entity, RigidBody3D) as RigidBody3DData : null;
    const bodyLive = body !== null && on(body);
    let taken = false;

    const box = world.has(entity, BoxCollider3D)
        ? world.get(entity, BoxCollider3D) as BoxCollider3DData : null;
    if (box) {
        const chosen = !taken && on(box);
        if (chosen) taken = true;
        out.push({
            component: 'BoxCollider3D',
            shape: { kind: 'box', halfExtents: box.halfExtents, center: ZERO },
            isSensor: box.isSensor === true,
            active: chosen && bodyLive,
        });
    }

    const sphere = world.has(entity, SphereCollider3D)
        ? world.get(entity, SphereCollider3D) as SphereCollider3DData : null;
    if (sphere) {
        const chosen = !taken && on(sphere);
        if (chosen) taken = true;
        out.push({
            component: 'SphereCollider3D',
            shape: { kind: 'sphere', radius: sphere.radius },
            isSensor: sphere.isSensor === true,
            active: chosen && bodyLive,
        });
    }

    const mesh = world.has(entity, MeshCollider3D)
        ? world.get(entity, MeshCollider3D) as MeshCollider3DData : null;
    if (mesh) {
        // A mesh collider claims the entity's one body slot as soon as it names a
        // mesh; whether that mesh loaded decides only if a body appears at all.
        const chosen = !taken && on(mesh) && mesh.mesh !== 0;
        if (chosen) taken = true;
        const bounds = meshBounds(mesh.mesh);
        if (bounds) {
            out.push({
                component: 'MeshCollider3D',
                shape: { kind: 'box', halfExtents: bounds.halfExtents, center: bounds.center },
                isSensor: false,
                active: chosen && bodyLive,
            });
        }
    }

    const hull = world.has(entity, ConvexCollider3D)
        ? world.get(entity, ConvexCollider3D) as ConvexCollider3DData : null;
    if (hull) {
        const chosen = !taken && on(hull) && hull.mesh !== 0;
        if (chosen) taken = true;
        const bounds = meshBounds(hull.mesh);
        if (bounds) {
            out.push({
                component: 'ConvexCollider3D',
                shape: { kind: 'box', halfExtents: bounds.halfExtents, center: bounds.center },
                isSensor: hull.isSensor === true,
                active: chosen && bodyLive,
            });
        }
    }

    const capsule = world.has(entity, CapsuleCollider3D)
        ? world.get(entity, CapsuleCollider3D) as CapsuleCollider3DData : null;
    if (capsule) {
        const chosen = !taken && on(capsule);
        if (chosen) taken = true;
        out.push({
            component: 'CapsuleCollider3D',
            shape: { kind: 'capsule', radius: capsule.radius, halfHeight: capsule.halfHeight },
            isSensor: capsule.isSensor === true,
            active: chosen && bodyLive,
        });
    }

    // A character is swept rather than solved, on its own path: it stands beside
    // whatever body the entity has instead of competing for the slot.
    const character = world.has(entity, CharacterController3D)
        ? world.get(entity, CharacterController3D) as CharacterController3DData : null;
    if (character) {
        out.push({
            component: 'CharacterController3D',
            shape: { kind: 'capsule', radius: character.radius, halfHeight: character.halfHeight },
            isSensor: false,
            active: on(character),
        });
    }

    return out;
}

function ring(radius: number, axis: 'xy' | 'xz' | 'yz', offset: Vec3, segments: number): Vec3[] {
    const pts: Vec3[] = [];
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const c = Math.cos(a) * radius;
        const s = Math.sin(a) * radius;
        pts.push(axis === 'xy' ? { x: offset.x + c, y: offset.y + s, z: offset.z }
            : axis === 'xz' ? { x: offset.x + c, y: offset.y, z: offset.z + s }
                : { x: offset.x, y: offset.y + c, z: offset.z + s });
    }
    return pts;
}

/** Half-circle cap from angle 0 to π, in the plane the axis names, around `offset`. */
function arc(radius: number, axis: 'xy' | 'zy', offset: Vec3, sign: 1 | -1, segments: number): Vec3[] {
    const pts: Vec3[] = [];
    for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI;
        const c = Math.cos(a) * radius;
        const s = Math.sin(a) * radius * sign;
        pts.push(axis === 'xy'
            ? { x: offset.x + c, y: offset.y + s, z: offset.z }
            : { x: offset.x, y: offset.y + s, z: offset.z + c });
    }
    return pts;
}

/**
 * The shape's wireframe as entity-local polylines (world units, unrotated).
 * A box gives its 12 edges; a sphere three great circles; a capsule two rings,
 * four caps and the four lines between them.
 */
export function collider3DWireframe(shape: Collider3DShape, segments = COLLIDER3D_RING_SEGMENTS): Vec3[][] {
    if (shape.kind === 'box') {
        const { center: c, halfExtents: h } = shape;
        const corner = (sx: number, sy: number, sz: number): Vec3 =>
            ({ x: c.x + sx * h.x, y: c.y + sy * h.y, z: c.z + sz * h.z });
        const face = (sy: number): Vec3[] => [
            corner(-1, sy, -1), corner(1, sy, -1), corner(1, sy, 1), corner(-1, sy, 1), corner(-1, sy, -1),
        ];
        const posts: Vec3[][] = [];
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            posts.push([corner(sx, -1, sz), corner(sx, 1, sz)]);
        }
        return [face(-1), face(1), ...posts];
    }

    if (shape.kind === 'sphere') {
        const r = shape.radius;
        return [
            ring(r, 'xy', ZERO, segments),
            ring(r, 'xz', ZERO, segments),
            ring(r, 'yz', ZERO, segments),
        ];
    }

    // Capsule: Y-up, the axis Jolt's CapsuleShape uses, so a wireframe rotated by
    // the entity lands on the shape the solver built.
    const { radius: r, halfHeight: hh } = shape;
    const top: Vec3 = { x: 0, y: hh, z: 0 };
    const bottom: Vec3 = { x: 0, y: -hh, z: 0 };
    const half = Math.max(2, Math.round(segments / 2));
    const posts: Vec3[][] = [];
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        posts.push([
            { x: sx * r, y: -hh, z: sz * r },
            { x: sx * r, y: hh, z: sz * r },
        ]);
    }
    return [
        ring(r, 'xz', top, segments),
        ring(r, 'xz', bottom, segments),
        arc(r, 'xy', top, 1, half),
        arc(r, 'zy', top, 1, half),
        arc(r, 'xy', bottom, -1, half),
        arc(r, 'zy', bottom, -1, half),
        ...posts,
    ];
}

/**
 * Local polylines placed in the world by an entity's position and rotation.
 *
 * Scale is deliberately left out: the solver builds the shape from the collider's
 * own numbers, so a scaled entity still collides at its authored size and a gizmo
 * that grew with the scale would be drawing a body that does not exist.
 */
export function placeCollider3DWireframe(lines: Vec3[][], position: Vec3, rotation: Quat): Vec3[][] {
    return lines.map((line) => line.map((p) => {
        const r = rotateVec3ByQuat(rotation, p);
        return { x: position.x + r.x, y: position.y + r.y, z: position.z + r.z };
    }));
}
