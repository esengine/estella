import { describe, it, expect } from 'vitest';
import {
    signedDistanceBox,
    signedDistanceSphere,
    computeVolumeFactor,
    blendVolumeEffects,
} from '../src/postprocess/volumeBlending';

describe('volumeBlending', () => {
    describe('signedDistanceBox', () => {
        it('returns negative distance when point is inside box', () => {
            const dist = signedDistanceBox(0, 0, 0, 0, 5, 5);
            expect(dist).toBeLessThan(0);
        });

        it('returns 0 when point is on box edge', () => {
            const dist = signedDistanceBox(5, 0, 0, 0, 5, 5);
            expect(dist).toBeCloseTo(0, 5);
        });

        it('returns positive distance when point is outside box', () => {
            const dist = signedDistanceBox(8, 0, 0, 0, 5, 5);
            expect(dist).toBeCloseTo(3, 5);
        });

        it('handles offset center', () => {
            const dist = signedDistanceBox(15, 10, 10, 10, 5, 5);
            expect(dist).toBeCloseTo(0, 5);
        });

        it('handles point at corner outside', () => {
            const dist = signedDistanceBox(8, 8, 0, 0, 5, 5);
            expect(dist).toBeCloseTo(Math.sqrt(9 + 9), 5);
        });
    });

    describe('signedDistanceSphere', () => {
        it('returns negative distance when point is inside sphere', () => {
            const dist = signedDistanceSphere(1, 0, 0, 0, 5);
            expect(dist).toBeCloseTo(-4, 5);
        });

        it('returns 0 when point is on sphere edge', () => {
            const dist = signedDistanceSphere(5, 0, 0, 0, 5);
            expect(dist).toBeCloseTo(0, 5);
        });

        it('returns positive distance when point is outside sphere', () => {
            const dist = signedDistanceSphere(8, 0, 0, 0, 5);
            expect(dist).toBeCloseTo(3, 5);
        });

        it('handles offset center', () => {
            const dist = signedDistanceSphere(15, 10, 10, 10, 5);
            expect(dist).toBeCloseTo(0, 5);
        });
    });

    describe('computeVolumeFactor', () => {
        const baseTransform = { x: 0, y: 0 };

        it('returns 1 for global volumes', () => {
            const volume = {
                effects: [],
                isGlobal: true,
                shape: 'box' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 1,
                blendDistance: 0,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 100, 100);
            expect(factor).toBe(1);
        });

        it('returns weight when point is inside box volume', () => {
            const volume = {
                effects: [],
                isGlobal: false,
                shape: 'box' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 0.8,
                blendDistance: 0,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 0, 0);
            expect(factor).toBeCloseTo(0.8, 5);
        });

        it('returns 0 when point is outside box volume with no blend distance', () => {
            const volume = {
                effects: [],
                isGlobal: false,
                shape: 'box' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 1,
                blendDistance: 0,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 10, 0);
            expect(factor).toBe(0);
        });

        it('returns interpolated factor within blend distance', () => {
            const volume = {
                effects: [],
                isGlobal: false,
                shape: 'box' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 1,
                blendDistance: 4,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 7, 0);
            expect(factor).toBeCloseTo(0.5, 5);
        });

        it('returns 0 when point is beyond blend distance', () => {
            const volume = {
                effects: [],
                isGlobal: false,
                shape: 'box' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 1,
                blendDistance: 2,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 10, 0);
            expect(factor).toBe(0);
        });

        it('works with sphere shape', () => {
            const volume = {
                effects: [],
                isGlobal: false,
                shape: 'sphere' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 1,
                blendDistance: 0,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 3, 0);
            expect(factor).toBeCloseTo(1, 5);
        });

        it('returns 0 for sphere when outside', () => {
            const volume = {
                effects: [],
                isGlobal: false,
                shape: 'sphere' as const,
                size: { x: 5, y: 5 },
                priority: 0,
                weight: 1,
                blendDistance: 0,
            };
            const factor = computeVolumeFactor(volume, baseTransform, 10, 0);
            expect(factor).toBe(0);
        });
    });

    describe('blendVolumeEffects', () => {
        it('returns empty map when no active volumes', () => {
            const result = blendVolumeEffects([]);
            expect(result.size).toBe(0);
        });

        it('returns single volume effects when only one active', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 5 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 0,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
            ]);
            expect(result.size).toBe(1);
            const blur = result.get('blur')!;
            expect(blur.enabled).toBe(true);
            expect(blur.uniforms.get('u_intensity')).toBe(5);
        });

        it('higher priority volume overrides lower priority', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 2 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 0,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 10 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 1,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
            ]);
            const blur = result.get('blur')!;
            expect(blur.uniforms.get('u_intensity')).toBe(10);
        });

        it('lerps uniforms based on factor', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 0 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 0,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 10 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 1,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 0.5,
                },
            ]);
            const blur = result.get('blur')!;
            expect(blur.uniforms.get('u_intensity')).toBeCloseTo(5, 5);
        });

        it('combines different effect types from multiple volumes', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 5 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 0,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
                {
                    data: {
                        effects: [
                            { type: 'vignette', enabled: true, uniforms: { u_intensity: 0.8 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 1,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
            ]);
            expect(result.size).toBe(2);
            expect(result.has('blur')).toBe(true);
            expect(result.has('vignette')).toBe(true);
        });

        it('disabled effects are not included', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: false, uniforms: { u_intensity: 5 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 0,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 1,
                },
            ]);
            expect(result.size).toBe(0);
        });

        it('zero factor volume does not contribute', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 10 } },
                        ],
                        isGlobal: true,
                        shape: 'box',
                        size: { x: 5, y: 5 },
                        priority: 0,
                        weight: 1,
                        blendDistance: 0,
                    },
                    factor: 0,
                },
            ]);
            expect(result.size).toBe(0);
        });
    });
});
