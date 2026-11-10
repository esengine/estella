import { describe, it, expect } from 'vitest';
import { capturePanorama } from '../src/postprocess/probeCapture';
import { projectIrradianceSH } from '../src/lightmap/environmentAtlas';
import { evalIrradianceSH } from '../src/lightmap/sh';

/** Six faces of `n` texels, +X -X +Y -Y +Z -Z side by side, each one RGBM colour (alpha 0 = nothing drawn). */
function faces(n: number, colours: Array<[number, number, number] | null>): Uint8Array {
    const out = new Uint8Array(n * 6 * n * 4);
    for (let row = 0; row < n; row++) {
        for (let f = 0; f < 6; f++) {
            const c = colours[f];
            for (let x = 0; x < n; x++) {
                const i = (row * n * 6 + f * n + x) * 4;
                if (!c) continue;
                // RGBM over 8 with m = 1/8: the colour itself, in range.
                out.set([c[0] * 255, c[1] * 255, c[2] * 255, 32], i);
            }
        }
    }
    return out;
}

describe('a probe capture read back', () => {
    it('puts each face where it looks: red at +X lights what faces +X red', () => {
        const pano = capturePanorama(faces(8, [[1, 0, 0], [0, 0, 1], [0, 1, 0], null, null, null]), 8, null);
        const sh = projectIrradianceSH(pano);
        const right = evalIrradianceSH(sh, 1, 0, 0), left = evalIrradianceSH(sh, -1, 0, 0), up = evalIrradianceSH(sh, 0, 1, 0);
        expect(right[0]).toBeGreaterThan(right[2]! * 3);
        expect(left[2]).toBeGreaterThan(left[0]! * 3);
        expect(up[1]).toBeGreaterThan(Math.max(up[0]!, up[2]!) * 2);
    });

    it('fills what nothing was drawn on from the sky', () => {
        const sky = { width: 4, height: 2, rgb: new Float32Array(4 * 2 * 3).fill(0.5) };
        const pano = capturePanorama(faces(8, [null, null, null, null, null, null]), 8, sky);
        expect(Math.min(...pano.rgb)).toBeCloseTo(0.5);
        const dark = capturePanorama(faces(8, [null, null, null, null, null, null]), 8, null);
        expect(Math.max(...dark.rgb)).toBe(0);
    });
});
