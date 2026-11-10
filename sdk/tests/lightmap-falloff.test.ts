import { describe, it, expect } from 'vitest';
import { lightFalloff, type BakeLight } from '../src/lightmap/solve';

const lamp = (over: Partial<BakeLight>): BakeLight => ({ kind: 'point', color: [1, 1, 1], intensity: 1, radius: 600, ...over });

describe('a bake falls light off as the frame does', () => {
    it('ramps linearly by default, from the inner radius, by the authored power', () => {
        expect(lightFalloff(300, lamp({}))).toBeCloseTo(0.5);
        expect(lightFalloff(300, lamp({ falloff: 2 }))).toBeCloseTo(0.25);
        expect(lightFalloff(100, lamp({ innerRadius: 200 }))).toBeCloseTo(1);
        expect(lightFalloff(700, lamp({}))).toBe(0);
    });

    it('falls as 1/d² in metres for an inverse-square lamp, held at 10 cm, let go at its reach', () => {
        const l = lamp({ metre: 100 });
        expect(lightFalloff(100, l)).toBeCloseTo(1 * (1 - (100 / 600) ** 4) ** 2, 5);
        expect(lightFalloff(200, l)).toBeCloseTo(0.25 * (1 - (200 / 600) ** 4) ** 2, 5);
        expect(lightFalloff(1, l)).toBeCloseTo(100, 0); // 1 cm: held at the 10 cm floor, not 10000
        expect(lightFalloff(600, l)).toBe(0);
    });
});
