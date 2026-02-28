import { describe, it, expect } from 'vitest';
import {
    AttenuationModel,
    calculateAttenuation,
    calculatePanning,
    type SpatialAudioConfig,
} from '../src/audio/SpatialAudio';

describe('SpatialAudio', () => {
    describe('calculateAttenuation', () => {
        const defaultConfig: SpatialAudioConfig = {
            model: AttenuationModel.Inverse,
            refDistance: 100,
            maxDistance: 1000,
            rolloff: 1.0,
        };

        describe('Linear model', () => {
            const config: SpatialAudioConfig = {
                ...defaultConfig,
                model: AttenuationModel.Linear,
            };

            it('should return 1 at ref distance', () => {
                expect(calculateAttenuation(100, config)).toBeCloseTo(1.0);
            });

            it('should return 0 at max distance', () => {
                expect(calculateAttenuation(1000, config)).toBeCloseTo(0.0);
            });

            it('should return 0.5 at midpoint', () => {
                const mid = (100 + 1000) / 2;
                expect(calculateAttenuation(mid, config)).toBeCloseTo(0.5);
            });

            it('should clamp below ref distance', () => {
                expect(calculateAttenuation(50, config)).toBeCloseTo(1.0);
            });

            it('should clamp above max distance', () => {
                expect(calculateAttenuation(2000, config)).toBeCloseTo(0.0);
            });

            it('should return 1 when refDistance equals maxDistance', () => {
                const edgeConfig: SpatialAudioConfig = {
                    ...config,
                    refDistance: 100,
                    maxDistance: 100,
                };
                expect(calculateAttenuation(100, edgeConfig)).toBe(1.0);
                expect(calculateAttenuation(200, edgeConfig)).toBe(1.0);
            });
        });

        describe('Inverse model', () => {
            it('should return 1 at ref distance', () => {
                expect(calculateAttenuation(100, defaultConfig)).toBeCloseTo(1.0);
            });

            it('should return ref/distance for distances > ref', () => {
                expect(calculateAttenuation(200, defaultConfig)).toBeCloseTo(0.5);
                expect(calculateAttenuation(400, defaultConfig)).toBeCloseTo(0.25);
            });

            it('should clamp below ref distance to 1', () => {
                expect(calculateAttenuation(50, defaultConfig)).toBeCloseTo(1.0);
            });
        });

        describe('Exponential model', () => {
            const config: SpatialAudioConfig = {
                ...defaultConfig,
                model: AttenuationModel.Exponential,
                rolloff: 1.0,
            };

            it('should return 1 at ref distance', () => {
                expect(calculateAttenuation(100, config)).toBeCloseTo(1.0);
            });

            it('should follow power curve', () => {
                expect(calculateAttenuation(200, config)).toBeCloseTo(0.5);
            });

            it('should clamp below ref distance to 1', () => {
                expect(calculateAttenuation(50, config)).toBeCloseTo(1.0);
            });
        });

        it('should handle zero distance safely', () => {
            expect(calculateAttenuation(0, defaultConfig)).toBeCloseTo(1.0);
        });

        it('should use default config when not provided', () => {
            expect(calculateAttenuation(100)).toBeCloseTo(1.0);
        });

        it('should clamp exponential result to [0, 1] with negative rolloff', () => {
            const config: SpatialAudioConfig = {
                model: AttenuationModel.Exponential,
                refDistance: 100,
                maxDistance: 1000,
                rolloff: -1.0,
            };
            const result = calculateAttenuation(200, config);
            expect(result).toBeLessThanOrEqual(1.0);
            expect(result).toBeGreaterThanOrEqual(0.0);
        });
    });

    describe('calculatePanning', () => {
        it('should return 0 when source is directly above/below listener', () => {
            expect(calculatePanning(100, 200, 100, 0, 1000)).toBeCloseTo(0);
        });

        it('should return positive for source to the right', () => {
            const pan = calculatePanning(600, 0, 100, 0, 1000);
            expect(pan).toBeGreaterThan(0);
            expect(pan).toBeCloseTo(0.5);
        });

        it('should return negative for source to the left', () => {
            const pan = calculatePanning(-400, 0, 100, 0, 1000);
            expect(pan).toBeLessThan(0);
            expect(pan).toBeCloseTo(-0.5);
        });

        it('should clamp to -1', () => {
            expect(calculatePanning(-2000, 0, 0, 0, 1000)).toBe(-1);
        });

        it('should clamp to 1', () => {
            expect(calculatePanning(2000, 0, 0, 0, 1000)).toBe(1);
        });

        it('should return 0 when source equals listener', () => {
            expect(calculatePanning(100, 100, 100, 100, 1000)).toBe(0);
        });
    });
});
