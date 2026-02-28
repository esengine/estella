import { describe, it, expect } from 'vitest';
import {
    intersectRects,
    invertMatrix4,
    screenToWorld,
    pointInWorldRect,
    quaternionToAngle2D,
    worldToScreen,
    createInvVPCache,
    pointInOBB,
} from '../src/ui/uiMath';
import type { ScreenRect } from '../src/ui/uiMath';

// =============================================================================
// Helpers
// =============================================================================

function identity4(): Float32Array {
    const m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    return m;
}

function translation4(tx: number, ty: number, tz: number): Float32Array {
    const m = identity4();
    m[12] = tx; m[13] = ty; m[14] = tz;
    return m;
}

function scale4(sx: number, sy: number, sz: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
    return m;
}

function rotationZ4(radians: number): Float32Array {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const m = identity4();
    m[0] = c; m[1] = s;
    m[4] = -s; m[5] = c;
    return m;
}

function mulMat4(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += a[i + k * 4] * b[k + j * 4];
            }
            out[i + j * 4] = sum;
        }
    }
    return out;
}

function expectMatClose(a: Float32Array, b: Float32Array, precision = 5) {
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i], precision);
    }
}

function quaternionFromAngle(angle: number): { rz: number; rw: number } {
    return { rz: Math.sin(angle / 2), rw: Math.cos(angle / 2) };
}

// =============================================================================
// Tests
// =============================================================================

