// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WAVE_SET, WAVE_SET_HEIGHT, WAVE_SET_SIZE, waveBend, waveHeight, waveSlope, waveCount, type WaveParams } from '../src/water/waves';
import { FULL_WATER, waterQualityOf } from '../src/water/waterPlugin';
import { defaultQualityProfile, resolveQualityProfile, parseQualityConfig, MOST_WATER_WAVES } from '../src/render/quality';
import { applyUnderwaterToEffects, type UnderwaterState } from '../src/postprocess/underwater';
import type { BlendedEffect } from '../src/postprocess/volumeBlending';

const params: WaveParams = { height: 1, length: 20, speed: 1, direction: 30 };

describe('the set of waves', () => {
    it('is longest first with the wind, each after it shorter, lower and at a heading of its own, and adds up to the height it says', () => {
        expect(WAVE_SET).toHaveLength(WAVE_SET_SIZE);
        expect(WAVE_SET[0]![0]).toBe(0);
        expect(WAVE_SET[0]![1]).toBe(1);
        for (let i = 1; i < WAVE_SET.length; i++) {
            expect(WAVE_SET[i]![1]).toBeLessThan(WAVE_SET[i - 1]![1]);
            expect(WAVE_SET[i]![2]).toBeLessThan(WAVE_SET[i - 1]![2]);
        }
        const headings = WAVE_SET.map((w) => w[0]).sort((a, b) => a - b);
        for (let i = 1; i < headings.length; i++) expect(headings[i]! - headings[i - 1]!).toBeGreaterThan(3);
        expect(WAVE_SET.reduce((sum, w) => sum + w[2], 0)).toBeCloseTo(WAVE_SET_HEIGHT, 2);
    });
});

describe('the wave count', () => {
    it('is the whole set when absent, and is held to the set', () => {
        expect(waveCount(params)).toBe(WAVE_SET_SIZE);
        expect(waveCount({ ...params, count: 2 })).toBe(2);
        expect(waveCount({ ...params, count: 0 })).toBe(1);
        expect(waveCount({ ...params, count: 99 })).toBe(WAVE_SET_SIZE);
    });

    it('sums fewer waves for a lower count, and one wave is the longest alone', () => {
        const x = 3.7, z = -2.1, t = 1.3;
        const all = waveHeight(params, x, z, t), two = waveHeight({ ...params, count: 2 }, x, z, t), one = waveHeight({ ...params, count: 1 }, x, z, t);
        expect(one).not.toBeCloseTo(all, 6);
        expect(two).not.toBeCloseTo(all, 6);
        expect(waveHeight({ ...params, count: WAVE_SET_SIZE }, x, z, t)).toBe(all);
        // The one wave is the set's first, at its own length and height.
        const k = 2 * Math.PI / 20, a = 30 * Math.PI / 180;
        const [bx, bz] = waveBend(x, z, 20);
        const theta = k * (Math.sin(a) * bx + Math.cos(a) * bz) - Math.sqrt(9.8 * k) * t;
        expect(one).toBeCloseTo(WAVE_SET[0]![2] * Math.exp(Math.sin(theta) - 1), 9);
    });

    it('takes the slope from the same waves the height has', () => {
        const x = 1, z = 2, t = 0.4, h = 1e-4;
        for (const count of [1, 2, 5, WAVE_SET_SIZE]) {
            const p = { ...params, count };
            const [sx, sz] = waveSlope(p, x, z, t);
            const dx = (waveHeight(p, x + h, z, t) - waveHeight(p, x - h, z, t)) / (2 * h);
            const dz = (waveHeight(p, x, z + h, t) - waveHeight(p, x, z - h, t)) / (2 * h);
            expect(sx).toBeCloseTo(dx, 4);
            expect(sz).toBeCloseTo(dz, 4);
        }
    });
});

describe('what a quality level allows water', () => {
    it('is everything with no policy, off a minigame', () => {
        expect(waterQualityOf(null, false)).toEqual(FULL_WATER);
    });

    it('is the low profile on a minigame with no policy: flat, no mirror, no web of light', () => {
        const q = waterQualityOf(null, true);
        expect(q).toEqual({ waves: 3, rippleCells: 32, displacement: false, mirror: false, caustics: false });
    });

    it('follows the profile of the level a project is at, so a project can change what a level means', () => {
        expect(waterQualityOf(defaultQualityProfile('high'), false)).toEqual({ waves: WAVE_SET_SIZE, rippleCells: 128, displacement: true, mirror: true, caustics: true });
        const own = resolveQualityProfile('low', { waterMirror: true, waterDisplacement: true, waterWaves: 4 });
        expect(waterQualityOf(own, true)).toMatchObject({ waves: 4, displacement: true, mirror: true, caustics: false });
        // A profile wins over the minigame rule: the project said what it wants.
        expect(waterQualityOf(defaultQualityProfile('high'), true).displacement).toBe(true);
    });

    it('steps down by level, never up', () => {
        const levels = (['low', 'medium', 'high'] as const).map((l) => defaultQualityProfile(l));
        for (let i = 1; i < levels.length; i++) {
            expect(levels[i]!.waterWaves).toBeGreaterThanOrEqual(levels[i - 1]!.waterWaves);
            expect(levels[i]!.waterRippleCells).toBeGreaterThanOrEqual(levels[i - 1]!.waterRippleCells);
        }
    });

    it('is read and bounded from a project\'s quality block', () => {
        const q = parseQualityConfig({ mode: 'low', profiles: { low: { waterWaves: 99, waterRippleCells: -5, waterMirror: 'yes', waterCaustics: true } } });
        const low = q.profiles!.low!;
        expect(low.waterWaves).toBe(WAVE_SET_SIZE);
        expect(MOST_WATER_WAVES).toBe(WAVE_SET_SIZE);
        expect(low.waterRippleCells).toBe(0);
        expect(low.waterMirror).toBe(false);
        expect(low.waterCaustics).toBe(true);
    });
});

describe('the underwater effect under a quality level that turns the light off', () => {
    const state = (extra: Partial<UnderwaterState> = {}): UnderwaterState => ({
        amount: 1, depth: 4, absorption: [0.4, 0.1, 0.05], density: 0.02, scatter: [0.02, 0.2, 0.3],
        plane: [0, 1, 0, 0], band: 0.4, causticStrength: 0.6, causticScale: 2, causticSpeed: 0.35, ...extra,
    });

    it('zeroes the web and the shafts, even where a scene authored them', () => {
        const authored: BlendedEffect = { enabled: true, uniforms: new Map([['u_causticStrength', 1], ['u_shaftStrength', 2]]), textures: new Map(), colors: new Map() };
        const effects = new Map<string, BlendedEffect>([['underwater', authored]]);
        applyUnderwaterToEffects(effects, state({ light: false }));
        expect(authored.uniforms.get('u_causticStrength')).toBe(0);
        expect(authored.uniforms.get('u_shaftStrength')).toBe(0);
    });

    it('leaves them alone when the light is on', () => {
        const authored: BlendedEffect = { enabled: true, uniforms: new Map([['u_causticStrength', 1], ['u_shaftStrength', 2]]), textures: new Map(), colors: new Map() };
        applyUnderwaterToEffects(new Map([['underwater', authored]]), state());
        expect(authored.uniforms.get('u_causticStrength')).toBe(1);
        expect(authored.uniforms.get('u_shaftStrength')).toBe(2);
    });
});
