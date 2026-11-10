// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { skyRadianceAt, skyPanorama, skyEnvironmentKey, skySunOf, type SkyEnvironmentInput } from '../src/postprocess/skyEnvironment';
import { projectIrradianceSH } from '../src/lightmap/environmentAtlas';
import { evalIrradianceSH } from '../src/lightmap/sh';
import { getEffectDef } from '../src/postprocess/effects';

const defaults = (over: Record<string, number> = {}) => (name: string): number =>
    over[name] ?? getEffectDef('skyAtmosphere')!.uniforms.find((u) => u.name === name)?.defaultValue ?? 0;

const sunAt = (elevationDeg: number): [number, number, number] => {
    const e = elevationDeg * Math.PI / 180;
    return [0, Math.sin(e), Math.cos(e)];
};

const clear = (elevation = 35, over: Record<string, number> = {}): SkyEnvironmentInput =>
    ({ sun: sunAt(elevation), params: defaults({ u_clouds: 0, ...over }), linear: true });

const at = (input: SkyEnvironmentInput, d: [number, number, number]): number[] => {
    const n = Math.hypot(...d);
    const out = new Float64Array(3);
    skyRadianceAt(d.map((v) => v / n), input, out);
    return [...out];
};

describe('sky environment', () => {
    it('is a blue sky by day, bluer overhead than at the horizon', () => {
        const zenith = at(clear(), [0, 1, 0]);
        const horizon = at(clear(), [-1, 0.05, 0]);
        expect(zenith[2]).toBeGreaterThan(zenith[0]!);
        expect(zenith[2]! / zenith[0]!).toBeGreaterThan(horizon[2]! / horizon[0]!);
    });

    it('is brighter toward the sun, and redder there when the sun is low', () => {
        const low = clear(4);
        const toward = at(low, [0, 0.1, 1]);
        const away = at(low, [0, 0.1, -1]);
        expect(toward[0]!).toBeGreaterThan(away[0]! * 1.5);
        expect(toward[0]! / toward[2]!).toBeGreaterThan(away[0]! / away[2]!);
    });

    it('greys and dims under an overcast', () => {
        const sky = at(clear(35), [0, 1, 0]);
        const grey = at(clear(35, { u_overcast: 1 }), [0, 1, 0]);
        const spread = (c: number[]): number => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
        expect(spread(grey)).toBeLessThan(spread(sky));
    });

    it('does not draw the sun disc: the direct light is the directional light\'s', () => {
        const input = clear(35);
        const disc = at(input, input.sun);
        const beside = at(input, [0, Math.sin(37 * Math.PI / 180), Math.cos(37 * Math.PI / 180)]);
        expect(disc[1]!).toBeLessThan(beside[1]! * 1.5);
    });

    it('lights what faces up more than what faces down, in the sky\'s colour', () => {
        const sh = projectIrradianceSH(skyPanorama(clear(35)));
        const up = evalIrradianceSH(sh, 0, 1, 0);
        const down = evalIrradianceSH(sh, 0, -1, 0);
        // Below the horizon is what the effect draws there: the horizon's haze at a quarter, the light a ground sends back.
        expect(up[1]!).toBeGreaterThan(down[1]! * 1.5);
        expect(up[2]!).toBeGreaterThan(up[0]!);
    });

    it('lights the scene with clouds over it as well', () => {
        const cloudy = projectIrradianceSH(skyPanorama({ ...clear(35), params: defaults({ u_clouds: 0.8 }) }));
        const up = evalIrradianceSH(cloudy, 0, 1, 0);
        expect(up.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
    });

    it('keeps its key while nothing visible changes, and changes it when the sun moves', () => {
        const a = clear(35);
        expect(skyEnvironmentKey(a)).toBe(skyEnvironmentKey({ ...a, sun: sunAt(35.01) }));
        expect(skyEnvironmentKey(a)).not.toBe(skyEnvironmentKey({ ...a, sun: sunAt(40) }));
        expect(skyEnvironmentKey(a)).toBe(skyEnvironmentKey({ ...a, params: defaults({ u_clouds: 0, u_cloudDriftX: 0.1 }) }));
    });

    it('follows the directional light when told to, else its own azimuth and elevation', () => {
        const light: [number, number, number] = [1, 0, 0];
        expect(skySunOf(defaults({ u_followSun: 1 }), light)).toEqual(light);
        const own = skySunOf(defaults({ u_followSun: 0, u_sunAzimuth: 0, u_sunElevation: 90 }), light);
        expect(own[1]).toBeCloseTo(1);
        expect(skySunOf(defaults({ u_followSun: 1, u_sunAzimuth: 0, u_sunElevation: 90 }), null)[1]).toBeCloseTo(1);
    });
});
