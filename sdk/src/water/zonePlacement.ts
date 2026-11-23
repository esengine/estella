// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    zonePlacement.ts
 * @brief   Where an outline is laid in the world, as plain numbers: what a lake or an exclusion volume carries to the worker that
 *          bakes the water, so it is placed there by the same arithmetic as on the main thread.
 */

/** A body's or a volume's world position, rotation (a quaternion), scale, and the height its outline's plane is read at. */
export interface Placement {
    readonly px: number; readonly py: number; readonly pz: number;
    readonly qx: number; readonly qy: number; readonly qz: number; readonly qw: number;
    readonly scale: number;
    /** The world height a world point is put into the outline's space at. */
    readonly level: number;
}

/** A transform's placement, its outline's plane read at `level`. */
export function placementOf(t: { worldPosition: { x: number; y: number; z: number }; worldRotation: { x: number; y: number; z: number; w: number } },
    scale: number, level: number): Placement {
    return {
        px: t.worldPosition.x, py: t.worldPosition.y, pz: t.worldPosition.z,
        qx: t.worldRotation.x, qy: t.worldRotation.y, qz: t.worldRotation.z, qw: t.worldRotation.w,
        scale, level,
    };
}

/** (vx, vy, vz) turned by the quaternion (x, y, z, w). */
export function rotateBy(x: number, y: number, z: number, w: number, vx: number, vy: number, vz: number): [number, number, number] {
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/** A world (x, z) in the outline's own space, read at the placement's level. */
export function placedToLocal(p: Placement, x: number, z: number): [number, number] {
    const r = rotateBy(-p.qx, -p.qy, -p.qz, p.qw, x - p.px, p.level - p.py, z - p.pz);
    return [r[0] / p.scale, r[2] / p.scale];
}

/** A point of the outline's space (x, z) in the world. */
export function placedToWorld(p: Placement, x: number, z: number): [number, number] {
    const r = rotateBy(p.qx, p.qy, p.qz, p.qw, x * p.scale, 0, z * p.scale);
    return [r[0] + p.px, r[2] + p.pz];
}

/** The two ways between the world and an outline's space, for a body or a volume that carries its placement. */
export function placedSpace(p: Placement): { placement: Placement; toLocal(x: number, z: number): [number, number]; toWorld(x: number, z: number): [number, number] } {
    return { placement: p, toLocal: (x, z) => placedToLocal(p, x, z), toWorld: (x, z) => placedToWorld(p, x, z) };
}
