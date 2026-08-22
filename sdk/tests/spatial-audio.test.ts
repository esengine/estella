// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    AttenuationModel,
    calculateAttenuation,
    calculatePanning,
    spatialDistance,
    type SpatialAudioConfig,
} from '../src/audio/SpatialAudio';
import { q } from '../src/math/quat';
import type { Vec3 } from '../src/types';

const at = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
/** World +X — the right of a listener that has not turned. */
const RIGHT: Vec3 = { x: 1, y: 0, z: 0 };

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

    // The scene has three dimensions whether or not its art does. A distance that
    // drops z puts a source across the room in the listener's ear — and every 3D
    // scene the engine now renders, simulates and lights is such a room.
    describe('spatialDistance', () => {
        it('measures depth like it measures width', () => {
            expect(spatialDistance(at(0, 0, 300), at(0, 0, 0))).toBeCloseTo(300);
            expect(spatialDistance(at(300, 0, 0), at(0, 0, 0))).toBeCloseTo(300);
        });

        it('is the diagonal of all three, not of two', () => {
            expect(spatialDistance(at(3, 4, 12), at(0, 0, 0))).toBeCloseTo(13);
        });

        it('is zero at the listener', () => {
            expect(spatialDistance(at(7, -2, 5), at(7, -2, 5))).toBe(0);
        });
    });

    describe('calculatePanning', () => {
        it('should return 0 when source is directly above/below listener', () => {
            expect(calculatePanning(at(100, 200), at(100, 0), RIGHT, 1000)).toBeCloseTo(0);
        });

        it('should return positive for source to the right', () => {
            const pan = calculatePanning(at(600, 0), at(100, 0), RIGHT, 1000);
            expect(pan).toBeGreaterThan(0);
            expect(pan).toBeCloseTo(0.5);
        });

        it('should return negative for source to the left', () => {
            const pan = calculatePanning(at(-400, 0), at(100, 0), RIGHT, 1000);
            expect(pan).toBeLessThan(0);
            expect(pan).toBeCloseTo(-0.5);
        });

        it('should clamp to -1', () => {
            expect(calculatePanning(at(-2000, 0), at(0, 0), RIGHT, 1000)).toBe(-1);
        });

        it('should clamp to 1', () => {
            expect(calculatePanning(at(2000, 0), at(0, 0), RIGHT, 1000)).toBe(1);
        });

        it('should return 0 when source equals listener', () => {
            expect(calculatePanning(at(100, 100), at(100, 100), RIGHT, 1000)).toBe(0);
        });

        // A listener that has turned hears the room turn with it. Straight ahead in
        // a 3D scene is −Z, and a quarter turn about Y puts what was on the right
        // in front — where a stereo image has nothing to say.
        it('pans against the listener own right, not world +X', () => {
            const turned = q.rotate(q.axis('y', Math.PI / 2), { x: 1, y: 0, z: 0 });
            // Source out on world +X: dead ahead once the listener faces it.
            expect(calculatePanning(at(500, 0, 0), at(0, 0, 0), turned, 1000)).toBeCloseTo(0);
            // And what is now to that listener's right is out on −Z.
            expect(calculatePanning(at(0, 0, -500), at(0, 0, 0), turned, 1000)).toBeCloseTo(0.5);
        });

        // The 2D case is the same formula with an unturned listener, which is what
        // makes this one function rather than a 2D one and a 3D one.
        it('is unchanged for a flat scene with an unturned listener', () => {
            expect(calculatePanning(at(600, 40), at(100, -70), RIGHT, 1000)).toBeCloseTo(0.5);
        });
    });
});
