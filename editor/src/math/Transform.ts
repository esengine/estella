/**
 * @file    Transform.ts
 * @brief   Math utilities for transform calculations
 */

// =============================================================================
// Types
// =============================================================================

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface Transform {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}

// =============================================================================
// Constants
// =============================================================================

export const IDENTITY_TRANSFORM: Readonly<Transform> = Object.freeze({
    position: Object.freeze({ x: 0, y: 0, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
    scale: Object.freeze({ x: 1, y: 1, z: 1 }),
});

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

// =============================================================================
// Quaternion Operations
// =============================================================================

/**
 * @brief Multiply two quaternions: result = a * b
 */
export function multiplyQuat(a: Quat, b: Quat): Quat {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

/**
 * @brief Rotate a vector by a quaternion
 */
export function rotateVector(v: Vec3, q: Quat): Vec3 {
    const { x: qx, y: qy, z: qz, w: qw } = q;
    const { x: vx, y: vy, z: vz } = v;

    const ix = qw * vx + qy * vz - qz * vy;
    const iy = qw * vy + qz * vx - qx * vz;
    const iz = qw * vz + qx * vy - qy * vx;
    const iw = -qx * vx - qy * vy - qz * vz;

    return {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
    };
}

/**
 * @brief Convert quaternion to Euler angles (degrees)
 */
export function quatToEuler(q: Quat): Vec3 {
    const { x, y, z, w } = q;

    const sinrCosp = 2 * (w * x + y * z);
    const cosrCosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinrCosp, cosrCosp);

    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1
        ? Math.sign(sinp) * Math.PI / 2
        : Math.asin(sinp);

    const sinyCosp = 2 * (w * z + x * y);
    const cosyCosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(sinyCosp, cosyCosp);

    return {
        x: roll * RAD_TO_DEG,
        y: pitch * RAD_TO_DEG,
        z: yaw * RAD_TO_DEG,
    };
}

/**
 * @brief Convert Euler angles (degrees) to quaternion
 */
export function eulerToQuat(euler: Vec3): Quat {
    const roll = euler.x * DEG_TO_RAD;
    const pitch = euler.y * DEG_TO_RAD;
    const yaw = euler.z * DEG_TO_RAD;

    const cr = Math.cos(roll * 0.5);
    const sr = Math.sin(roll * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);

    return {
        w: cr * cp * cy + sr * sp * sy,
        x: sr * cp * cy - cr * sp * sy,
        y: cr * sp * cy + sr * cp * sy,
        z: cr * cp * sy - sr * sp * cy,
    };
}

// =============================================================================
// Transform Operations
// =============================================================================

/**
 * @brief Compose parent and child transforms: worldChild = worldParent * localChild
 */
export function composeTransforms(parent: Transform, child: Transform): Transform {
    const rotatedPos = rotateVector(child.position, parent.rotation);

    return {
        position: {
            x: parent.position.x + rotatedPos.x * parent.scale.x,
            y: parent.position.y + rotatedPos.y * parent.scale.y,
            z: parent.position.z + rotatedPos.z * parent.scale.z,
        },
        rotation: multiplyQuat(parent.rotation, child.rotation),
        scale: {
            x: parent.scale.x * child.scale.x,
            y: parent.scale.y * child.scale.y,
            z: parent.scale.z * child.scale.z,
        },
    };
}

/**
 * @brief Create a copy of an identity transform
 */
export function createIdentityTransform(): Transform {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
    };
}

/**
 * @brief Clone a transform
 */
export function cloneTransform(t: Transform): Transform {
    return {
        position: { ...t.position },
        rotation: { ...t.rotation },
        scale: { ...t.scale },
    };
}
