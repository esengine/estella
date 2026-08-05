// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export interface ScreenRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const t = Math.min(a.y + a.h, b.y + b.h);
    return { x, y, w: Math.max(0, r - x), h: Math.max(0, t - y) };
}

export function invertMatrix4(m: Float32Array, result?: Float32Array): Float32Array {
    const out = result ?? new Float32Array(16);

    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det === 0) return out;
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

    return out;
}

/**
 * Unprojects one NDC point, depth included.
 *
 * The full 4×4 product, unlike the x/y-only shortcut it replaces — under a
 * perspective projection the third column is not zero, so a screen point does
 * not name a world point at all until a depth is chosen.
 */
function unproject(
    ndcX: number, ndcY: number, ndcZ: number, m: Float32Array,
): { x: number; y: number; z: number } {
    const x = m[0] * ndcX + m[4] * ndcY + m[8] * ndcZ + m[12];
    const y = m[1] * ndcX + m[5] * ndcY + m[9] * ndcZ + m[13];
    const z = m[2] * ndcX + m[6] * ndcY + m[10] * ndcZ + m[14];
    const w = m[3] * ndcX + m[7] * ndcY + m[11] * ndcZ + m[15];
    const inv = w !== 0 ? 1 / w : 0;
    return { x: x * inv, y: y * inv, z: z * inv };
}

/**
 * Where a screen point lands on the world plane at @p planeZ.
 *
 * @details A screen point is a RAY, not a position. Orthographically the ray's
 *          x/y are constant along its length, which is why taking z = 0 worked
 *          and why every 2D caller can keep calling this unchanged. Under a
 *          perspective camera they are not constant, and the same call would
 *          answer with wherever the near plane happened to be — off by more the
 *          further the content sits from z = 0.
 *
 *          So the ray is intersected with the plane, which is one implementation
 *          with the orthographic case as its degenerate form rather than two
 *          branches that have to agree. `planeZ` defaults to the 2D plane, so a
 *          caller that has no depth in mind keeps getting the 2D answer.
 */
export function screenToWorld(
    screenX: number, screenY: number,
    inverseVP: Float32Array,
    vpX: number, vpY: number, vpW: number, vpH: number,
    planeZ = 0,
): { x: number; y: number } {
    const ndcX = ((screenX - vpX) / vpW) * 2 - 1;
    const ndcY = ((screenY - vpY) / vpH) * 2 - 1;

    const near = unproject(ndcX, ndcY, -1, inverseVP);
    const far = unproject(ndcX, ndcY, 1, inverseVP);

    const dz = far.z - near.z;
    // A ray parallel to the plane it is being intersected with has no answer;
    // the near point is the closest thing to one, and it is what the
    // orthographic path returned before this existed.
    if (dz === 0) return { x: near.x, y: near.y };

    const t = (planeZ - near.z) / dz;
    return { x: near.x + (far.x - near.x) * t, y: near.y + (far.y - near.y) * t };
}

export function pointInWorldRect(
    px: number, py: number,
    worldX: number, worldY: number,
    worldW: number, worldH: number,
    pivotX: number, pivotY: number
): boolean {
    const left = worldX - worldW * pivotX;
    const right = worldX + worldW * (1 - pivotX);
    const bottom = worldY - worldH * pivotY;
    const top = worldY + worldH * (1 - pivotY);
    return px >= left && px <= right && py >= bottom && py <= top;
}

export function quaternionToAngle2D(rz: number, rw: number): number {
    return 2 * Math.atan2(rz, rw);
}

/**
 * Where a world point lands on screen — the inverse of {@link screenToWorld}, and
 * it takes the same third dimension.
 *
 * @details A point off the z = 0 plane projects to a different place than its
 *          shadow on it: nearer content is larger and further from the centre.
 *          Dropping @p wz would put an entity's outline, gizmo and screen rect
 *          where the entity is NOT drawn — the exact error the unproject side
 *          already fixed by taking a plane. Defaults to the 2D plane, so every
 *          existing 2D caller keeps its answer to the bit.
 */
export function worldToScreen(
    wx: number, wy: number,
    vp: Float32Array, vpX: number, vpY: number, vpW: number, vpH: number,
    wz = 0,
): [number, number] {
    const clipX = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12];
    const clipY = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13];
    const clipW = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15];
    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    return [
        vpX + (ndcX * 0.5 + 0.5) * vpW,
        vpY + (ndcY * 0.5 + 0.5) * vpH,
    ];
}

export function createInvVPCache() {
    const invVP = new Float32Array(16);
    const cachedVP = new Float32Array(16);
    let dirty = true;

    return {
        update(vp: Float32Array): void {
            for (let i = 0; i < 16; i++) {
                if (cachedVP[i] !== vp[i]) {
                    cachedVP.set(vp);
                    dirty = true;
                    break;
                }
            }
        },
        getInverse(vp: Float32Array): Float32Array {
            if (dirty) {
                invertMatrix4(vp, invVP);
                dirty = false;
            }
            return invVP;
        },
    };
}

export function pointInOBB(
    px: number, py: number,
    worldX: number, worldY: number,
    worldW: number, worldH: number,
    pivotX: number, pivotY: number,
    rotationZ: number, rotationW: number,
): boolean {
    if (rotationZ === 0 && rotationW === 1) {
        return pointInWorldRect(px, py, worldX, worldY, worldW, worldH, pivotX, pivotY);
    }

    const angle = quaternionToAngle2D(rotationZ, rotationW);
    const sin = Math.sin(-angle);
    const cos = Math.cos(-angle);

    const dx = px - worldX;
    const dy = py - worldY;
    const localX = dx * cos - dy * sin + worldX;
    const localY = dx * sin + dy * cos + worldY;

    const left = worldX - worldW * pivotX;
    const right = worldX + worldW * (1 - pivotX);
    const bottom = worldY - worldH * pivotY;
    const top = worldY + worldH * (1 - pivotY);
    return localX >= left && localX <= right && localY >= bottom && localY <= top;
}
