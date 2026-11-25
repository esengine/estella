// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { skyRadianceAt } from '../src/postprocess/skyEnvironment';

// A clear sky, the effect's own defaults where they shape the dome.
const params = (name: string): number =>
    ({ u_intensity: 1, u_haze: 1, u_altitude: 0.1 } as Record<string, number>)[name] ?? 0;

/** The sky's light on a surface facing `normal`, cosine-weighted over the dome above the horizon (the ground sends nothing here). */
function irradiance(elevationDeg: number, normal: [number, number, number]): [number, number, number] {
    const el = (elevationDeg * Math.PI) / 180;
    const sun = [0, Math.sin(el), -Math.cos(el)];
    const out = new Float64Array(3), sum: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 24; i++) {
        const up = ((i + 0.5) / 24) * (Math.PI / 2);
        for (let j = 0; j < 48; j++) {
            const az = ((j + 0.5) / 48) * Math.PI * 2;
            const d = [Math.cos(up) * Math.sin(az), Math.sin(up), Math.cos(up) * Math.cos(az)];
            const facing = d[0]! * normal[0] + d[1]! * normal[1] + d[2]! * normal[2];
            if (facing <= 0) continue;
            skyRadianceAt(d, { sun, params }, out);
            for (let c = 0; c < 3; c++) sum[c] += out[c]! * facing * Math.cos(up);
        }
    }
    return sum;
}

describe('the sky at dusk lights the scene', () => {
    // The sun 4 degrees up. Its light reaches the dome through a long, low path, and the ozone on it takes out orange and green:
    // what the dome gives the ground is blue, as a twilight's shade is. Without ozone the same dome lit level ground green and a
    // wall turned from the sun olive (green the strongest of the three), which is what made a dusk scene look wrong.
    it('lights level ground blue', () => {
        const [r, g, b] = irradiance(4, [0, 1, 0]);
        expect(b).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(r * 0.9);
    });

    it('lights a wall turned from the sun without an olive cast', () => {
        const [r, g, b] = irradiance(4, [0, 0, 1]);
        expect(g).toBeLessThan(Math.max(r, b) * 1.02);
    });

    it('keeps a noon sky blue overhead', () => {
        const [r, g, b] = irradiance(60, [0, 1, 0]);
        expect(b).toBeGreaterThan(g);
        expect(g).toBeGreaterThan(r);
    });
});
