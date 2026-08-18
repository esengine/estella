// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
    screenRay,
    rayPlaneHit,
} from '../src/ui/util/math';
import type { ScreenRect } from '../src/ui/util/math';

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

// =============================================================================
// screenToWorld under a perspective projection
// =============================================================================

/** Right-handed perspective, matching the engine's `perspective()` in mat4. */
function perspective4(fovY: number, aspect: number, near: number, far: number): Float32Array {
    const m = new Float32Array(16);
    const f = 1 / Math.tan(fovY / 2);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
}

/** Right-handed orthographic, the symmetric [-far, far] the 2D camera builds. */
function ortho4(halfW: number, halfH: number, far: number): Float32Array {
    const m = new Float32Array(16);
    m[0] = 1 / halfW;
    m[5] = 1 / halfH;
    m[10] = -1 / far;
    m[15] = 1;
    return m;
}

describe('screenToWorld across projections', () => {
    // The claim every 2D caller depends on: intersecting the ray costs nothing
    // under an orthographic camera, because x/y do not vary along it.
    it('is unchanged orthographically, whatever plane is asked for', () => {
        const vp = ortho4(160, 120, 1000);
        const inv = invertMatrix4(vp)!;
        const atZero = screenToWorld(480, 180, inv, 0, 0, 640, 480);
        const atFar = screenToWorld(480, 180, inv, 0, 0, 640, 480, -300);

        expect(atZero.x).toBeCloseTo(80, 5);
        expect(atZero.y).toBeCloseTo(-30, 5);
        expect(atFar.x).toBeCloseTo(atZero.x, 5);
        expect(atFar.y).toBeCloseTo(atZero.y, 5);
    });

    // And the claim that makes it necessary: under perspective the same screen
    // point names different world points depending on the depth asked for, so a
    // single answer would have been wrong for every plane but one.
    it('follows the ray under perspective, so the plane decides the answer', () => {
        // Camera at the origin looking down -z; the plane sits at z = -d.
        const vp = perspective4(Math.PI / 2, 1, 0.1, 1000);
        const inv = invertMatrix4(vp)!;

        // Half a viewport to the right ⇒ the ray leaves at 45° with fov 90°,
        // so it crosses z = -d at x = d exactly.
        const near = screenToWorld(640, 240, inv, 0, 0, 640, 480, -10);
        const far = screenToWorld(640, 240, inv, 0, 0, 640, 480, -100);

        expect(near.x).toBeCloseTo(10, 3);
        expect(far.x).toBeCloseTo(100, 3);
        expect(near.y).toBeCloseTo(0, 3);
    });

    it('does not answer with the near plane when a depth is given', () => {
        const vp = perspective4(Math.PI / 2, 1, 0.1, 1000);
        const inv = invertMatrix4(vp)!;
        // The pre-ray implementation ignored ndcZ, which under perspective is the
        // near plane's answer — two orders of magnitude off at this depth.
        const onPlane = screenToWorld(640, 240, inv, 0, 0, 640, 480, -100);
        expect(Math.abs(onPlane.x)).toBeGreaterThan(50);
    });
});

describe('screenToWorld picking planes', () => {
    // What the editor relies on when it tests each candidate on its own plane:
    // under an orthographic view that costs an unproject and changes no answer,
    // so 2D picking cannot regress.
    it('gives one answer per screen point orthographically, at any entity depth', () => {
        const vp = ortho4(160, 120, 1000);
        const inv = invertMatrix4(vp)!;
        const depths = [0, -5, 1, -400, 900];
        const answers = depths.map((z) => screenToWorld(500, 200, inv, 0, 0, 640, 480, z));
        for (const a of answers) {
            expect(a.x).toBeCloseTo(answers[0].x, 6);
            expect(a.y).toBeCloseTo(answers[0].y, 6);
        }
    });

    // And why it is needed: perspective spreads those same depths apart, so a
    // sprite off the 2D plane would be unclickable where it is drawn.
    it('spreads them apart under perspective', () => {
        const vp = perspective4(Math.PI / 2, 4 / 3, 0.1, 1000);
        const inv = invertMatrix4(vp)!;
        const near = screenToWorld(500, 200, inv, 0, 0, 640, 480, -10);
        const far = screenToWorld(500, 200, inv, 0, 0, 640, 480, -400);
        expect(Math.abs(far.x - near.x)).toBeGreaterThan(1);
    });
});

