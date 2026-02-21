/**
 * @file    Transform.ts
 * @brief   Math utilities for transform calculations
 */

import { computeUIRectLayout, DEFAULT_SPRITE_SIZE, type LayoutRect } from 'esengine';

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
    anchorMin: { x: number; y: number };
    anchorMax: { x: number; y: number };
    offsetMin: { x: number; y: number };
    offsetMax: { x: number; y: number };
    size: { x: number; y: number };
    pivot: { x: number; y: number };
}

const DEFAULT_UIRECT: UIRectLike = {
    anchorMin: { x: 0.5, y: 0.5 },
    anchorMax: { x: 0.5, y: 0.5 },
    offsetMin: { x: 0, y: 0 },
    offsetMax: { x: 0, y: 0 },
    size: { ...DEFAULT_SPRITE_SIZE },
    pivot: { x: 0.5, y: 0.5 },
};

export function getUIRectFromEntity(entity: EntityDataLike): UIRectLike | null {
    const comp = entity.components.find(c => c.type === 'UIRect');
    if (!comp) return null;

    const data = comp.data as Record<string, any>;
    let anchorMin = data.anchorMin as { x: number; y: number } | undefined;
    let anchorMax = data.anchorMax as { x: number; y: number } | undefined;
    if (!anchorMin && data.anchor) {
        anchorMin = data.anchor as { x: number; y: number };
        anchorMax = { ...anchorMin };
    }

    return {
        anchorMin: anchorMin ?? DEFAULT_UIRECT.anchorMin,
        anchorMax: anchorMax ?? DEFAULT_UIRECT.anchorMax,
        offsetMin: (data.offsetMin as { x: number; y: number }) ?? DEFAULT_UIRECT.offsetMin,
        offsetMax: (data.offsetMax as { x: number; y: number }) ?? DEFAULT_UIRECT.offsetMax,
        size: (data.size as { x: number; y: number }) ?? DEFAULT_UIRECT.size,
        pivot: (data.pivot as { x: number; y: number }) ?? DEFAULT_UIRECT.pivot,
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

    return { ...DEFAULT_SPRITE_SIZE };
}

// =============================================================================
// ScreenSpace Layout Helpers
// =============================================================================

export function isInScreenSpaceHierarchy(
    entity: EntityDataLike,
    getParentEntity: (id: number) => EntityDataLike | undefined,
): boolean {
    if (entity.components.some(c => c.type === 'ScreenSpace')) return true;
    let parentId = entity.parent;
    while (parentId !== null) {
        const parent = getParentEntity(parentId);
        if (!parent) break;
        if (parent.components.some(c => c.type === 'ScreenSpace')) return true;
        parentId = parent.parent;
    }
    return false;
}

export function findCanvasWorldRect(allEntities: EntityDataLike[]): LayoutRect | null {
    let designResolution: { x: number; y: number } | null = null;
    let cameraPos = { x: 0, y: 0 };

    for (const e of allEntities) {
        const canvas = e.components.find(c => c.type === 'Canvas');
        if (canvas?.data?.designResolution) {
            designResolution = canvas.data.designResolution as { x: number; y: number };
        }
        const camera = e.components.find(c => c.type === 'Camera');
        if (camera) {
            const lt = e.components.find(c => c.type === 'LocalTransform');
            if (lt?.data?.position) {
                const pos = lt.data.position as { x: number; y: number };
                cameraPos = { x: pos.x, y: pos.y };
            }
        }
    }

    if (!designResolution) return null;

    const halfW = designResolution.x / 2;
    const halfH = designResolution.y / 2;
    return {
        left: cameraPos.x - halfW,
        bottom: cameraPos.y - halfH,
        right: cameraPos.x + halfW,
        top: cameraPos.y + halfH,
    };
}

function computeScreenSpaceTransform(
    entity: EntityDataLike,
    getParentEntity: (id: number) => EntityDataLike | undefined,
    canvasRect: LayoutRect,
): Transform {
    const localTransform = getLocalTransformFromEntity(entity);

    const path: EntityDataLike[] = [];
    let cur: EntityDataLike | undefined = entity;
    while (cur) {
        path.unshift(cur);
        if (cur.components.some(c => c.type === 'ScreenSpace')) break;
        if (cur.parent === null) break;
        cur = getParentEntity(cur.parent);
    }

    let parentRect = canvasRect;
    let parentCenterX = (canvasRect.left + canvasRect.right) * 0.5;
    let parentCenterY = (canvasRect.bottom + canvasRect.top) * 0.5;

    let resultX = 0;
    let resultY = 0;

    for (let i = 0; i < path.length; i++) {
        const node = path[i];
        const uiRect = getUIRectFromEntity(node);
        if (!uiRect) {
            const lt = getLocalTransformFromEntity(node);
            resultX = lt.position.x;
            resultY = lt.position.y;
            continue;
        }

        const layout = computeUIRectLayout(
            uiRect.anchorMin, uiRect.anchorMax,
            uiRect.offsetMin, uiRect.offsetMax,
            uiRect.size, parentRect,
        );

        const isRoot = i === 0;
        if (isRoot) {
            resultX = layout.originX;
            resultY = layout.originY;
        } else {
            resultX = layout.originX - parentCenterX;
            resultY = layout.originY - parentCenterY;
        }

        parentRect = layout.rect;
        parentCenterX = layout.originX;
        parentCenterY = layout.originY;
    }

    return {
        position: { x: resultX, y: resultY, z: localTransform.position.z },
        rotation: localTransform.rotation,
        scale: localTransform.scale,
    };
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
    getParentEntity: (id: number) => EntityDataLike | undefined,
    allEntities?: EntityDataLike[],
    cachedCanvasRect?: LayoutRect | null,
): Transform {
    if (isInScreenSpaceHierarchy(entity, getParentEntity)) {
        const canvasRect = cachedCanvasRect
            ?? (allEntities ? findCanvasWorldRect(allEntities) : null);
        if (canvasRect) {
            return computeScreenSpaceTransform(entity, getParentEntity, canvasRect);
        }
    }

    const localTransform = getLocalTransformFromEntity(entity);
    const uiRect = getUIRectFromEntity(entity);
    const size = getEntitySize(entity);

    let adjustedPosition = { ...localTransform.position };

    if (uiRect) {
        const parentSize = getParentSizeForEntity(entity, getParentEntity);
        const anchorX = (uiRect.anchorMin.x + uiRect.anchorMax.x) * 0.5;
        const anchorY = (uiRect.anchorMin.y + uiRect.anchorMax.y) * 0.5;

        adjustedPosition.x += (anchorX - 0.5) * parentSize.x;
        adjustedPosition.y += (anchorY - 0.5) * parentSize.y;

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
