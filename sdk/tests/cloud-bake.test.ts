// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { cloudPanoramaDir, cloudPanoramaUv } from '../src/postprocess/cloudBake';

describe('the baked cloud panorama', () => {
    it('reads a direction back from the texel that was baked for it', () => {
        for (let i = 0; i < 200; i++) {
            const az = i * 2.399;
            const el = 0.02 + (i % 37) / 37 * 1.5;
            const d: [number, number, number] = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
            const [u, v] = cloudPanoramaUv(d);
            expect(u).toBeGreaterThanOrEqual(0);
            expect(u).toBeLessThanOrEqual(1);
            const back = cloudPanoramaDir(u, v);
            for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(d[k]!, 9);
        }
    });

    it('puts the zenith in the middle and the horizon on the rim, which the corners clamp to', () => {
        expect(cloudPanoramaUv([0, 1, 0])).toEqual([0.5, 0.5]);
        const [u, v] = cloudPanoramaUv([1, 0, 0]);
        expect(u).toBeCloseTo(1, 12);
        expect(v).toBeCloseTo(0.5, 12);
        const corner = cloudPanoramaDir(1, 1);
        expect(corner[1]).toBeCloseTo(0, 12);
        expect(Math.hypot(...corner)).toBeCloseTo(1, 12);
    });
});
