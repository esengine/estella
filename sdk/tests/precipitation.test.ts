// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_PRECIPITATION_RING, PRECIPITATION_GLSL, PRECIPITATION_MOST_DENSITY, currentPrecipitation, precipitationDensity, precipitationRing,
    setPrecipitation,
} from '../src/render/precipitation';
import { RAIN_DROPS_SHADER } from '../src/postprocess/rainDrops';
import { WATER_SHADER_TEMPLATE } from '../src/water/waterShader';

describe('the precipitation lattice', () => {
    it('lets more of its falls fall as the rain is heavier, never all of them', () => {
        expect(precipitationDensity(0)).toBe(0);
        expect(precipitationDensity(-1)).toBe(0);
        expect(precipitationDensity(1)).toBeCloseTo(0.6, 9);
        expect(precipitationDensity(2)).toBe(PRECIPITATION_MOST_DENSITY);
        expect(precipitationDensity(1.2)).toBeGreaterThan(precipitationDensity(1));
    });

    it('is one piece of shader code, read by the splashes and the water alike, so a splash and its ring are one landing', () => {
        expect(PRECIPITATION_GLSL).toContain('precipRings');
        expect(PRECIPITATION_GLSL).not.toContain('${');
        expect(RAIN_DROPS_SHADER).toContain(PRECIPITATION_GLSL);
        expect(WATER_SHADER_TEMPLATE.source).toContain(PRECIPITATION_GLSL);
    });

    it('rings as the rain effect says, a raindrop\'s ring for any value it leaves unset', () => {
        const values = new Map<string, number>([['u_ringSpeed', 0.4], ['u_ringStrength', 2]]);
        expect(precipitationRing((name) => values.get(name))).toEqual([0.4, DEFAULT_PRECIPITATION_RING[1], DEFAULT_PRECIPITATION_RING[2], 2]);
        expect(precipitationRing(() => undefined)).toEqual(DEFAULT_PRECIPITATION_RING);
        expect(PRECIPITATION_GLSL).toContain('vec4 ring');
    });

    it('holds the rain the scene resolved this frame until the next one replaces it', () => {
        setPrecipitation({ intensity: 1.5, velocity: [0, -9, 0], ring: DEFAULT_PRECIPITATION_RING });
        expect(currentPrecipitation()?.intensity).toBe(1.5);
        setPrecipitation(null);
        expect(currentPrecipitation()).toBeNull();
    });
});
