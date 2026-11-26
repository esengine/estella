// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Entity, Vec2, Vec3 } from '../../types';
import { worldEngineApi, type EngineApi } from '../../ecs/bridge/engineApi';
import { v3 } from '../../math/vec3';
import type { WorldRay } from './math';

/** Read the flat geometry's rendered basis, including shear. Undefined permits a legacy
 * fallback; null rejects a missing, singular or nonfinite transform. */
export function createLocalTransformReader(world: World) {
    let owner: EngineApi | null = null, pointer = 0;
    let matrixHeap: Float32Array | null = null;
    const dispose = (): void => {
        const oldPointer = pointer, oldOwner = owner;
        pointer = 0; owner = null; matrixHeap = null;
        if (oldPointer) oldOwner?._free?.(oldPointer);
    };
    const readMatrix = (entity: Entity): number | null | undefined => {
        const api = worldEngineApi(world), registry = world.getCppRegistry();
        if (owner !== api) { dispose(); owner = api; }
        if (!api?.transform_copyFlatRenderMatrix || !api.HEAPU8 || !api._malloc || !api._free || !registry) return undefined;
        if (!pointer) {
            pointer = api._malloc(64);
            if (!pointer) throw new Error('Could not allocate UI transform scratch.');
        }
        if (!api.transform_copyFlatRenderMatrix(registry, entity, pointer)) return null;
        const heap = api.HEAPU8;
        if (matrixHeap?.buffer !== heap.buffer) matrixHeap = new Float32Array(heap.buffer);
        return (heap.byteOffset + pointer) / 4;
    };
    const inverse = (entity: Entity, x: number, y: number, translate: boolean): Vec2 | null | undefined => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const at = readMatrix(entity);
        if (at == null) return at;
        const m = matrixHeap!;
        const a = m[at], b = m[at + 1], c = m[at + 4], d = m[at + 5];
        const det = a * d - b * c;
        if (!Number.isFinite(det) || det === 0) return null;
        if (translate) { x -= m[at + 12]; y -= m[at + 13]; }
        const localX = (d * x - c * y) / det, localY = (a * y - b * x) / det;
        return Number.isFinite(localX) && Number.isFinite(localY) ? { x: localX, y: localY } : null;
    };
    const worldPoint = (entity: Entity, x: number, y: number): Vec3 | null | undefined => {
        const at = readMatrix(entity);
        if (at == null) return at;
        const m = matrixHeap!;
        const point = {
            x: m[at] * x + m[at + 4] * y + m[at + 12],
            y: m[at + 1] * x + m[at + 5] * y + m[at + 13],
            z: m[at + 2] * x + m[at + 6] * y + m[at + 14],
        };
        return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) ? point : null;
    };
    const rayPoint = (entity: Entity, ray: WorldRay): Vec2 | null | undefined => {
        const at = readMatrix(entity);
        if (at == null) return at;
        const m = matrixHeap!;
        const axisX = { x: m[at], y: m[at + 1], z: m[at + 2] };
        const axisY = { x: m[at + 4], y: m[at + 5], z: m[at + 6] };
        const delta = v3.sub(ray.origin, { x: m[at + 12], y: m[at + 13], z: m[at + 14] });
        const normal = v3.cross(axisX, axisY);
        const det = v3.dot(normal, ray.dir);
        if (!Number.isFinite(det) || Math.abs(det) <= 1e-9 * v3.len(normal)) return null;
        if (-v3.dot(delta, normal) / det < 0) return null;
        // Solve directly in the field basis to preserve its scale and shear.
        const x = v3.dot(delta, v3.cross(axisY, ray.dir)) / det;
        const y = v3.dot(delta, v3.cross(ray.dir, axisX)) / det;
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    };
    return {
        point: (entity: Entity, x: number, y: number) => inverse(entity, x, y, true),
        vector: (entity: Entity, x: number, y: number) => inverse(entity, x, y, false),
        worldPoint,
        rayPoint,
        dispose,
    };
}