describe('worldToScreen carries the same third dimension', () => {
    // The unproject took a plane; the project has to take the point's depth, or
    // an overlay drawn ON an entity (outline, gizmo, screen rect) lands on the
    // entity's shadow at z = 0 instead of on the entity.
    it('is unchanged orthographically, whatever depth the point is at', () => {
        const vp = ortho4(160, 120, 1000);
        const flat = worldToScreen(80, -30, vp, 0, 0, 640, 480);
        const deep = worldToScreen(80, -30, vp, 0, 0, 640, 480, -400);
        expect(deep[0]).toBeCloseTo(flat[0], 6);
        expect(deep[1]).toBeCloseTo(flat[1], 6);
    });

    it('projects nearer content further from the centre under perspective', () => {
        const vp = perspective4(Math.PI / 2, 1, 0.1, 1000);
        const near = worldToScreen(50, 0, vp, 0, 0, 640, 480, -100);
        const far = worldToScreen(50, 0, vp, 0, 0, 640, 480, -400);
        const centre = 320;
        expect(Math.abs(near[0] - centre)).toBeGreaterThan(Math.abs(far[0] - centre) * 2);
    });

    // The round trip is the whole contract: project a point at its depth, ask the
    // ray for that same plane, and get the point back. Dropping wz breaks this by
    // a factor that grows with depth — which is exactly how a selection outline
    // ends up the wrong size around a sprite it is supposed to trace.
    it('round-trips with screenToWorld on the point own plane, under perspective', () => {
        const vp = perspective4(Math.PI / 2, 4 / 3, 0.1, 1000);
        const inv = invertMatrix4(vp)!;
        // In front of the camera (which sits at the origin looking down -z); z = 0
        // is the eye itself, where a projection divides by zero for anyone.
        for (const z of [-1, -100, -400, -900]) {
            const [sx, sy] = worldToScreen(37, -21, vp, 0, 0, 640, 480, z);
            const back = screenToWorld(sx, sy, inv, 0, 0, 640, 480, z);
            expect(back.x).toBeCloseTo(37, 3);
            expect(back.y).toBeCloseTo(-21, 3);
        }
    });
});

/**
 * The property a game reads a click through, spelled out.
 *
 * A 2D camera fits by HEIGHT: orthoSize is the half-height, and the half-WIDTH
 * follows from the viewport's aspect. So the visible world is `centre ± orthoSize`
 * vertically but `centre ± orthoSize * aspect` horizontally, and only at the
 * design aspect do those coincide with the design box.
 *
 * A game that assumes the design box instead — `worldX = px * (designW / rectW)`
 * — is exact at the centre and wrong by more the further out the click is. On a
 * chessboard in a maximised browser window that is a whole file: click the a-file,
 * select the b-file. Hence CameraView.screenToWorld rather than arithmetic.
 */
describe('an orthographic 2D camera fits by height', () => {
    const ORTHO = 360, CX = 640, CY = 360;
    // What the camera builds: translate to the centre, then the ortho box.
    const camera = (vpW: number, vpH: number) => {
        const halfW = ORTHO * (vpW / vpH);
        const vp = ortho4(halfW, ORTHO, 1000);
        // Fold the centre in: world → view is a translation by -centre.
        const m = new Float32Array(vp);
        m[12] = -CX / halfW;
        m[13] = -CY / ORTHO;
        return { vp: m, inv: invertMatrix4(m)!, halfW };
    };

    it('shows centre ± orthoSize*aspect across, whatever the viewport shape', () => {
        for (const [w, h] of [[1280, 720], [1600, 800], [1920, 950]]) {
            const { inv, halfW } = camera(w, h);
            const left = screenToWorld(0, h / 2, inv, 0, 0, w, h);
            const right = screenToWorld(w, h / 2, inv, 0, 0, w, h);
            expect(left.x).toBeCloseTo(CX - halfW, 3);
            expect(right.x).toBeCloseTo(CX + halfW, 3);
            // Vertically it is always the design height — that is what "fit by
            // height" means, and why only the horizontal answer moves.
            // screenY here is GL's (up from the BOTTOM), not the DOM's: a caller
            // holding a MouseEvent has to flip it first, and one that forgets
            // gets a board mirrored about its middle rank.
            const atBottom = screenToWorld(w / 2, 0, inv, 0, 0, w, h);
            const atTop = screenToWorld(w / 2, h, inv, 0, 0, w, h);
            expect(atBottom.y).toBeCloseTo(CY - ORTHO, 3);
            expect(atTop.y).toBeCloseTo(CY + ORTHO, 3);
        }
    });

    it('disagrees with design-box arithmetic away from the centre', () => {
        const [w, h] = [1600, 800];
        const { inv } = camera(w, h);
        const designX = (px: number) => px * (1280 / w); // what a hand-rolled game does
        // Dead centre: the two agree, which is why the bug looks intermittent.
        expect(screenToWorld(w / 2, h / 2, inv, 0, 0, w, h).x).toBeCloseTo(designX(w / 2), 3);
        // A tenth of the way in: off by more than half a 80-unit board square.
        const near = screenToWorld(w * 0.1, h / 2, inv, 0, 0, w, h).x;
        expect(Math.abs(near - designX(w * 0.1))).toBeGreaterThan(40);
    });
});

