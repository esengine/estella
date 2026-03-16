import { describe, it, expect } from 'vitest';
import { GridLayoutProvider } from '../src/ui/layouts/GridLayoutProvider';
import type { GridLayoutData } from '../src/ui/layouts/GridLayout';

const provider = new GridLayoutProvider();

function vGrid(cols = 3, itemW = 100, itemH = 100, spX = 4, spY = 4): GridLayoutData {
    return { direction: 0, crossAxisCount: cols, itemSize: { x: itemW, y: itemH }, spacing: { x: spX, y: spY } };
}

describe('GridLayoutProvider', () => {
    describe('getContentSize', () => {
        it('calculates vertical grid size', () => {
            const size = provider.getContentSize(10, { x: 400, y: 400 }, vGrid(3, 100, 100, 4, 4));
            expect(size.width).toBe(3 * 100 + 2 * 4);
            expect(size.height).toBe(4 * 100 + 3 * 4);
        });

        it('handles exact fill', () => {
            const size = provider.getContentSize(9, { x: 400, y: 400 }, vGrid(3, 100, 100, 0, 0));
            expect(size).toEqual({ width: 300, height: 300 });
        });

        it('handles empty', () => {
            const size = provider.getContentSize(0, { x: 400, y: 400 }, vGrid());
            expect(size).toEqual({ width: 0, height: 0 });
        });
    });

    describe('getVisibleRange', () => {
        it('returns items in visible rows', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 400, y: 200 }, 12, 0, vGrid(3, 100, 100, 0, 0),
            );
            const indices = results.map(r => r.index);
            expect(indices).toContain(0);
            expect(indices).toContain(1);
            expect(indices).toContain(2);
            expect(indices).toContain(3);
            expect(indices).toContain(4);
            expect(indices).toContain(5);
        });

        it('positions items in grid pattern', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 400, y: 400 }, 9, 0, vGrid(3, 100, 100, 10, 10),
            );
            const item0 = results.find(r => r.index === 0)!;
            const item1 = results.find(r => r.index === 1)!;
            const item3 = results.find(r => r.index === 3)!;
            expect(item0.position).toEqual({ x: 0, y: 0 });
            expect(item1.position).toEqual({ x: 110, y: 0 });
            expect(item3.position).toEqual({ x: 0, y: 110 });
        });

        it('returns empty for zero items', () => {
            expect(provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 400, y: 400 }, 0, 0, vGrid(),
            )).toEqual([]);
        });

        it('clamps to item count', () => {
            const results = provider.getVisibleRange(
                { x: 0, y: 0 }, { x: 400, y: 10000 }, 5, 0, vGrid(3),
            );
            expect(results.length).toBe(5);
        });
    });

    describe('getScrollOffsetForIndex', () => {
        it('scrolls to row containing index', () => {
            const offset = provider.getScrollOffsetForIndex(6, { x: 400, y: 200 }, 12, vGrid(3, 100, 100, 0, 0), 0);
            expect(offset.y).toBe(200);
        });
    });
});
