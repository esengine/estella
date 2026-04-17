import { describe, it, expect } from 'vitest';
import { LinearLayoutProvider, GridLayoutProvider, type Rect } from '../src/ui2';

const VIEWPORT = (x: number, y: number, w: number, h: number): Rect =>
    ({ x, y, width: w, height: h });

describe('LinearLayoutProvider (column)', () => {
    const p = new LinearLayoutProvider({
        direction: 'column',
        itemSize: { x: 200, y: 40 },
        spacing: 4,
    });

    it('content height includes every item plus inter-item spacing', () => {
        // 10 items * 40 height + 9 gaps * 4 = 400 + 36 = 436
        expect(p.getContentSize(10)).toEqual({ x: 200, y: 436 });
    });

    it('empty content has zero size', () => {
        expect(p.getContentSize(0)).toEqual({ x: 0, y: 0 });
    });

    it('item rects stride by itemSize + spacing', () => {
        expect(p.getItemRect(0)).toEqual({ x: 0, y: 0, width: 200, height: 40 });
        expect(p.getItemRect(1)).toEqual({ x: 0, y: 44, width: 200, height: 40 });
        expect(p.getItemRect(5)).toEqual({ x: 0, y: 220, width: 200, height: 40 });
    });

    it('viewport at origin returns items that overlap the window', () => {
        // viewport 0..120 (3 strides of 44 = 132) → items 0,1,2
        const [start, end] = p.getVisibleRange(VIEWPORT(0, 0, 200, 120), 10);
        expect(start).toBe(0);
        expect(end).toBe(3);
    });

    it('scrolled viewport returns the offset range', () => {
        // scroll to y=100 (mid item 2), height 80 → ends at 180
        // start = floor(100/44) = 2; last = ceil(180/44)-1 = 4; range [2,5)
        const [start, end] = p.getVisibleRange(VIEWPORT(0, 100, 200, 80), 10);
        expect(start).toBe(2);
        expect(end).toBe(5);
    });

    it('clamps to data count when viewport extends past end', () => {
        const [start, end] = p.getVisibleRange(VIEWPORT(0, 400, 200, 200), 10);
        expect(start).toBe(9);   // item at y=396..436
        expect(end).toBe(10);
    });

    it('returns [0,0] for empty data', () => {
        const [start, end] = p.getVisibleRange(VIEWPORT(0, 0, 200, 100), 0);
        expect([start, end]).toEqual([0, 0]);
    });
});

describe('LinearLayoutProvider (row)', () => {
    const p = new LinearLayoutProvider({
        direction: 'row',
        itemSize: { x: 100, y: 60 },
        spacing: 10,
    });

    it('content size extends horizontally', () => {
        expect(p.getContentSize(4)).toEqual({ x: 100 * 4 + 30, y: 60 });
    });

    it('item rect strides along x', () => {
        expect(p.getItemRect(2)).toEqual({ x: 220, y: 0, width: 100, height: 60 });
    });

    it('getVisibleRange uses viewport.x / width', () => {
        // 0..250 wide → items at x=0, 110, 220, each item 100 wide
        // item 0: 0..100 ✓, item 1: 110..210 ✓, item 2: 220..320 overlaps 250 ✓
        const [start, end] = p.getVisibleRange(VIEWPORT(0, 0, 250, 60), 10);
        expect(start).toBe(0);
        expect(end).toBe(3);
    });
});

describe('GridLayoutProvider', () => {
    const p = new GridLayoutProvider({
        columns: 3,
        itemSize: { x: 80, y: 80 },
        spacing: { x: 10, y: 10 },
    });

    it('content size accounts for rows inferred from count + columns', () => {
        // 10 items, 3 cols → 4 rows. width = 3*80 + 2*10 = 260. height = 4*80 + 3*10 = 350.
        expect(p.getContentSize(10)).toEqual({ x: 260, y: 350 });
    });

    it('getItemRect places index along column-major then row', () => {
        expect(p.getItemRect(0)).toEqual({ x: 0, y: 0, width: 80, height: 80 });
        expect(p.getItemRect(2)).toEqual({ x: 180, y: 0, width: 80, height: 80 });
        expect(p.getItemRect(3)).toEqual({ x: 0, y: 90, width: 80, height: 80 });
        expect(p.getItemRect(7)).toEqual({ x: 90, y: 180, width: 80, height: 80 });
    });

    it('visible range covers full rows intersecting the viewport', () => {
        // viewport y=0, height 100 → firstRow 0, lastRow ceil(100/90)-1 = 1. range [0, 6)
        const [start, end] = p.getVisibleRange(VIEWPORT(0, 0, 260, 100), 20);
        expect(start).toBe(0);
        expect(end).toBe(6);
    });

    it('enforces at least one column even if caller passes zero', () => {
        const pEdge = new GridLayoutProvider({ columns: 0, itemSize: { x: 50, y: 50 } });
        expect(pEdge.getContentSize(3)).toEqual({ x: 50, y: 150 });
    });

    it('returns [0,0] for empty data', () => {
        expect(p.getVisibleRange(VIEWPORT(0, 0, 100, 100), 0)).toEqual([0, 0]);
    });
});
