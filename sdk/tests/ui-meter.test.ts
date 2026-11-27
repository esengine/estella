// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A UIMeter's fill and ghost over time: a drop shows at once with the ghost held a moment and then easing down, hits in a row
 *        keep the ghost up, a rise climbs at its rate, and a meter seen for the first time stands at its value.
 */
import { describe, it, expect } from 'vitest';
import { stepMeter, type MeterShown } from '../src/ui/behavior/meter';

const timing = { holdTime: 0.25, fallTime: 0.6, riseTime: 0.3 };
const run = (from: MeterShown | undefined, value: number, seconds: number, dt = 1 / 60): MeterShown => {
    let shown = stepMeter(from, { ...timing, value }, dt);
    for (let t = dt; t < seconds - 1e-9; t += dt) shown = stepMeter(shown, { ...timing, value }, dt);
    return shown;
};

describe('a meter', () => {
    it('stands at its value the first time it is seen, clamped to 0..1', () => {
        expect(stepMeter(undefined, { ...timing, value: 0.4 }, 0)).toEqual({ fill: 0.4, ghost: 0.4, hold: 0, from: 0.4, fell: 0 });
        expect(stepMeter(undefined, { ...timing, value: 3 }, 0).fill).toBe(1);
    });

    it('shows a drop at once, holds the ghost at the old amount, then eases it down to the value', () => {
        const full = stepMeter(undefined, { ...timing, value: 1 }, 0);
        const hit = stepMeter(full, { ...timing, value: 0.6 }, 1 / 60);
        expect(hit.fill).toBe(0.6);
        expect(hit.ghost).toBe(1);
        const held = run(hit, 0.6, 0.2);
        expect(held.ghost).toBe(1);
        const falling = run(held, 0.6, 0.2);
        expect(falling.ghost).toBeLessThan(1);
        expect(falling.ghost).toBeGreaterThan(0.6);
        // Eased out: it covers more of the way in its first tenth of a second falling than in the next.
        const a = run(held, 0.6, 0.15), b = run(a, 0.6, 0.1);
        expect(1 - a.ghost).toBeGreaterThan(a.ghost - b.ghost);
        expect(run(held, 0.6, 1).ghost).toBe(0.6);
        // It arrives when fallTime is up, not long after: half the fall in, it has covered most of the way, but not all.
        const half = run(held, 0.6, 0.05 + 0.3);
        expect((1 - half.ghost) / 0.4).toBeGreaterThan(0.8);
        expect(half.ghost).toBeGreaterThan(0.6);
        expect(run(held, 0.6, 0.05 + 0.6 + 1 / 60).ghost).toBeCloseTo(0.6, 6);
    });

    it('keeps the ghost up through hits in a row, so a combo reads as one loss', () => {
        let shown = stepMeter(undefined, { ...timing, value: 1 }, 0);
        for (const value of [0.8, 0.6, 0.4]) shown = run(shown, value, 0.15);
        expect(shown.fill).toBe(0.4);
        expect(shown.ghost).toBe(1);
        expect(run(shown, 0.4, 1.2).ghost).toBe(0.4);
    });

    it('climbs to a higher value at its rise rate, with no ghost under the fill', () => {
        const low = stepMeter(undefined, { ...timing, value: 0.2 }, 0);
        const halfway = run(low, 0.8, 0.1);
        expect(halfway.fill).toBeCloseTo(0.2 + 0.1 / 0.3, 2);
        expect(halfway.ghost).toBe(halfway.fill);
        expect(run(halfway, 0.8, 0.5).fill).toBe(0.8);
        expect(stepMeter(low, { ...timing, riseTime: 0, value: 0.9 }, 1 / 60).fill).toBe(0.9);
    });

    it('drops with no hold or fall at once when asked for none', () => {
        const full = stepMeter(undefined, { ...timing, value: 1 }, 0);
        const instant = { holdTime: 0, fallTime: 0, riseTime: 0 };
        const dropped = stepMeter(full, { ...instant, value: 0.3 }, 1 / 60);
        expect([dropped.fill, dropped.ghost]).toEqual([0.3, 0.3]);
    });
});