// =============================================================================
// The ray itself, and screenToWorld as its z-plane case
// =============================================================================

describe('screenRay', () => {
    // What a screen point actually names. `screenToWorld` answers for ONE plane —
    // the one 2D content sits on — and a caller that needs a different one (an
    // editor dragging along an axis) could not ask before this existed.
    it('is a unit ray leaving the near plane', () => {
        const inv = invertMatrix4(perspective4(Math.PI / 2, 1, 0.1, 1000))!;
        const ray = screenRay(320, 240, inv, 0, 0, 640, 480);
        const len = Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z);
        expect(len).toBeCloseTo(1, 6);
        // Down the centre of a camera at the origin looking along -z.
        expect(ray.dir.z).toBeCloseTo(-1, 6);
        expect(ray.origin.z).toBeCloseTo(-0.1, 3);
    });

    // The plane no z-keyed call can express: the GROUND, which is where 3D content
    // stands. A 45° ray meets y = -10 at z = -10 — that is the whole point of
    // handing the plane in rather than assuming it.
    it('meets a tilted plane where the geometry says', () => {
        const inv = invertMatrix4(perspective4(Math.PI / 2, 1, 0.1, 1000))!;
        const ray = screenRay(320, 0, inv, 0, 0, 640, 480);
        const hit = rayPlaneHit(ray, { x: 0, y: -10, z: 0 }, { x: 0, y: 1, z: 0 })!;
        expect(hit).not.toBeNull();
        expect(hit.y).toBeCloseTo(-10, 3);
        expect(hit.z).toBeCloseTo(-10, 3);
        expect(hit.x).toBeCloseTo(0, 3);
    });

    it('has no answer for a plane it runs along', () => {
        const inv = invertMatrix4(perspective4(Math.PI / 2, 1, 0.1, 1000))!;
        const ray = screenRay(320, 240, inv, 0, 0, 640, 480);
        expect(rayPlaneHit(ray, { x: 0, y: 0, z: -5 }, { x: 1, y: 0, z: 0 })).toBeNull();
    });

    // The refactor's contract: the old entry point is the new one with the plane
    // 2D content lives on, so no 2D caller can drift from the ray.
    it('is what screenToWorld intersects, for every plane and projection', () => {
        for (const vp of [ortho4(160, 120, 1000), perspective4(Math.PI / 2, 4 / 3, 0.1, 1000)]) {
            const inv = invertMatrix4(vp)!;
            for (const [sx, sy] of [[0, 0], [320, 240], [637, 11], [500, 200]]) {
                for (const planeZ of [0, -10, 37, -400]) {
                    const viaPlane = screenToWorld(sx, sy, inv, 0, 0, 640, 480, planeZ);
                    const ray = screenRay(sx, sy, inv, 0, 0, 640, 480);
                    const hit = rayPlaneHit(ray, { x: 0, y: 0, z: planeZ }, { x: 0, y: 0, z: 1 });
                    expect(hit).not.toBeNull();
                    expect(viaPlane.x).toBeCloseTo(hit!.x, 4);
                    expect(viaPlane.y).toBeCloseTo(hit!.y, 4);
                    expect(hit!.z).toBeCloseTo(planeZ, 4);
                }
            }
        }
    });
});
