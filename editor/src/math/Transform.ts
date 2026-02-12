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

// =============================================================================
// Entity Data Helpers
// =============================================================================

export interface EntityDataLike {
    components: Array<{ type: string; data: Record<string, unknown> }>;
    parent: number | null;
    children: number[];
}

export function getLocalTransformFromEntity(entity: EntityDataLike): Transform {
    const comp = entity.components.find(c => c.type === 'LocalTransform');
    if (!comp) {
        return createIdentityTransform();
    }

    return {
        position: (comp.data.position as Vec3) ?? IDENTITY_TRANSFORM.position,
        rotation: (comp.data.rotation as Quat) ?? IDENTITY_TRANSFORM.rotation,
        scale: (comp.data.scale as Vec3) ?? IDENTITY_TRANSFORM.scale,
    };
}

export interface UIRectLike {
    size: { x: number; y: number };
    anchor: { x: number; y: number };
    pivot: { x: number; y: number };
}

const DEFAULT_UIRECT: UIRectLike = {
    size: { x: 100, y: 100 },
    anchor: { x: 0.5, y: 0.5 },
    pivot: { x: 0.5, y: 0.5 },
};

export function getUIRectFromEntity(entity: EntityDataLike): UIRectLike | null {
    const comp = entity.components.find(c => c.type === 'UIRect');
    if (!comp) return null;

    return {
        size: (comp.data.size as { x: number; y: number }) ?? DEFAULT_UIRECT.size,
        anchor: (comp.data.anchor as { x: number; y: number }) ?? DEFAULT_UIRECT.anchor,
        pivot: (comp.data.pivot as { x: number; y: number }) ?? DEFAULT_UIRECT.pivot,
    };
}

export function getEntitySize(entity: EntityDataLike): { x: number; y: number } {
    const canvas = entity.components.find(c => c.type === 'Canvas');
    if (canvas?.data?.designResolution) {
        const res = canvas.data.designResolution as { x: number; y: number };
        return { x: res.x, y: res.y };
    }

    const uiRect = getUIRectFromEntity(entity);
    if (uiRect?.size) {
        return uiRect.size;
    }

    const sprite = entity.components.find(c => c.type === 'Sprite');
    if (sprite?.data?.size) {
        return sprite.data.size as { x: number; y: number };
    }

    return { x: 100, y: 100 };
}

// =============================================================================
// UIRect-Adjusted Transform
// =============================================================================

export function getParentSizeForEntity(
    entity: EntityDataLike,
    getParentEntity: (id: number) => EntityDataLike | undefined
): { x: number; y: number } {
    if (entity.parent !== null) {
        const parentData = getParentEntity(entity.parent);
        if (parentData) {
            return getEntitySize(parentData);
        }
    }

    let current = entity;
    while (current.parent !== null) {
        const parent = getParentEntity(current.parent);
        if (!parent) break;
        const canvas = parent.components.find(c => c.type === 'Canvas');
        if (canvas?.data?.designResolution) {
            const res = canvas.data.designResolution as { x: number; y: number };
            return { x: res.x, y: res.y };
        }
        current = parent;
    }
    return { x: 0, y: 0 };
}

export function computeAdjustedLocalTransform(
    entity: EntityDataLike,
    getParentEntity: (id: number) => EntityDataLike | undefined
): Transform {
    const localTransform = getLocalTransformFromEntity(entity);
    const uiRect = getUIRectFromEntity(entity);
    const size = getEntitySize(entity);

    let adjustedPosition = { ...localTransform.position };

    if (uiRect) {
        const parentSize = getParentSizeForEntity(entity, getParentEntity);

        adjustedPosition.x += (uiRect.anchor.x - 0.5) * parentSize.x;
        adjustedPosition.y += (uiRect.anchor.y - 0.5) * parentSize.y;

        adjustedPosition.x += (0.5 - uiRect.pivot.x) * size.x;
        adjustedPosition.y += (0.5 - uiRect.pivot.y) * size.y;
    }

    return {
        position: adjustedPosition,
        rotation: localTransform.rotation,
        scale: localTransform.scale,
    };
}

// =============================================================================
// Matrix Conversion
// =============================================================================

export function transformToMatrix4x4(t: Transform): Float32Array {
    const { x: qx, y: qy, z: qz, w: qw } = t.rotation;
    const { x: sx, y: sy, z: sz } = t.scale;
    const { x: tx, y: ty, z: tz } = t.position;

    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;

    const m = new Float32Array(16);
    m[0]  = (1 - 2 * (yy + zz)) * sx;
    m[1]  = (2 * (xy + wz)) * sx;
    m[2]  = (2 * (xz - wy)) * sx;
    m[3]  = 0;
    m[4]  = (2 * (xy - wz)) * sy;
    m[5]  = (1 - 2 * (xx + zz)) * sy;
    m[6]  = (2 * (yz + wx)) * sy;
    m[7]  = 0;
    m[8]  = (2 * (xz + wy)) * sz;
    m[9]  = (2 * (yz - wx)) * sz;
    m[10] = (1 - 2 * (xx + yy)) * sz;
    m[11] = 0;
    m[12] = tx;
    m[13] = ty;
    m[14] = tz;
    m[15] = 1;
    return m;
}
