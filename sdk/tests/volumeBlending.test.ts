// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
            const dist = signedDistanceBox(0, 0, 0, 0, 0, 0, 5, 5, 0);
            expect(dist).toBeLessThan(0);
        });

        it('returns 0 when point is on box edge', () => {
            const dist = signedDistanceBox(5, 0, 0, 0, 0, 0, 5, 5, 0);
            expect(dist).toBeCloseTo(0, 5);
        });

        it('returns positive distance when point is outside box', () => {
            const dist = signedDistanceBox(8, 0, 0, 0, 0, 0, 5, 5, 0);
            expect(dist).toBeCloseTo(3, 5);
        });

        it('handles offset center', () => {
            const dist = signedDistanceBox(15, 10, 0, 10, 10, 0, 5, 5, 0);
            expect(dist).toBeCloseTo(0, 5);
        });

        it('handles point at corner outside', () => {
            const dist = signedDistanceBox(8, 8, 0, 0, 0, 0, 5, 5, 0);
            expect(dist).toBeCloseTo(Math.sqrt(9 + 9), 5);
        });
    });

    // A volume is a volume of world, not a column through it. The cases above are
    // these functions with a shared depth; a `0` half-depth is what keeps a flat
    // scene's box reaching through every depth, as it always did.
    describe('depth', () => {
        it('a box with a half-depth excludes what is outside it', () => {
            expect(signedDistanceBox(0, 0, 0, 0, 0, 0, 5, 5, 5)).toBeLessThan(0);
            expect(signedDistanceBox(0, 0, 9, 0, 0, 0, 5, 5, 5)).toBeCloseTo(4);
        });

        it('a box with no half-depth reaches through every depth', () => {
            expect(signedDistanceBox(0, 0, 900, 0, 0, 0, 5, 5, 0)).toBeLessThan(0);
        });

        it('a sphere is a sphere, not a cylinder', () => {
            expect(signedDistanceSphere(0, 0, 9, 0, 0, 0, 5)).toBeCloseTo(4);
            expect(signedDistanceSphere(0, 0, 3, 0, 0, 0, 5)).toBeCloseTo(-2);
        });

        it('a camera two floors up is outside a volume on this one', () => {
            const volume = {
                effects: [], isGlobal: false, shape: 'sphere' as const,
                size: { x: 50, y: 50 }, priority: 0, weight: 1, blendDistance: 0,
            };
            const here = computeVolumeFactor(volume, { x: 0, y: 0, z: 0 }, 0, 0, 0);
            const upstairs = computeVolumeFactor(volume, { x: 0, y: 0, z: 0 }, 0, 0, 400);
            expect(here).toBe(1);
            expect(upstairs).toBe(0);
        });
    });

    describe('signedDistanceSphere', () => {
        it('returns negative distance when point is inside sphere', () => {
            const dist = signedDistanceSphere(1, 0, 0, 0, 0, 0, 5);
            expect(dist).toBeCloseTo(-4, 5);
        });

        it('returns 0 when point is on sphere edge', () => {
            const dist = signedDistanceSphere(5, 0, 0, 0, 0, 0, 5);
            expect(dist).toBeCloseTo(0, 5);
        });

        it('returns positive distance when point is outside sphere', () => {
            const dist = signedDistanceSphere(8, 0, 0, 0, 0, 0, 5);
            expect(dist).toBeCloseTo(3, 5);
        });

        it('handles offset center', () => {
            const dist = signedDistanceSphere(15, 10, 0, 10, 10, 0, 5);
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

        it('honors a global volume\'s weight (not always 1)', () => {
            const volume = {
                effects: [], isGlobal: true, shape: 'box' as const,
                size: { x: 5, y: 5 }, priority: 0, weight: 0.5, blendDistance: 0,
            };
            expect(computeVolumeFactor(volume, baseTransform, 100, 100)).toBeCloseTo(0.5, 5);
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
        const volumeOf = (uniforms: Record<string, unknown>, colors?: Record<string, unknown>) => ({
            data: {
                effects: [{ type: 'heightFog', enabled: true, uniforms, ...(colors ? { colors } : {}) }],
                isGlobal: true, shape: 'box', size: { x: 5, y: 5 }, priority: 0, weight: 1, blendDistance: 0,
            } as never,
            factor: 1,
        });

        it('reads a colour written among the uniforms as the colour it is, not as NaN', () => {
            const fog = blendVolumeEffects([volumeOf({ u_density: 0.01, u_fogColor: { r: 0.5, g: 0.6, b: 0.7, a: 1 } })]).get('heightFog')!;
            expect(fog.uniforms.has('u_fogColor')).toBe(false);
            expect(fog.colors.get('u_fogColor')).toEqual({ r: 0.5, g: 0.6, b: 0.7, a: 1 });
            expect([...fog.uniforms.values()].every(Number.isFinite)).toBe(true);
        });

        it('lets the colours block win over the same colour among the uniforms', () => {
            const fog = blendVolumeEffects([volumeOf({ u_fogColor: { r: 1, g: 0, b: 0, a: 1 } }, { u_fogColor: { r: 0, g: 0, b: 1, a: 1 } })]).get('heightFog')!;
            expect(fog.colors.get('u_fogColor')).toEqual({ r: 0, g: 0, b: 1, a: 1 });
        });

        it('leaves out a uniform that is not a number', () => {
            const fog = blendVolumeEffects([volumeOf({ u_density: 'thick', u_startDistance: 2 })]).get('heightFog')!;
            expect(fog.uniforms.has('u_density')).toBe(false);
            expect(fog.uniforms.get('u_startDistance')).toBe(2);
        });

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

        it('blends a multiplicative param from its neutral (1), an intensity param from 0', () => {
            const result = blendVolumeEffects([
                {
                    data: {
                        effects: [
                            { type: 'colorGrade', enabled: true, uniforms: { u_contrast: 2 } },
                            { type: 'blur', enabled: true, uniforms: { u_intensity: 4 } },
                        ],
                        isGlobal: true, shape: 'box', size: { x: 5, y: 5 },
                        priority: 0, weight: 1, blendDistance: 0,
                    },
                    factor: 0.25, // partially active (a soft volume edge)
                },
            ]);
            // contrast neutral is 1: 1 + (2-1)*0.25 = 1.25 (NOT 2*0.25 = 0.5, which crushes to grey).
            expect(result.get('colorGrade')!.uniforms.get('u_contrast')).toBeCloseTo(1.25, 5);
            // intensity neutral is 0: 0 + (4-0)*0.25 = 1 (unchanged fade-from-off behavior).
            expect(result.get('blur')!.uniforms.get('u_intensity')).toBeCloseTo(1, 5);
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

    describe('local volume gating (per-camera integration shape)', () => {
        const localBlur = {
            effects: [{ type: 'blur', enabled: true, uniforms: { u_intensity: 5 } }],
            isGlobal: false,
            shape: 'box' as const,
            size: { x: 100, y: 100 },
            priority: 0,
            weight: 1,
            blendDistance: 0,
        };

        it('camera inside the volume applies its effect', () => {
            const factor = computeVolumeFactor(localBlur, { x: 0, y: 0 }, 0, 0);
            const blended = blendVolumeEffects([{ data: localBlur, factor }]);
            expect(blended.get('blur')?.uniforms.get('u_intensity')).toBeCloseTo(5, 5);
        });

        it('camera outside the volume applies nothing', () => {
            const factor = computeVolumeFactor(localBlur, { x: 0, y: 0 }, 500, 0);
            const active = factor > 0 ? [{ data: localBlur, factor }] : [];
            expect(blendVolumeEffects(active).size).toBe(0);
        });

        it('camera in the blend band applies a partial effect', () => {
            const feathered = { ...localBlur, blendDistance: 50 };
            const factor = computeVolumeFactor(feathered, { x: 0, y: 0 }, 125, 0);
            const blended = blendVolumeEffects([{ data: feathered, factor }]);
            expect(blended.get('blur')?.uniforms.get('u_intensity')).toBeCloseTo(2.5, 5);
        });
    });

    describe('colour params', () => {
        const volume = (colors: Record<string, { r: number; g: number; b: number; a: number }> | undefined) => ({
            effects: [{ type: 'distanceFog', enabled: true, uniforms: {}, ...(colors ? { colors } : {}) }],
            isGlobal: true, shape: 'box' as const, size: { x: 5, y: 5 }, priority: 0, weight: 1, blendDistance: 0,
        });
        const night = { r: 0.05, g: 0.07, b: 0.1, a: 1 };

        it('carries the volume colour through at full weight', () => {
            const fog = blendVolumeEffects([{ data: volume({ u_fogColor: night }), factor: 1 }]).get('distanceFog')!;
            expect(fog.colors.get('u_fogColor')).toEqual(night);
        });

        it('fades from the effect default, not from black, at partial weight', () => {
            const fog = blendVolumeEffects([{ data: volume({ u_fogColor: night }), factor: 0.5 }]).get('distanceFog')!;
            const c = fog.colors.get('u_fogColor')!;
            expect(c.r).toBeCloseTo((0.6 + 0.05) / 2, 5);
            expect(c.g).toBeCloseTo((0.68 + 0.07) / 2, 5);
            expect(c.b).toBeCloseTo((0.78 + 0.1) / 2, 5);
        });

        it('lets a later volume pull the colour toward its own by its factor', () => {
            const warm = { r: 1, g: 0.5, b: 0, a: 1 };
            const later = { ...volume({ u_fogColor: warm }), priority: 1 };
            const fog = blendVolumeEffects([
                { data: volume({ u_fogColor: night }), factor: 1 },
                { data: later, factor: 0.5 },
            ]).get('distanceFog')!;
            const c = fog.colors.get('u_fogColor')!;
            expect(c.r).toBeCloseTo((0.05 + 1) / 2, 5);
            expect(c.g).toBeCloseTo((0.07 + 0.5) / 2, 5);
        });

        it('leaves a volume that names no colour with none to apply', () => {
            const fog = blendVolumeEffects([{ data: volume(undefined), factor: 1 }]).get('distanceFog')!;
            expect(fog.colors.size).toBe(0);
        });
    });
});

describe('the effects the scene resolves for an eye that is not a camera entity', () => {
    it('are the global volume\'s anywhere, and a local volume\'s only where the eye is inside it', async () => {
        const { effectsAt } = await import('../src/postprocess/volumeSystem');
        const volume = (isGlobal: boolean, type: string) => ({
            isGlobal, priority: 0, weight: 1, blendDistance: 0, shape: 'box', size: { x: 10, y: 10, z: 10 },
            effects: [{ type, enabled: true, uniforms: {}, colors: {}, textures: {} }],
        }) as never;
        const tx = { x: 0, y: 0, z: 0 };
        const volumes = [{ data: volume(true, 'skyAtmosphere'), tx }, { data: volume(false, 'bloom'), tx: { x: 500, y: 0, z: 0 } }];
        expect([...effectsAt(volumes, 4000, 20, 4000).keys()]).toEqual(['skyAtmosphere']);
        expect([...effectsAt(volumes, 500, 0, 0).keys()].sort()).toEqual(['bloom', 'skyAtmosphere']);
    });
});
