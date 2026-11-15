// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDiagnostics, watchMainProcess } from '../lib/engineTestDiagnostics.mjs';

describe('the engine suite\'s main-process diagnostics', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('records nothing held when every tick arrives on time', () => {
        let clock = 0;
        const stop = watchMainProcess(() => clock);
        for (let i = 0; i < 5; i++) { clock += 1000; vi.advanceTimersByTime(1000); }
        const report = stop();
        expect(report.ticks).toBe(5);
        expect(report.worstStallMs).toBe(0);
        expect(report.stalls).toEqual([]);
    });

    it('records how long the process was held when a tick arrives late, and what memory was then', () => {
        let clock = 0;
        const stop = watchMainProcess(() => clock);
        clock += 1000; vi.advanceTimersByTime(1000);
        clock += 63000; vi.advanceTimersByTime(1000);
        const report = stop();
        expect(report.worstStallMs).toBe(62000);
        expect(report.stalls).toHaveLength(1);
        expect(report.stalls[0].stallMs).toBe(62000);
        expect(report.stalls[0].freeMb).toBeGreaterThan(0);
        expect(formatDiagnostics(report)).toMatch(/held for at most 62000 ms[\s\S]*held 62000 ms until/);
    });

    it('does not count a hold shorter than the threshold as one', () => {
        let clock = 0;
        const stop = watchMainProcess(() => clock);
        clock += 4000; vi.advanceTimersByTime(1000);
        const report = stop();
        expect(report.worstStallMs).toBe(3000);
        expect(report.stalls).toEqual([]);
    });
});
