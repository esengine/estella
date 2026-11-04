// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { drawBudgetReport } from '../src/render/drawBudget';
import { defaultQualityProfile, parseQualityConfig, resolveQualityProfile } from '../src/render/quality';

describe('a frame\'s draws by pass', () => {
    it('gives each counted pass its share and leaves the rest to other, so the shares add up to the device', () => {
        const r = drawBudgetReport(120, 150, { 'batch.draws': 40, 'render.shadow.draws': 50, 'render.prepass.draws': 20 });
        expect(r.passes).toEqual([
            { pass: 'shadow', draws: 50 }, { pass: 'lists', draws: 40 }, { pass: 'prepass', draws: 20 }, { pass: 'other', draws: 10 },
        ]);
        expect(r.passes.reduce((n, p) => n + p.draws, 0)).toBe(120);
        expect(r.over).toBe(0);
    });

    it('says by how much a frame went past its budget, and nothing when there is no budget', () => {
        expect(drawBudgetReport(180, 150, {}).over).toBe(30);
        expect(drawBudgetReport(180, 0, {}).over).toBe(0);
    });

    it('takes the lists\' own count while the profiler publishes no counters', () => {
        const r = drawBudgetReport(30, 150, {}, 12);
        expect(r.passes).toEqual([{ pass: 'other', draws: 18 }, { pass: 'lists', draws: 12 }]);
    });

    it('never has a negative other when a pass claims more than the device counted', () => {
        const r = drawBudgetReport(10, 150, { 'batch.draws': 12 });
        expect(r.passes).toEqual([{ pass: 'lists', draws: 12 }]);
    });
});

describe('the draw call budget of a quality level', () => {
    it('is smaller on the weaker levels, and a project can set its own', () => {
        expect(defaultQualityProfile('low').drawCallBudget).toBeLessThan(defaultQualityProfile('medium').drawCallBudget);
        expect(defaultQualityProfile('medium').drawCallBudget).toBeLessThan(defaultQualityProfile('high').drawCallBudget);
        expect(resolveQualityProfile('low', { drawCallBudget: 90 }).drawCallBudget).toBe(90);
        const config = parseQualityConfig({ mode: 'low', profiles: { low: { drawCallBudget: 'many' } } });
        expect(config.profiles?.low?.drawCallBudget).toBe(defaultQualityProfile('low').drawCallBudget);
    });
});
