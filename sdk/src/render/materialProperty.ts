// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Vec2, Vec3, Vec4 } from '../types';

/** A material property supplies either a texture reference or a uniform value. Unsupported values leave the parent in effect. */
export function readMaterialProperty(value: unknown): string | number | Vec2 | Vec3 | Vec4 | undefined {
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, number>;
    if ('r' in obj) return { x: obj.r ?? 0, y: obj.g ?? 0, z: obj.b ?? 0, w: obj.a ?? 1 };
    if ('w' in obj) return { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0, w: obj.w ?? 0 };
    if ('z' in obj) return { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0 };
    if ('y' in obj) return { x: obj.x ?? 0, y: obj.y ?? 0 };
    return undefined;
}
