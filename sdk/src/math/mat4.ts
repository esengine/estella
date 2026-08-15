// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    mat4.ts
 * @brief   4x4 matrix operations for camera and projection math
 */

const _orthoM = new Float32Array(16);

export function ortho(
    left: number, right: number,
    bottom: number, top: number,
    near: number, far: number,
): Float32Array {
    const m = _orthoM;
    m.fill(0);
    const rl = right - left;
    const tb = top - bottom;
    const fn = far - near;
    m[0]  = 2 / rl;
    m[5]  = 2 / tb;
    m[10] = -2 / fn;
    m[12] = -(right + left) / rl;
    m[13] = -(top + bottom) / tb;
    m[14] = -(far + near) / fn;
    m[15] = 1;
    return m;
}

const _perspM = new Float32Array(16);

export function perspective(
    fovRad: number, aspect: number,
    near: number, far: number,
): Float32Array {
    const m = _perspM;
    m.fill(0);
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = near - far;
    m[0]  = f / aspect;
    m[5]  = f;
    m[10] = (far + near) / nf;
    m[11] = -1;
    m[14] = (2 * far * near) / nf;
    return m;
}

const _invTransM = new Float32Array(16);

export function invertTranslation(x: number, y: number, z: number): Float32Array {
    const m = _invTransM;
    m[0]  = 1; m[1] = 0; m[2]  = 0; m[3]  = 0;
    m[4]  = 0; m[5] = 1; m[6]  = 0; m[7]  = 0;
    m[8]  = 0; m[9] = 0; m[10] = 1; m[11] = 0;
    m[12] = -x; m[13] = -y; m[14] = -z; m[15] = 1;
    return m;
}

const _viewZM = new Float32Array(16);

/**
 * Inverse of a 2D rigid camera transform: rotateZ(-θ) · translate(-x,-y,-z),
 * i.e. the view matrix of a camera at (x,y,z) rotated θ about Z (cosT/sinT =
 * cos/sin θ). With θ = 0 (cosT=1, sinT=0) this equals {@link invertTranslation},
 * so non-rotated cameras are byte-for-byte unchanged.
 */
export function invertViewZ(
    x: number, y: number, z: number,
    cosT: number, sinT: number,
): Float32Array {
    const m = _viewZM;
    m[0] = cosT; m[1] = -sinT; m[2]  = 0; m[3]  = 0;
    m[4] = sinT; m[5] = cosT;  m[6]  = 0; m[7]  = 0;
    m[8] = 0;    m[9] = 0;     m[10] = 1; m[11] = 0;
    m[12] = -(cosT * x + sinT * y);
    m[13] = sinT * x - cosT * y;
    m[14] = -z;
    m[15] = 1;
    return m;
}

const _orbitM = new Float32Array(16);

/**
 * The view matrix of a camera ORBITING a focus point: it stands `distance` away
 * along the direction yaw/pitch name (radians) and looks back at the focus.
 *
 * At yaw = pitch = 0 this equals {@link invertViewZ} at θ = 0 for a camera at
 * (fx, fy, fz + distance) — the 2D view is this one's special case.
 */
export function invertViewOrbit(
    fx: number, fy: number, fz: number,
    yaw: number, pitch: number, distance: number,
): Float32Array {
    const cp = Math.cos(pitch);
    // The camera's own axis, pointing FROM the focus TOWARD the eye (+z of the
    // view basis, since a camera looks down its -z).
    const zx = Math.sin(yaw) * cp;
    const zy = Math.sin(pitch);
    const zz = Math.cos(yaw) * cp;

    // World up is +y; at the poles it is parallel to the view axis, so the right
    // vector is taken from the yaw alone there rather than from a zero cross.
    let rx = zz, ry = 0, rz = -zx;
    const rl = Math.hypot(rx, rz);
    if (rl < 1e-6) { rx = Math.cos(yaw); ry = 0; rz = -Math.sin(yaw); }
    else { rx /= rl; rz /= rl; }

    // up = z × right (right-handed): the other order flips the world upside down,
    // which reads as a working camera until anything is compared to the 2D view.
    const ux = zy * rz - zz * ry;
    const uy = zz * rx - zx * rz;
    const uz = zx * ry - zy * rx;

    const ex = fx + zx * distance;
    const ey = fy + zy * distance;
    const ez = fz + zz * distance;

    const m = _orbitM;
    m[0] = rx; m[1] = ux; m[2] = zx; m[3] = 0;
    m[4] = ry; m[5] = uy; m[6] = zy; m[7] = 0;
    m[8] = rz; m[9] = uz; m[10] = zz; m[11] = 0;
    m[12] = -(rx * ex + ry * ey + rz * ez);
    m[13] = -(ux * ex + uy * ey + uz * ez);
    m[14] = -(zx * ex + zy * ey + zz * ez);
    m[15] = 1;
    return m;
}

const _mulM = new Float32Array(16);

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
    const m = _mulM;
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            m[j * 4 + i] =
                a[0 * 4 + i] * b[j * 4 + 0] +
                a[1 * 4 + i] * b[j * 4 + 1] +
                a[2 * 4 + i] * b[j * 4 + 2] +
                a[3 * 4 + i] * b[j * 4 + 3];
        }
    }
    return m;
}

export const IDENTITY = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);