describe('uiMath', () => {

    // =========================================================================
    // intersectRects
    // =========================================================================

    describe('intersectRects', () => {
        it('should return correct intersection for two overlapping rects', () => {
            const a: ScreenRect = { x: 0, y: 0, w: 10, h: 10 };
            const b: ScreenRect = { x: 5, y: 5, w: 10, h: 10 };
            const r = intersectRects(a, b);
            expect(r).toEqual({ x: 5, y: 5, w: 5, h: 5 });
        });

        it('should return zero-sized rect for non-overlapping rects', () => {
            const a: ScreenRect = { x: 0, y: 0, w: 5, h: 5 };
            const b: ScreenRect = { x: 10, y: 10, w: 5, h: 5 };
            const r = intersectRects(a, b);
            expect(r.w).toBe(0);
            expect(r.h).toBe(0);
        });

        it('should return inner rect when one is fully inside another', () => {
            const outer: ScreenRect = { x: 0, y: 0, w: 20, h: 20 };
            const inner: ScreenRect = { x: 5, y: 5, w: 5, h: 5 };
            const r = intersectRects(outer, inner);
            expect(r).toEqual({ x: 5, y: 5, w: 5, h: 5 });
        });

        it('should return same rect for identical rects', () => {
            const a: ScreenRect = { x: 3, y: 4, w: 10, h: 8 };
            const r = intersectRects(a, a);
            expect(r).toEqual(a);
        });

        it('should return zero width/height for edge-touching rects', () => {
            const a: ScreenRect = { x: 0, y: 0, w: 5, h: 5 };
            const b: ScreenRect = { x: 5, y: 0, w: 5, h: 5 };
            const r = intersectRects(a, b);
            expect(r.w).toBe(0);
        });

        it('should handle partial overlap on one axis only', () => {
            const a: ScreenRect = { x: 0, y: 0, w: 10, h: 5 };
            const b: ScreenRect = { x: 5, y: 10, w: 10, h: 5 };
            const r = intersectRects(a, b);
            expect(r.h).toBe(0);
        });
    });

    // =========================================================================
    // invertMatrix4
    // =========================================================================

    describe('invertMatrix4', () => {
        it('should invert identity to identity', () => {
            const id = identity4();
            const inv = invertMatrix4(id);
            expectMatClose(inv, id);
        });

        it('should invert translation to negative translation', () => {
            const t = translation4(3, -7, 5);
            const inv = invertMatrix4(t);
            expect(inv[12]).toBeCloseTo(-3);
            expect(inv[13]).toBeCloseTo(7);
            expect(inv[14]).toBeCloseTo(-5);
        });

        it('should invert scale to reciprocal scale', () => {
            const s = scale4(2, 4, 0.5);
            const inv = invertMatrix4(s);
            expect(inv[0]).toBeCloseTo(0.5);
            expect(inv[5]).toBeCloseTo(0.25);
            expect(inv[10]).toBeCloseTo(2);
        });

        it('should satisfy M * M^-1 = Identity', () => {
            const m = translation4(5, -3, 1);
            m[0] = 2; m[5] = 3;
            const inv = invertMatrix4(m);
            const product = mulMat4(m, inv);
            expectMatClose(product, identity4());
        });

        it('should return zero-filled output for singular matrix', () => {
            const singular = new Float32Array(16);
            const inv = invertMatrix4(singular);
            for (let i = 0; i < 16; i++) {
                expect(inv[i]).toBe(0);
            }
        });

        it('should write to custom result buffer', () => {
            const id = identity4();
            const buf = new Float32Array(16);
            const result = invertMatrix4(id, buf);
            expect(result).toBe(buf);
            expectMatClose(buf, id);
        });

        it('should correctly invert a 2D rotation matrix', () => {
            const angle = Math.PI / 3;
            const rot = rotationZ4(angle);
            const inv = invertMatrix4(rot);
            const product = mulMat4(rot, inv);
            expectMatClose(product, identity4());
        });

        it('should invert an orthographic projection matrix', () => {
            const ortho = new Float32Array(16);
            const l = -10, r = 10, b = -5, t = 5, n = -1, f = 1;
            ortho[0] = 2 / (r - l);
            ortho[5] = 2 / (t - b);
            ortho[10] = -2 / (f - n);
            ortho[12] = -(r + l) / (r - l);
            ortho[13] = -(t + b) / (t - b);
            ortho[14] = -(f + n) / (f - n);
            ortho[15] = 1;
            const inv = invertMatrix4(ortho);
            const product = mulMat4(ortho, inv);
            expectMatClose(product, identity4());
        });
    });

    // =========================================================================
    // screenToWorld
    // =========================================================================

    describe('screenToWorld', () => {
        it('should map viewport center to world origin with identity VP', () => {
            const invVP = identity4();
            const result = screenToWorld(400, 300, invVP, 0, 0, 800, 600);
            expect(result.x).toBeCloseTo(0);
            expect(result.y).toBeCloseTo(0);
        });

        it('should map viewport corners to NDC corners with identity VP', () => {
            const invVP = identity4();
            const topLeft = screenToWorld(0, 0, invVP, 0, 0, 800, 600);
            expect(topLeft.x).toBeCloseTo(-1);
            expect(topLeft.y).toBeCloseTo(-1);

            const bottomRight = screenToWorld(800, 600, invVP, 0, 0, 800, 600);
            expect(bottomRight.x).toBeCloseTo(1);
            expect(bottomRight.y).toBeCloseTo(1);
        });

        it('should apply translation from VP inverse', () => {
            const invVP = translation4(10, 20, 0);
            const result = screenToWorld(400, 300, invVP, 0, 0, 800, 600);
            expect(result.x).toBeCloseTo(10);
            expect(result.y).toBeCloseTo(20);
        });

        it('should handle viewport offset (vpX, vpY non-zero)', () => {
            const invVP = identity4();
            const result = screenToWorld(200, 200, invVP, 100, 100, 200, 200);
            expect(result.x).toBeCloseTo(0);
            expect(result.y).toBeCloseTo(0);
        });

        it('should roundtrip with worldToScreen for identity VP', () => {
            const vp = identity4();
            const invVP = invertMatrix4(vp);
            const sx = 250, sy = 180;
            const vpX = 0, vpY = 0, vpW = 800, vpH = 600;
            const world = screenToWorld(sx, sy, invVP, vpX, vpY, vpW, vpH);
            const [backX, backY] = worldToScreen(world.x, world.y, vp, vpX, vpY, vpW, vpH);
            expect(backX).toBeCloseTo(sx);
            expect(backY).toBeCloseTo(sy);
        });

        it('should roundtrip with worldToScreen for scaled VP', () => {
            const vp = scale4(0.5, 0.5, 1);
            vp[15] = 1;
            const invVP = invertMatrix4(vp);
            const sx = 300, sy = 400;
            const vpX = 0, vpY = 0, vpW = 800, vpH = 600;
            const world = screenToWorld(sx, sy, invVP, vpX, vpY, vpW, vpH);
            const [backX, backY] = worldToScreen(world.x, world.y, vp, vpX, vpY, vpW, vpH);
            expect(backX).toBeCloseTo(sx);
            expect(backY).toBeCloseTo(sy);
        });
    });

    // =========================================================================
    // worldToScreen
    // =========================================================================

    describe('worldToScreen', () => {
        it('should map world origin to viewport center with identity VP', () => {
            const vp = identity4();
            const [sx, sy] = worldToScreen(0, 0, vp, 0, 0, 800, 600);
            expect(sx).toBeCloseTo(400);
            expect(sy).toBeCloseTo(300);
        });

        it('should map world (-1,-1) to viewport origin with identity VP', () => {
            const vp = identity4();
            const [sx, sy] = worldToScreen(-1, -1, vp, 0, 0, 800, 600);
            expect(sx).toBeCloseTo(0);
            expect(sy).toBeCloseTo(0);
        });

        it('should handle scaled VP matrix', () => {
            const vp = scale4(2, 2, 1);
            vp[15] = 1;
            const [sx, sy] = worldToScreen(0.5, 0.5, vp, 0, 0, 800, 600);
            expect(sx).toBeCloseTo(800);
            expect(sy).toBeCloseTo(600);
        });

        it('should apply viewport offset', () => {
            const vp = identity4();
            const [sx, sy] = worldToScreen(0, 0, vp, 50, 100, 800, 600);
            expect(sx).toBeCloseTo(450);
            expect(sy).toBeCloseTo(400);
        });

        it('should be consistent with screenToWorld roundtrip', () => {
            const vp = translation4(0.5, -0.3, 0);
            const invVP = invertMatrix4(vp);
            const vpX = 10, vpY = 20, vpW = 640, vpH = 480;
            const wx = 3.5, wy = -2.1;
            const [sx, sy] = worldToScreen(wx, wy, vp, vpX, vpY, vpW, vpH);
            const back = screenToWorld(sx, sy, invVP, vpX, vpY, vpW, vpH);
            expect(back.x).toBeCloseTo(wx);
            expect(back.y).toBeCloseTo(wy);
        });
    });

    // =========================================================================
    // pointInWorldRect
    // =========================================================================

    describe('pointInWorldRect', () => {
        it('should return true for point at center', () => {
            expect(pointInWorldRect(5, 5, 5, 5, 10, 10, 0.5, 0.5)).toBe(true);
        });

        it('should return false for point outside', () => {
            expect(pointInWorldRect(20, 20, 5, 5, 10, 10, 0.5, 0.5)).toBe(false);
        });

        it('should return true for point on edge (boundary inclusive)', () => {
            expect(pointInWorldRect(0, 0, 5, 5, 10, 10, 0.5, 0.5)).toBe(true);
            expect(pointInWorldRect(10, 10, 5, 5, 10, 10, 0.5, 0.5)).toBe(true);
        });

        it('should handle default pivot (0.5, 0.5) with symmetric bounds', () => {
            expect(pointInWorldRect(-5, 0, 0, 0, 10, 10, 0.5, 0.5)).toBe(true);
            expect(pointInWorldRect(5, 0, 0, 0, 10, 10, 0.5, 0.5)).toBe(true);
            expect(pointInWorldRect(-5.01, 0, 0, 0, 10, 10, 0.5, 0.5)).toBe(false);
        });

        it('should handle pivot (0, 0) extending right and up', () => {
            expect(pointInWorldRect(5, 5, 0, 0, 10, 10, 0, 0)).toBe(true);
            expect(pointInWorldRect(-1, -1, 0, 0, 10, 10, 0, 0)).toBe(false);
        });

        it('should handle pivot (1, 1) extending left and down', () => {
            expect(pointInWorldRect(-5, -5, 0, 0, 10, 10, 1, 1)).toBe(true);
            expect(pointInWorldRect(1, 1, 0, 0, 10, 10, 1, 1)).toBe(false);
        });

        it('should handle zero-size rect (only exact center matches)', () => {
            expect(pointInWorldRect(5, 5, 5, 5, 0, 0, 0.5, 0.5)).toBe(true);
            expect(pointInWorldRect(5.001, 5, 5, 5, 0, 0, 0.5, 0.5)).toBe(false);
        });
    });

    // =========================================================================
    // quaternionToAngle2D
    // =========================================================================

    describe('quaternionToAngle2D', () => {
        it('should return 0 for identity quaternion', () => {
            expect(quaternionToAngle2D(0, 1)).toBeCloseTo(0);
        });

        it('should return PI/2 for 90 degree rotation', () => {
            const q = quaternionFromAngle(Math.PI / 2);
            expect(quaternionToAngle2D(q.rz, q.rw)).toBeCloseTo(Math.PI / 2);
        });

        it('should return PI for 180 degree rotation', () => {
            const q = quaternionFromAngle(Math.PI);
            expect(quaternionToAngle2D(q.rz, q.rw)).toBeCloseTo(Math.PI);
        });

        it('should return -PI/2 for -90 degree rotation', () => {
            const q = quaternionFromAngle(-Math.PI / 2);
            expect(quaternionToAngle2D(q.rz, q.rw)).toBeCloseTo(-Math.PI / 2);
        });

        it('should return 2*PI for 360 degree rotation (atan2 does not wrap)', () => {
            const q = quaternionFromAngle(2 * Math.PI);
            const angle = quaternionToAngle2D(q.rz, q.rw);
            expect(angle).toBeCloseTo(2 * Math.PI, 4);
        });
    });

    // =========================================================================
    // pointInOBB
    // =========================================================================

    describe('pointInOBB', () => {
        it('should behave like pointInWorldRect with no rotation', () => {
            const q = quaternionFromAngle(0);
            expect(pointInOBB(5, 5, 5, 5, 10, 10, 0.5, 0.5, q.rz, q.rw)).toBe(true);
            expect(pointInOBB(20, 20, 5, 5, 10, 10, 0.5, 0.5, q.rz, q.rw)).toBe(false);
        });

        it('should detect point inside 45-degree rotated rect', () => {
            const q = quaternionFromAngle(Math.PI / 4);
            expect(pointInOBB(5, 5, 5, 5, 10, 10, 0.5, 0.5, q.rz, q.rw)).toBe(true);
        });

        it('should reject point outside rotated rect but inside AABB', () => {
            const q = quaternionFromAngle(Math.PI / 4);
            expect(pointInOBB(10, 5, 5, 5, 6, 6, 0.5, 0.5, q.rz, q.rw)).toBe(false);
        });

        it('should handle 90-degree rotation (swapped axes)', () => {
            const q = quaternionFromAngle(Math.PI / 2);
            expect(pointInOBB(5, 9, 5, 5, 10, 2, 0.5, 0.5, q.rz, q.rw)).toBe(true);
            expect(pointInOBB(9, 5, 5, 5, 10, 2, 0.5, 0.5, q.rz, q.rw)).toBe(false);
        });

        it('should always contain center point at any rotation', () => {
            for (const angle of [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI]) {
                const q = quaternionFromAngle(angle);
                expect(pointInOBB(5, 5, 5, 5, 10, 10, 0.5, 0.5, q.rz, q.rw)).toBe(true);
            }
        });

        it('should handle custom pivot with rotation', () => {
            const q = quaternionFromAngle(0);
            expect(pointInOBB(5, 5, 0, 0, 10, 10, 0, 0, q.rz, q.rw)).toBe(true);
            expect(pointInOBB(-1, -1, 0, 0, 10, 10, 0, 0, q.rz, q.rw)).toBe(false);
        });

        it('should handle zero-size OBB', () => {
            const q = quaternionFromAngle(Math.PI / 4);
            expect(pointInOBB(5, 5, 5, 5, 0, 0, 0.5, 0.5, q.rz, q.rw)).toBe(true);
            expect(pointInOBB(5.1, 5, 5, 5, 0, 0, 0.5, 0.5, q.rz, q.rw)).toBe(false);
        });
    });

    // =========================================================================
    // createInvVPCache
    // =========================================================================

    describe('createInvVPCache', () => {
        it('should compute inverse on first call', () => {
            const cache = createInvVPCache();
            const vp = identity4();
            cache.update(vp);
            const inv = cache.getInverse(vp);
            expectMatClose(inv, identity4());
        });

        it('should return cached result for same VP', () => {
            const cache = createInvVPCache();
            const vp = translation4(3, 4, 0);
            cache.update(vp);
            const inv1 = cache.getInverse(vp);
            const inv2 = cache.getInverse(vp);
            expect(inv1).toBe(inv2);
        });

        it('should recompute when VP changes', () => {
            const cache = createInvVPCache();
            const vp1 = translation4(1, 0, 0);
            cache.update(vp1);
            const inv1Snapshot = new Float32Array(cache.getInverse(vp1));

            const vp2 = translation4(2, 0, 0);
            cache.update(vp2);
            const inv2 = cache.getInverse(vp2);

            expect(inv2[12]).toBeCloseTo(-2);
            expect(inv1Snapshot[12]).toBeCloseTo(-1);
        });

        it('should return valid inverse (multiply original gives identity)', () => {
            const cache = createInvVPCache();
            const vp = scale4(3, 2, 1);
            vp[15] = 1;
            cache.update(vp);
            const inv = cache.getInverse(vp);
            const product = mulMat4(vp, inv);
            expectMatClose(product, identity4());
        });

        it('should work with update then getInverse sequence', () => {
            const cache = createInvVPCache();
            const vp = translation4(5, -3, 0);
            cache.update(vp);
            const inv = cache.getInverse(vp);
            expect(inv[12]).toBeCloseTo(-5);
            expect(inv[13]).toBeCloseTo(3);
        });
    });
});
