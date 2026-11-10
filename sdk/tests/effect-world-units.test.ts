// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Post-process effects follow the project's units: a length a volume leaves unset takes its default in the
 *        project's units, so a metre project's rain shelters within 30 m and its SSR reaches 4 m, not 3000 and 400.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { blendVolumeEffects } from '../src/postprocess/volumeBlending';
import { getEffectDef, uniformInUnits } from '../src/postprocess/effects';
import { setWorldUnitsPerMeter, REFERENCE_UNITS_PER_METER } from '../src/ecs/worldUnits';

afterEach(() => setWorldUnitsPerMeter(REFERENCE_UNITS_PER_METER));

const uniform = (type: string, name: string) => getEffectDef(type)!.uniforms.find((u) => u.name === name)!;
const volume = (type: string, uniforms: Record<string, number>) => ({
    data: { effects: [{ type, enabled: true, uniforms }], isGlobal: true, shape: 'box', size: { x: 5, y: 5 }, priority: 0, weight: 1, blendDistance: 0 } as never,
    factor: 1,
});

describe('a world-unit effect parameter', () => {
    it('is as declared at the reference scale — the very definition', () => {
        const u = uniform('rain', 'u_shelterRange');
        expect(uniformInUnits(u)).toBe(u);
        expect(u.defaultValue).toBe(3000);
    });

    it('in a metre project: a length scaled with its range, a rate per length by the inverse', () => {
        setWorldUnitsPerMeter(1);
        const shelter = uniformInUnits(uniform('rain', 'u_shelterRange'));
        expect(shelter.defaultValue).toBeCloseTo(30);
        expect(shelter.min).toBeCloseTo(1);
        expect(shelter.max).toBeCloseTo(300);
        expect(uniformInUnits(uniform('ssr', 'u_maxDistance')).defaultValue).toBeCloseTo(4);
        expect(uniformInUnits(uniform('heightFog', 'u_density')).defaultValue).toBeCloseTo(0.15);
        expect(uniformInUnits(uniform('rain', 'u_intensity')).defaultValue).toBe(1);   // not a length
    });

    it('is filled in, in the project\'s units, where a volume leaves it unset — and a stated one is left alone', () => {
        setWorldUnitsPerMeter(1);
        const rain = blendVolumeEffects([volume('rain', { u_intensity: 0.4, u_shelterRange: 12 })]).get('rain')!;
        expect(rain.uniforms.get('u_shelterRange')).toBe(12);
        expect(rain.uniforms.get('u_puddleScale')).toBeCloseTo(3.5);
        expect(rain.uniforms.get('u_intensity')).toBeCloseTo(0.4);
        expect(rain.uniforms.has('u_wind')).toBe(false);   // not a length: the shader's own default, as before
    });

    it('is not touched at the reference scale: a centimetre project renders as it did', () => {
        const rain = blendVolumeEffects([volume('rain', { u_intensity: 0.4 })]).get('rain')!;
        expect(rain.uniforms.has('u_shelterRange')).toBe(false);
        expect([...rain.uniforms.keys()]).toEqual(['u_intensity']);
    });
});
