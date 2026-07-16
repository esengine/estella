// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { SLOPE_PRESETS, presetPointsPx } from '@/tileset/slopePresets';

describe('slope presets', () => {
    it('every preset is a valid polygon (≥3 normalized [0,1] points)', () => {
        for (const p of SLOPE_PRESETS) {
            expect(p.points.length).toBeGreaterThanOrEqual(3);
            for (const [x, y] of p.points) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(1);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(y).toBeLessThanOrEqual(1);
            }
        }
    });

    it('ids and label keys are unique', () => {
        expect(new Set(SLOPE_PRESETS.map((p) => p.id)).size).toBe(SLOPE_PRESETS.length);
        expect(new Set(SLOPE_PRESETS.map((p) => p.labelKey)).size).toBe(SLOPE_PRESETS.length);
    });

    it('presetPointsPx scales normalized points to tile-local pixels', () => {
        const ramp = SLOPE_PRESETS.find((p) => p.id === 'rampR')!;
        expect(presetPointsPx(ramp, 32, 16)).toEqual([[0, 16], [32, 16], [32, 0]]);
    });

    it('presetPointsPx rounds to integer pixels for odd tile sizes', () => {
        const half = SLOPE_PRESETS.find((p) => p.id === 'halfBottom')!; // y: 0.5 → round(0.5*15)=8
        const px = presetPointsPx(half, 15, 15);
        for (const [x, y] of px) {
            expect(Number.isInteger(x)).toBe(true);
            expect(Number.isInteger(y)).toBe(true);
        }
    });
});
