import { describe, it, expect } from 'vitest';
import { FanLayoutProvider, computeFanPositions } from '../src/ui/layouts/FanLayoutProvider';
import type { FanLayoutData } from '../src/ui/layouts/FanLayout';

const defaults: FanLayoutData = {
    radius: 600,
    maxSpreadAngle: 30,
    maxCardAngle: 8,
    tiltFactor: 1,
    cardSpacing: 0,
    direction: 0,
};

describe('computeFanPositions', () => {
    it('single card is centered', () => {
        const results = computeFanPositions(1, defaults);
        expect(results).toHaveLength(1);
        expect(results[0].position.x).toBeCloseTo(0);
        expect(results[0].position.y).toBeCloseTo(0);
        expect(results[0].rotation).toBeCloseTo(0);
    });

    it('cards are symmetric', () => {
        const results = computeFanPositions(5, defaults);
        expect(results).toHaveLength(5);
        expect(results[0].position.x).toBeCloseTo(-results[4].position.x, 5);
        expect(results[0].position.y).toBeCloseTo(results[4].position.y, 5);
        expect(results[2].position.x).toBeCloseTo(0, 5);
    });

    it('spread is capped by maxSpreadAngle', () => {
        const results = computeFanPositions(3, { ...defaults, maxSpreadAngle: 10, maxCardAngle: 20 });
        const leftX = results[0].position.x;
        const rightX = results[2].position.x;
        const maxResults = computeFanPositions(3, { ...defaults, maxSpreadAngle: 10 });
        expect(Math.abs(rightX - leftX)).toBeCloseTo(Math.abs(maxResults[2].position.x - maxResults[0].position.x), 3);
    });

    it('spread is capped by maxCardAngle', () => {
        const results = computeFanPositions(3, { ...defaults, maxSpreadAngle: 100, maxCardAngle: 5 });
        const spread = Math.abs(results[2].position.x - results[0].position.x);
        const wideResults = computeFanPositions(3, { ...defaults, maxSpreadAngle: 100, maxCardAngle: 50 });
        expect(spread).toBeLessThan(Math.abs(wideResults[2].position.x - wideResults[0].position.x));
    });

    it('direction=down flips Y', () => {
        const upResults = computeFanPositions(5, { ...defaults, direction: 0 });
        const downResults = computeFanPositions(5, { ...defaults, direction: 1 });
        expect(upResults[0].position.y).toBeGreaterThanOrEqual(0);
        expect(downResults[0].position.y).toBeLessThanOrEqual(0);
    });

    it('excludeIndices removes cards', () => {
        const results = computeFanPositions(5, defaults, new Set([1, 3]));
        expect(results).toHaveLength(3);
        expect(results.map(r => r.index)).toEqual([0, 2, 4]);
    });

    it('tiltFactor=0 means no rotation', () => {
        const results = computeFanPositions(5, { ...defaults, tiltFactor: 0 });
        for (const r of results) {
            expect(r.rotation).toBeCloseTo(0);
        }
    });

    it('returns empty for zero items', () => {
        expect(computeFanPositions(0, defaults)).toEqual([]);
    });
});

describe('FanLayoutProvider', () => {
    const provider = new FanLayoutProvider();

    it('getVisibleRange returns all items (no virtual scroll)', () => {
        const results = provider.getVisibleRange(
            { x: 0, y: 0 }, { x: 800, y: 600 }, 7, 0, defaults,
        );
        expect(results).toHaveLength(7);
    });

    it('getScrollOffsetForIndex always returns zero', () => {
        expect(provider.getScrollOffsetForIndex(3, { x: 800, y: 600 }, 7, defaults, 0)).toEqual({ x: 0, y: 0 });
    });
});
