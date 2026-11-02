// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/physicsSystem.ts
 * @brief   `PhysicsSystem.instance.raycast`: which colliders a ray crosses, nearest first.
 *
 * A Cocos game asks the physics system one thing of its colliders: what did this touch ray hit. The answer is a walk over the world's box
 * colliders, each tested as the oriented box it is, so a project that only picks does not have to load a solver and step bodies for it.
 */
import { BoxCollider3D } from '../physics3d/Physics3DComponents';
import { BoxCollider } from './collider';
import { getCurrentWorld, nodeForEntity } from './node';
import { Quat, Vec3 } from './math';
import { Ray } from './geometry';

/** One collider a ray crossed. */
export class PhysicsRayResult {
    collider!: BoxCollider;
    /** Where the ray met it. */
    hitPoint = new Vec3();
    /** How far along the ray. */
    distance = 0;
    /** The side that was met, pointing out of the box. */
    hitNormal = new Vec3();
}

/** The nearest distance at which @p ray crosses the box, or -1; the normal of the face goes to @p normal. */
function crossBox(ray: Ray, centre: Vec3, half: Vec3, rotation: Quat, position: Vec3, normal: Vec3): number {
    const inverse = Quat.invert(new Quat(), rotation);
    const o = Vec3.transformQuat(new Vec3(), new Vec3(ray.o.x - position.x, ray.o.y - position.y, ray.o.z - position.z), inverse);
    const d = Vec3.transformQuat(new Vec3(), ray.d, inverse);
    let near = -Infinity, far = Infinity, axisHit: 'x' | 'y' | 'z' = 'y', sign = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
        const lo = centre[axis] - half[axis], hi = centre[axis] + half[axis];
        if (Math.abs(d[axis]) < 1e-12) {
            if (o[axis] < lo || o[axis] > hi) return -1;
            continue;
        }
        let t1 = (lo - o[axis]) / d[axis], t2 = (hi - o[axis]) / d[axis];
        let s = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
        if (t1 > near) { near = t1; axisHit = axis; sign = s; }
        far = Math.min(far, t2);
    }
    if (far < Math.max(near, 0)) return -1;
    // a ray that starts inside a box meets nothing on the way in: it leaves, and is reported at the origin, as the engine reports an inside start
    const t = near >= 0 ? near : 0;
    const local = new Vec3();
    local[axisHit] = sign;
    Vec3.transformQuat(normal, local, rotation);
    return t;
}

export class PhysicsSystem {
    private static instance_: PhysicsSystem | null = null;
    static get instance(): PhysicsSystem { return (PhysicsSystem.instance_ ??= new PhysicsSystem()); }

    /** Every collider the last `raycast` crossed, nearest first. */
    readonly raycastResults: PhysicsRayResult[] = [];
    readonly raycastClosestResult = new PhysicsRayResult();

    /** Whether the ray crosses any collider the mask lets in; the crossings are `raycastResults`. */
    raycast(worldRay: Ray, _mask = 0xffffffff, maxDistance = 10000000, queryTrigger = true): boolean {
        this.raycastResults.length = 0;
        const world = getCurrentWorld();
        if (!world) return false;
        const found: PhysicsRayResult[] = [];
        for (const entity of world.getEntitiesWithComponents([BoxCollider3D])) {
            const data = world.get(entity, BoxCollider3D);
            if (!data.enabled || (data.isSensor && !queryTrigger) || !world.isEntityActive(entity)) continue;
            const node = nodeForEntity(world, entity);
            const scaleRatio = new Vec3(1, 1, 1);
            const local = node.scale, wide = node.worldScale;
            for (const a of ['x', 'y', 'z'] as const) if (Math.abs(local[a]) > 1e-6) scaleRatio[a] = Math.abs(wide[a] / local[a]);
            const centre = new Vec3((data.center?.x ?? 0) * scaleRatio.x, (data.center?.y ?? 0) * scaleRatio.y, (data.center?.z ?? 0) * scaleRatio.z);
            const half = new Vec3(data.halfExtents.x * scaleRatio.x, data.halfExtents.y * scaleRatio.y, data.halfExtents.z * scaleRatio.z);
            const normal = new Vec3();
            const t = crossBox(worldRay, centre, half, node.worldRotation, node.worldPosition, normal);
            if (t < 0 || t > maxDistance) continue;
            const result = new PhysicsRayResult();
            result.collider = node.getComponent(BoxCollider)!;
            result.distance = t;
            worldRay.computeHit(result.hitPoint, t);
            result.hitNormal = normal;
            found.push(result);
        }
        found.sort((a, b) => a.distance - b.distance);
        this.raycastResults.push(...found);
        return found.length > 0;
    }

    /** Whether the ray crosses any; the nearest is `raycastClosestResult`. */
    raycastClosest(worldRay: Ray, mask = 0xffffffff, maxDistance = 10000000, queryTrigger = true): boolean {
        if (!this.raycast(worldRay, mask, maxDistance, queryTrigger)) return false;
        const nearest = this.raycastResults[0]!;
        this.raycastClosestResult.collider = nearest.collider;
        this.raycastClosestResult.distance = nearest.distance;
        this.raycastClosestResult.hitPoint.set(nearest.hitPoint);
        this.raycastClosestResult.hitNormal.set(nearest.hitNormal);
        return true;
    }
}
