// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../ecs/component';
import type { Vec3, Quat } from '../types';

export interface CompoundColliderPart3D {
    kind: 'box' | 'sphere' | 'capsule';
    position: Vec3;
    rotation: Quat;
    halfExtents?: Vec3;
    radius?: number;
    /** Cylinder half-height; total capsule height is 2 * (halfHeight + radius). */
    halfHeight?: number;
}

export interface CompoundCollider3DData {
    /** Local model units. The entity's composed scale applies to sizes and offsets. */
    parts: CompoundColliderPart3D[];
    friction: number;
    restitution: number;
    isSensor: boolean;
    mass: number;
    enabled: boolean;
}

export const CompoundCollider3D = defineComponent<CompoundCollider3DData>('CompoundCollider3D', {
    parts: [], friction: .3, restitution: 0, isSensor: false, mass: 1, enabled: true,
});

export const COMPOUND_PART_STRIDE = 11;

/** The side module's bounded primitive packet, in metres, built only when a body is created. */
export function encodeCompoundParts(parts: readonly CompoundColliderPart3D[], scale: Vec3, pixelsPerUnit: number): Float32Array {
    if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0 || parts.length > 16384) throw Error('Invalid compound collider size or units');
    if (![scale.x, scale.y, scale.z].every(v => Number.isFinite(v) && v > 0))
        throw Error('Compound colliders require a finite positive placement scale');
    const out = new Float32Array(parts.length * COMPOUND_PART_STRIDE);
    const sx = Math.abs(scale.x) / pixelsPerUnit, sy = Math.abs(scale.y) / pixelsPerUnit, sz = Math.abs(scale.z) / pixelsPerUnit;
    parts.forEach((part, i) => {
        const at = i * COMPOUND_PART_STRIDE;
        const q = part.rotation, length = Math.hypot(q.x, q.y, q.z, q.w);
        if (!Number.isFinite(length) || length === 0) throw Error('Invalid compound collider rotation');
        const uniform = Math.abs(sx - sy) < 1e-6 && Math.abs(sy - sz) < 1e-6;
        if (!uniform && part.kind !== 'sphere' && Math.hypot(q.x, q.y, q.z) > 1e-6)
            throw Error('Rotated compound primitives under non-uniform scale require baked collision geometry');
        let dimensions: number[];
        if (part.kind === 'box' && part.halfExtents) dimensions = [0, part.halfExtents.x * sx, part.halfExtents.y * sy, part.halfExtents.z * sz];
        else if (part.kind === 'sphere') dimensions = [1, (part.radius ?? 0) * Math.max(sx, sy, sz), 0, 0];
        else if (part.kind === 'capsule') dimensions = [2, (part.radius ?? 0) * Math.max(sx, sz), (part.halfHeight ?? 0) * sy, 0];
        else throw Error('Unsupported compound collider primitive');
        if (dimensions[1]! <= 0 || (part.kind === 'box' && (dimensions[2]! <= 0 || dimensions[3]! <= 0)) || dimensions[2]! < 0) {
            throw Error('Compound collider dimensions must be positive');
        }
        out.set([...dimensions, part.position.x * scale.x / pixelsPerUnit, part.position.y * scale.y / pixelsPerUnit,
            part.position.z * scale.z / pixelsPerUnit, q.x / length, q.y / length, q.z / length, q.w / length], at);
    });
    if (out.some(v => !Number.isFinite(v))) throw Error('Compound collider contains non-finite values');
    return out;
}
