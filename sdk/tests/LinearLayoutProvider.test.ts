import { describe, it, expect } from 'vitest';
import { LinearLayoutProvider } from '../src/ui/layouts/LinearLayoutProvider';
import type { LinearLayoutData } from '../src/ui/layouts/LinearLayout';

const provider = new LinearLayoutProvider();

function vConfig(itemSize = 40, spacing = 0, reverse = false): LinearLayoutData {
    return { direction: 1, itemSize, spacing, reverseOrder: reverse };
}

function hConfig(itemSize = 40, spacing = 0, reverse = false): LinearLayoutData {
    return { direction: 0, itemSize, spacing, reverseOrder: reverse };
}

const viewport = { x: 300, y: 400 };

describe('LinearLayoutProvider', () => {
    describe('getContentSize', () => {
        it('calculates vertical content size', () => {
            const size = provider.getContentSize(10, viewport, vConfig(40, 4));
            expect(size).toEqual({ width: 300, height: 10 * 40 + 9 * 4 });
        });

        it('calculates horizontal content size', () => {
            const size = provider.getContentSize(5, viewport, hConfig(60, 10));
            expect(size).toEqual({ width: 5 * 60 + 4 * 10, height: 400 });
        });

        it('returns zero for empty list', () => {
            const size = provider.getContentSize(0, viewport, vConfig());
            expect(size).toEqual({ width: 300, height: 0 });
        });

        it('single item has no spacing', () => {
            const size = provider.getContentSize(1, viewport, vConfig(50, 10));
            expect(size).toEqual({ width: 300, height: 50 });
        });
    });

    describe('getVisibleRange', () => {
        it('returns items within viewport', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 300, y: 120 }, 100, 0, vConfig(40),
            );
            expect(results.length).toBeGreaterThanOrEqual(3);
            expect(results[0]).toEqual({ index: 0, position: { x: 0, y: 0 }, size: { x: 300, y: 40 } });
            expect(results[1]).toEqual({ index: 1, position: { x: 0, y: 40 }, size: { x: 300, y: 40 } });
            expect(results[2]).toEqual({ index: 2, position: { x: 0, y: 80 }, size: { x: 300, y: 40 } });
        });

        it('accounts for scroll offset', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 80 }, { x: 300, y: 100 }, 100, 0, vConfig(40),
            );
            expect(results[0].index).toBe(2);
        });

        it('includes overscan', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 80 }, { x: 300, y: 100 }, 100, 1, vConfig(40),
            );
            expect(results[0].index).toBe(1);
            expect(results[results.length - 1].index).toBe(6);
        });

        it('clamps to item count', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 300, y: 10000 }, 5, 0, vConfig(40),
            );
            expect(results.length).toBe(5);
        });

        it('handles horizontal direction', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 100, y: 300 }, 10, 0, hConfig(50),
            );
            expect(results[0].position).toEqual({ x: 0, y: 0 });
            expect(results[0].size).toEqual({ x: 50, y: 300 });
        });

        it('handles reverse order', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 300, y: 100 }, 10, 0, vConfig(40, 0, true),
            );
            expect(results[0].index).toBe(9);
            expect(results[1].index).toBe(8);
        });

        it('returns empty for zero items', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 300, y: 100 }, 0, 0, vConfig(),
            );
            expect(results).toEqual([]);
        });

        it('accounts for spacing in positions', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 300, y: 200 }, 10, 0, vConfig(40, 10),
            );
            expect(results[0].position.y).toBe(0);
            expect(results[1].position.y).toBe(50);
            expect(results[2].position.y).toBe(100);
        });
    });

    describe('getScrollOffsetForIndex', () => {
        it('scrolls to start alignment', () => {
            const offset = provider.getScrollOffsetForIndex(5, viewport, 100, vConfig(40), 0);
            expect(offset).toEqual({ x: 0, y: 200 });
        });

        it('scrolls to center alignment', () => {
            const offset = provider.getScrollOffsetForIndex(50, viewport, 100, vConfig(40), 1);
            expect(offset.y).toBe(50 * 40 - (400 - 40) / 2);
        });

        it('scrolls to end alignment', () => {
            const offset = provider.getScrollOffsetForIndex(50, viewport, 100, vConfig(40), 2);
            expect(offset.y).toBe(50 * 40 - 400 + 40);
        });

        it('clamps to zero', () => {
            const offset = provider.getScrollOffsetForIndex(0, viewport, 100, vConfig(40), 1);
            expect(offset.y).toBe(0);
        });

        it('clamps to max scroll', () => {
            const offset = provider.getScrollOffsetForIndex(99, viewport, 100, vConfig(40), 0);
            const maxScroll = 100 * 40 - 400;
            expect(offset.y).toBe(maxScroll);
        });
    });
});
