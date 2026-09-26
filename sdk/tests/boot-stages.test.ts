// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

// Two screens read this list — a web page's overlay and a mini-game's host
// indicator — and they are only comparable while both read the same one.
import { describe, it, expect } from 'vitest';
import { BOOT_STAGES, BOOT_TOTAL, bootPercent, bootSays, type BootStage } from '../src/runtime/bootStages';

const ids = BOOT_STAGES.map((s) => s.id) as BootStage[];

describe('the boot a package reports', () => {
    it('starts at nothing and ends at everything', () => {
        expect(bootPercent([])).toBe(0);
        expect(bootPercent(ids)).toBe(100);
    });

    it('never goes backwards as stages finish', () => {
        let last = -1;
        for (let i = 0; i <= ids.length; i++) {
            const pct = bootPercent(ids.slice(0, i));
            expect(pct).toBeGreaterThanOrEqual(last);
            last = pct;
        }
    });

    it('is weighted, so the engine is not one stage out of eight', () => {
        // The reason this list carries weights at all: an even bar sits still
        // through the longest leg of a cold start.
        const engine = BOOT_STAGES.find((s) => s.id === 'engine');
        expect(engine!.weight / BOOT_TOTAL).toBeGreaterThan(1 / BOOT_STAGES.length);
    });

    it('says what it is about to do, not what it just did', () => {
        expect(bootSays([])).toBe(BOOT_STAGES[0].says);
        expect(bootSays(['config'])).toBe(BOOT_STAGES[1].says);
    });

    it('says the last stage once everything is done, rather than nothing', () => {
        // A host that finished has an indicator up for one more moment; blank
        // there reads as a boot that lost track of itself.
        expect(bootSays(ids)).toBe(BOOT_STAGES[BOOT_STAGES.length - 1].says);
    });

    it('ignores a repeated stage, so a retried leg cannot overcount', () => {
        expect(bootPercent(['config', 'config', 'config'])).toBe(bootPercent(['config']));
    });
});
