// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  An eye of a headset put where the game's camera stands: the rig's position and heading, then the eye's own pose.
 */
import { describe, expect, it } from 'vitest';
import { headingOf, placeEye, sharedEyeView } from '../src/xr/xrPresentation';
import { perspective } from '../src/math/mat4';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const yaw = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const pitch = (a: number) => ({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) });
const mul = (a: typeof identity, b: typeof identity) => ({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const proj = Float32Array.from(perspective(Math.PI / 2, 1, 0.1, 100));

/** Where a world point lands in clip space through a view-projection, as NDC x, y. */
function ndc(vp: Float32Array, p: [number, number, number]): [number, number] {
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    return [x / w, y / w];
}

describe('headingOf', () => {
    it('is the yaw of a rotation, whatever it pitches', () => {
        expect(headingOf(identity)).toBeCloseTo(0);
        expect(headingOf(yaw(0.7))).toBeCloseTo(0.7);
        expect(headingOf(yaw(-2.5))).toBeCloseTo(-2.5);
        // A third-person camera looking down at its target: the player's horizon keeps level.
        expect(headingOf(mul(yaw(1.2), pitch(-0.6)))).toBeCloseTo(1.2);
    });
});

describe('placeEye', () => {
    it('puts a centred eye where the rig stands, looking where it heads', () => {
        const eye = placeEye({ position: { x: 5, y: 2, z: -3 }, heading: 0 }, { position: { x: 0, y: 0, z: 0 }, orientation: identity, projection: proj }, 1);
        expect(eye.position).toEqual({ x: 5, y: 2, z: -3 });
        // A point straight ahead (-Z) of the rig is in the middle of the picture.
        const [x, y] = ndc(eye.viewProjection, [5, 2, -13]);
        expect(x).toBeCloseTo(0);
        expect(y).toBeCloseTo(0);
    });

    it('turns the eye offset with the heading, and scales metres to world units', () => {
        // The left eye, 3.2 cm left of the head, in a world of 100 units a metre, on a rig turned a quarter left.
        const eye = placeEye({ position: { x: 0, y: 0, z: 0 }, heading: Math.PI / 2 },
            { position: { x: -0.032, y: 0, z: 0 }, orientation: identity, projection: proj }, 100);
        // Turned a quarter left, the player's left is +Z.
        expect(eye.position.x).toBeCloseTo(0);
        expect(eye.position.z).toBeCloseTo(3.2);
        // Forward is now -X: a point there is in the middle (offset by the eye's own 3.2 units, seen from 1000 away).
        const [x] = ndc(eye.viewProjection, [-1000, 0, 3.2]);
        expect(x).toBeCloseTo(0);
    });

    it('sees one point a little to each side through the two eyes, as two eyes do', () => {
        const rig = { position: { x: 0, y: 1.6, z: 0 }, heading: 0 };
        const left = placeEye(rig, { position: { x: -0.032, y: 0, z: 0 }, orientation: identity, projection: proj }, 1);
        const right = placeEye(rig, { position: { x: 0.032, y: 0, z: 0 }, orientation: identity, projection: proj }, 1);
        const point: [number, number, number] = [0, 1.6, -1];
        // The left eye sees it right of its centre, the right eye left of its centre.
        expect(ndc(left.viewProjection, point)[0]).toBeGreaterThan(0.01);
        expect(ndc(right.viewProjection, point)[0]).toBeLessThan(-0.01);
    });

    it('follows the head turning inside the rig', () => {
        const eye = placeEye({ position: { x: 0, y: 0, z: 0 }, heading: 0 },
            { position: { x: 0, y: 0, z: 0 }, orientation: yaw(Math.PI / 2), projection: proj }, 1);
        // The head turned a quarter left looks down -X.
        expect(ndc(eye.viewProjection, [-10, 0, 0])[0]).toBeCloseTo(0);
    });

    it('measures the view from the render origin when the world draws relative to one', () => {
        const rig = { position: { x: 10000, y: 0, z: 0 }, heading: 0 };
        const eye = { position: { x: 0, y: 0, z: 0 }, orientation: identity, projection: proj };
        const far = placeEye(rig, eye, 1, { x: 10000, y: 0, z: 0 });
        // The point is drawn at its place less the origin: the same picture, near the origin's precision.
        const [nx, ny] = ndc(far.renderViewProjection, [0, 0, -10]);
        const [wx, wy] = ndc(far.viewProjection, [10000, 0, -10]);
        expect(nx).toBeCloseTo(wx, 5);
        expect(ny).toBeCloseTo(wy, 5);
    });
});

/** An eye's asymmetric projection, as a headset gives it: wider on its outer side. */
function eyeProjection(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
    const l = left * near, r = right * near, b = bottom * near, t = top * near;
    const p = new Float32Array(16);
    p[0] = (2 * near) / (r - l); p[5] = (2 * near) / (t - b); p[8] = (r + l) / (r - l); p[9] = (t + b) / (t - b);
    p[10] = -(far + near) / (far - near); p[11] = -1; p[14] = (-2 * far * near) / (far - near);
    return p;
}

/** Whether a world point is inside a view-projection's clip volume. */
function inside(vp: Float32Array, p: [number, number, number]): boolean {
    const c = [0, 1, 2, 3].map((r) => vp[r]! * p[0] + vp[4 + r]! * p[1] + vp[8 + r]! * p[2] + vp[12 + r]!);
    const w = c[3]!;
    return w > 0 && Math.abs(c[0]!) <= w * 1.0001 && Math.abs(c[1]!) <= w * 1.0001 && Math.abs(c[2]!) <= w * 1.0001;
}

describe('sharedEyeView', () => {
    const rig = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    // Each eye sees further out than in (1.2 vs 0.8), as a headset's lenses do.
    const leftEye = { position: { x: -0.032, y: 0, z: 0 }, orientation: identity, projection: eyeProjection(-1.2, 0.8, -1, 1, 0.1, 100) };
    const rightEye = { position: { x: 0.032, y: 0, z: 0 }, orientation: identity, projection: eyeProjection(-0.8, 1.2, -1, 1, 0.1, 100) };

    it('sees what either eye sees at its outer edge, from the middle of the head', () => {
        const shared = sharedEyeView(rig, [leftEye, rightEye], 1)!;
        // The far left of the left eye's field and the far right of the right eye's, ten metres out.
        expect(inside(shared, [-0.032 - 1.19 * 10, 0, -10])).toBe(true);
        expect(inside(shared, [0.032 + 1.19 * 10, 0, -10])).toBe(true);
        // And not what neither does.
        expect(inside(shared, [-1.4 * 10, 0, -10])).toBe(false);
        expect(inside(shared, [0, 0, 10])).toBe(false);
    });

    it("keeps the eyes' clip planes, and is one view for one pair of eyes", () => {
        const shared = sharedEyeView(rig, [leftEye, rightEye], 1)!;
        expect(inside(shared, [0, 0, -0.11])).toBe(true);
        expect(inside(shared, [0, 0, -0.09])).toBe(false);
        expect(inside(shared, [0, 0, -99])).toBe(true);
        expect(inside(shared, [0, 0, -110])).toBe(false);
        expect(Array.from(sharedEyeView(rig, [leftEye, rightEye], 1)!)).toEqual(Array.from(shared));
        expect(sharedEyeView(rig, [], 1)).toBeNull();
    });
});
