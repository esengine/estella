// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The projector's cut: what a decal's geometry IS.
 *
 * None of this is a thing a screenshot can answer — a decal that leaks one
 * triangle past the box, or keeps a wall it is edge-on to, looks like a decal
 * until you walk around it. Pure TS.
 */
import { describe, it, expect } from 'vitest';
import {
    clipToProjector, projectorUV, DEFAULT_FACING_COSINE, CLIP_EPSILON,
    type ClipTriangle, type ClipVertex,
} from '../src/decal/clip';

/** A vertex facing the projector (normal along +Z, which opposes its -Z throw). */
const v = (x: number, y: number, z = 0, n: [number, number, number] = [0, 0, 1]): ClipVertex =>
    ({ p: [x, y, z], n });

const area = (t: ClipTriangle): number => {
    const [a, b, c] = t;
    const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1];
    const wx = c.p[0] - a.p[0], wy = c.p[1] - a.p[1];
    return Math.abs(ux * wy - uy * wx) / 2;
};
const totalArea = (ts: ClipTriangle[]): number => ts.reduce((s, t) => s + area(t), 0);

describe('decal projector clip', () => {
    it('keeps a triangle wholly inside the box, unchanged', () => {
        const tri: ClipTriangle = [v(-0.2, -0.2), v(0.2, -0.2), v(0, 0.2)];
        const out = clipToProjector([tri]);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual(tri);
    });

    it('drops a triangle wholly outside it', () => {
        const tri: ClipTriangle = [v(2, 2), v(3, 2), v(2.5, 3)];
        expect(clipToProjector([tri])).toHaveLength(0);
    });

    it('cuts one that straddles the edge, keeping only what is inside', () => {
        // Half in, half out across x = 0.5.
        const tri: ClipTriangle = [v(0, -0.4), v(1.0, -0.4), v(0, 0.4)];
        const out = clipToProjector([tri]);
        expect(out.length).toBeGreaterThan(0);
        const bound = 0.5 + CLIP_EPSILON;
        for (const t of out) {
            for (const c of t) {
                expect(c.p[0]).toBeLessThanOrEqual(bound);
                expect(c.p[0]).toBeGreaterThanOrEqual(-bound);
                expect(c.p[1]).toBeLessThanOrEqual(bound);
                expect(c.p[2]).toBeLessThanOrEqual(bound);
            }
        }
        // And it kept the part that was inside rather than collapsing: the area
        // is what the original had within the box, not zero and not all of it.
        expect(totalArea(out)).toBeGreaterThan(0.05);
        expect(totalArea(out)).toBeLessThan(totalArea([tri]));
    });

    it('cuts a wall spanning the whole box down to exactly the box', () => {
        // Two triangles of a quad from -4 to 4, which the box crops to 1x1.
        const quad: ClipTriangle[] = [
            [v(-4, -4), v(4, -4), v(4, 4)],
            [v(-4, -4), v(4, 4), v(-4, 4)],
        ];
        expect(totalArea(clipToProjector(quad))).toBeCloseTo(1.0, 4);
    });

    it('refuses a surface too edge-on to print on', () => {
        // Facing +X: the projector throws along -Z and would smear it forever.
        const edgeOn: ClipTriangle = [
            v(-0.2, -0.2, 0, [1, 0, 0]), v(0.2, -0.2, 0, [1, 0, 0]), v(0, 0.2, 0, [1, 0, 0]),
        ];
        expect(clipToProjector([edgeOn])).toHaveLength(0);
        // And the threshold is a knob, not a law: asked to accept anything, it does.
        expect(clipToProjector([edgeOn], -1)).toHaveLength(1);
    });

    it('refuses the BACK of a surface it would otherwise print on', () => {
        const away: ClipTriangle = [
            v(-0.2, -0.2, 0, [0, 0, -1]), v(0.2, -0.2, 0, [0, 0, -1]), v(0, 0.2, 0, [0, 0, -1]),
        ];
        expect(clipToProjector([away])).toHaveLength(0);
    });

    it('carries the receiver normal through the cut, not the box one', () => {
        const tilted: [number, number, number] = [0, 0.6, 0.8];
        const tri: ClipTriangle = [v(-4, -4, 0, tilted), v(4, -4, 0, tilted), v(4, 4, 0, tilted)];
        for (const t of clipToProjector([tri])) {
            for (const c of t) {
                expect(c.n[1]).toBeCloseTo(0.6, 5);
                expect(c.n[2]).toBeCloseTo(0.8, 5);
            }
        }
    });

    it('reads the box corners as the texture corners', () => {
        expect(projectorUV(v(-0.5, -0.5))).toEqual([0, 0]);
        expect(projectorUV(v(0.5, 0.5))).toEqual([1, 1]);
        expect(projectorUV(v(0, 0))).toEqual([0.5, 0.5]);
    });

    it('clips depth too — a surface behind the box does not take it', () => {
        const behind: ClipTriangle = [v(-0.2, -0.2, 2), v(0.2, -0.2, 2), v(0, 0.2, 2)];
        expect(clipToProjector([behind])).toHaveLength(0);
    });

    it('keeps a receiver lying FLUSH with a face of the box', () => {
        // The usual placement — the box ends at the surface — puts every vertex
        // on a face, where the last bit of the transform decides it. Nudged to
        // both sides of the plane by less than the epsilon, it is still whole.
        const eps = 6e-16;
        const flush: ClipTriangle[] = [
            [v(-2.5, 2.5, -0.5 - eps), v(2.5, 2.5, -0.5 + eps), v(2.5, -2.5, -0.5 - eps)],
            [v(-2.5, 2.5, -0.5 + eps), v(2.5, -2.5, -0.5 - eps), v(-2.5, -2.5, -0.5 - eps)],
        ];
        expect(totalArea(clipToProjector(flush))).toBeCloseTo(1.0, 4);
    });

    it('emits no zero-area triangle, however the cut falls', () => {
        // A receiver lying flat ON a box face is every vertex on a clip plane at
        // once — the case that makes a naive clipper duplicate them.
        const flush: ClipTriangle[] = [
            [v(-2.5, 2.5, -0.5), v(2.5, 2.5, -0.5), v(2.5, -2.5, -0.5)],
            [v(-2.5, 2.5, -0.5), v(2.5, -2.5, -0.5), v(-2.5, -2.5, -0.5)],
        ];
        const out = clipToProjector(flush);
        for (const t of out) expect(area(t)).toBeGreaterThan(1e-9);
        // And it still covers the whole box, which is what says the cut was not
        // simply thrown away along with the slivers.
        expect(totalArea(out)).toBeCloseTo(1.0, 4);
    });

    it('states its own facing default rather than leaving it to a caller', () => {
        expect(DEFAULT_FACING_COSINE).toBeGreaterThan(0);
        expect(DEFAULT_FACING_COSINE).toBeLessThan(1);
    });
});
