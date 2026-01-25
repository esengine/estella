/**
 * ESEngine TypeScript SDK - Math Utilities
 *
 * Provides common math operations for game development.
 */

import { Vec2, Vec3, Vec4, Mat4, mat4Identity } from '../core/Types';

// Constants
export const PI = Math.PI;
export const TWO_PI = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Convert degrees to radians.
 */
export function toRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/**
 * Convert radians to degrees.
 */
export function toDegrees(radians: number): number {
  return radians * RAD_TO_DEG;
}

// ========== Vec2 Operations ==========

export namespace Vec2Math {
  export function add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  export function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  export function mul(v: Vec2, scalar: number): Vec2 {
    return { x: v.x * scalar, y: v.y * scalar };
  }

  export function div(v: Vec2, scalar: number): Vec2 {
    return { x: v.x / scalar, y: v.y / scalar };
  }

  export function dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
  }

  export function length(v: Vec2): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  }

  export function lengthSquared(v: Vec2): number {
    return v.x * v.x + v.y * v.y;
  }

  export function normalize(v: Vec2): Vec2 {
    const len = length(v);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  export function distance(a: Vec2, b: Vec2): number {
    return length(sub(b, a));
  }

  export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }
}

// ========== Vec3 Operations ==========

export namespace Vec3Math {
  export function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  export function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  export function mul(v: Vec3, scalar: number): Vec3 {
    return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
  }

  export function div(v: Vec3, scalar: number): Vec3 {
    return { x: v.x / scalar, y: v.y / scalar, z: v.z / scalar };
  }

  export function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  export function cross(a: Vec3, b: Vec3): Vec3 {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  }

  export function length(v: Vec3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  export function lengthSquared(v: Vec3): number {
    return v.x * v.x + v.y * v.y + v.z * v.z;
  }

  export function normalize(v: Vec3): Vec3 {
    const len = length(v);
    if (len === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  export function distance(a: Vec3, b: Vec3): number {
    return length(sub(b, a));
  }

  export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  }
}

// ========== Mat4 Operations ==========

export namespace Mat4Math {
  /**
   * Multiply two 4x4 matrices.
   */
  export function multiply(a: Mat4, b: Mat4): Mat4 {
    const result = new Float32Array(16);

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[i * 4 + j] =
          a[i * 4 + 0] * b[0 * 4 + j] +
          a[i * 4 + 1] * b[1 * 4 + j] +
          a[i * 4 + 2] * b[2 * 4 + j] +
          a[i * 4 + 3] * b[3 * 4 + j];
      }
    }

    return result;
  }

  /**
   * Create a translation matrix.
   */
  export function translate(x: number, y: number, z: number): Mat4 {
    const m = mat4Identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  }

  /**
   * Create a scale matrix.
   */
  export function scale(x: number, y: number, z: number): Mat4 {
    const m = new Float32Array(16);
    m[0] = x;
    m[5] = y;
    m[10] = z;
    m[15] = 1;
    return m;
  }

  /**
   * Create a rotation matrix around the Z axis.
   */
  export function rotateZ(angle: number): Mat4 {
    const m = mat4Identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m[0] = c;
    m[1] = s;
    m[4] = -s;
    m[5] = c;
    return m;
  }

  /**
   * Create a rotation matrix around the X axis.
   */
  export function rotateX(angle: number): Mat4 {
    const m = mat4Identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m[5] = c;
    m[6] = s;
    m[9] = -s;
    m[10] = c;
    return m;
  }

  /**
   * Create a rotation matrix around the Y axis.
   */
  export function rotateY(angle: number): Mat4 {
    const m = mat4Identity();
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    m[0] = c;
    m[2] = -s;
    m[8] = s;
    m[10] = c;
    return m;
  }

  /**
   * Create an orthographic projection matrix.
   */
  export function ortho(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number
  ): Mat4 {
    const m = new Float32Array(16);
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);

    m[0] = -2 * lr;
    m[5] = -2 * bt;
    m[10] = 2 * nf;
    m[12] = (left + right) * lr;
    m[13] = (top + bottom) * bt;
    m[14] = (far + near) * nf;
    m[15] = 1;

    return m;
  }

  /**
   * Create a perspective projection matrix.
   */
  export function perspective(
    fov: number,
    aspect: number,
    near: number,
    far: number
  ): Mat4 {
    const m = new Float32Array(16);
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);

    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;

    return m;
  }

  /**
   * Create a look-at view matrix.
   */
  export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
    const z = Vec3Math.normalize(Vec3Math.sub(eye, target));
    const x = Vec3Math.normalize(Vec3Math.cross(up, z));
    const y = Vec3Math.cross(z, x);

    const m = new Float32Array(16);
    m[0] = x.x;
    m[1] = y.x;
    m[2] = z.x;
    m[4] = x.y;
    m[5] = y.y;
    m[6] = z.y;
    m[8] = x.z;
    m[9] = y.z;
    m[10] = z.z;
    m[12] = -Vec3Math.dot(x, eye);
    m[13] = -Vec3Math.dot(y, eye);
    m[14] = -Vec3Math.dot(z, eye);
    m[15] = 1;

    return m;
  }
}
