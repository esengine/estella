// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import {
    impostorDecode, impostorEncode, impostorFrameDirection, impostorPictureUp, impostorKindKey, lookRotation,
} from '../src/render/impostor';

const near = (a: number[], b: number[], eps = 1e-5): boolean => a.every((v, i) => Math.abs(v - b[i]!) < eps);
const rotate = (q: { w: number; x: number; y: number; z: number }, v: number[]): number[] => {
    const [x, y, z] = v as [number, number, number];
    const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
    return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
};

describe('the directions an impostor\'s pictures are taken from', () => {
    it('are the renderer\'s own, to the numbers its test holds it to', () => {
        // tests/renderer/test_impostor_frames.cpp prints and checks this one.
        expect(near(impostorFrameDirection(2, 5, 8), [0, 0.8, -0.6])).toBe(true);
        expect(near(impostorFrameDirection(0, 0, 8), [-1, 0, 0])).toBe(true);
        expect(near(impostorDecode(0.5, 0.5), [0, 1, 0])).toBe(true);
    });

    it('fold and unfold to themselves over the upper hemisphere', () => {
        for (let a = 0; a < 6.28; a += 0.37) {
            for (let e = 0; e < 1.5; e += 0.29) {
                const d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)] as [number, number, number];
                const [u, v] = impostorEncode(d);
                expect(near(impostorDecode(u, v), d, 1e-3)).toBe(true);
            }
        }
    });

    it('have an up across the view and toward the sky, and -z straight overhead', () => {
        const d = [0.6, 0.48, 0.64] as [number, number, number];
        const up = impostorPictureUp(d);
        expect(Math.abs(up[0] * d[0] + up[1] * d[1] + up[2] * d[2])).toBeLessThan(1e-6);
        expect(up[1]).toBeGreaterThan(0);
        expect(near(impostorPictureUp([0, 1, 0]), [0, 0, -1])).toBe(true);
    });
});

describe('a camera taking one of the pictures', () => {
    it('looks back along its direction with the picture\'s up', () => {
        for (const [i, j] of [[0, 0], [3, 4], [7, 7], [2, 5], [4, 4]]) {
            const d = impostorFrameDirection(i!, j!, 8);
            const q = lookRotation(d, impostorPictureUp(d));
            // A camera looks down its own -Z: toward the object is -d.
            expect(near(rotate(q, [0, 0, -1]), d.map((v) => -v), 1e-5)).toBe(true);
            expect(near(rotate(q, [0, 1, 0]), impostorPictureUp(d), 1e-5)).toBe(true);
        }
    });
});

describe('which impostors share pictures', () => {
    it('is everything that decides how the mesh looks, and how the atlas is cut', () => {
        const mr = { mesh: 4, material: 0, texture: 2, normalMap: 0, color: { r: 1, g: 1, b: 1, a: 1 }, lit: true } as never;
        const a = impostorKindKey(mr, { frames: 8, resolution: 1024, screenSize: 0.1, enabled: true });
        expect(impostorKindKey(mr, { frames: 8, resolution: 1024, screenSize: 0.02, enabled: true })).toBe(a);
        expect(impostorKindKey(mr, { frames: 12, resolution: 1024, screenSize: 0.1, enabled: true })).not.toBe(a);
        expect(impostorKindKey({ ...(mr as object), texture: 3 } as never, { frames: 8, resolution: 1024, screenSize: 0.1, enabled: true })).not.toBe(a);
    });
});
