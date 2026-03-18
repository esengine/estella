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
