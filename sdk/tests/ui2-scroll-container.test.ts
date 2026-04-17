import { describe, it, expect, vi } from 'vitest';
import { ScrollContainer, ScrollContainerRegistry } from '../src/ui2';

describe('ScrollContainer', () => {
    it('clamps initial offset to [0, max]', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
            initialOffset: { x: 0, y: 999 },
        });
        // max Y = 500 - 100 = 400
        expect(c.getOffset()).toEqual({ x: 0, y: 400 });
    });

    it('clamps negative offsets to 0', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
        });
        c.setOffset({ x: -50, y: -50 });
        expect(c.getOffset()).toEqual({ x: 0, y: 0 });
    });

    it('clamps to max for oversized content', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
        });
        c.setOffset({ x: 0, y: 1000 });
        expect(c.getOffset()).toEqual({ x: 0, y: 400 });
    });

    it('vertical direction locks x to 0', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 500, y: 500 },
            direction: 'vertical',
        });
        c.setOffset({ x: 100, y: 50 });
        expect(c.getOffset()).toEqual({ x: 0, y: 50 });
    });

    it('horizontal direction locks y to 0', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 500, y: 500 },
            direction: 'horizontal',
        });
        c.setOffset({ x: 100, y: 50 });
        expect(c.getOffset()).toEqual({ x: 100, y: 0 });
    });

    it('scrollBy adds delta then clamps', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
        });
        c.scrollBy({ x: 0, y: 150 });
        c.scrollBy({ x: 0, y: 200 });
        expect(c.getOffset().y).toBe(350);
        c.scrollBy({ x: 0, y: 999 });
        expect(c.getOffset().y).toBe(400);   // clamped
    });

    it('onScroll fires only when offset actually changes', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
        });
        const spy = vi.fn();
        c.onScroll(spy);

        c.setOffset({ x: 0, y: 50 });
        c.setOffset({ x: 0, y: 50 });   // same value — no fire
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith({ x: 0, y: 50 });
    });

    it('unsubscribe stops notifications', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
        });
        const spy = vi.fn();
        const off = c.onScroll(spy);

        off();
        c.setOffset({ x: 0, y: 50 });
        expect(spy).not.toHaveBeenCalled();
    });

    it('setContentSize re-clamps current offset', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
            initialOffset: { x: 0, y: 380 },
        });
        expect(c.getOffset().y).toBe(380);

        c.setContentSize({ x: 200, y: 300 });   // new max = 200
        expect(c.getOffset().y).toBe(200);
    });

    it('setViewportSize re-clamps current offset', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
            initialOffset: { x: 0, y: 350 },
        });
        c.setViewportSize({ x: 200, y: 300 });   // new max = 500 - 300 = 200
        expect(c.getOffset().y).toBe(200);
    });

    it('wheel speed multiplier is stored and readable', () => {
        const c = new ScrollContainer({
            viewportSize: { x: 200, y: 100 },
            contentSize: { x: 200, y: 500 },
            wheelSpeed: 2.5,
        });
        expect(c.getWheelSpeed()).toBe(2.5);
    });
});

describe('ScrollContainerRegistry', () => {
    it('attach, get, detach round-trip', () => {
        const reg = new ScrollContainerRegistry();
        const c = new ScrollContainer({
            viewportSize: { x: 1, y: 1 }, contentSize: { x: 1, y: 1 },
        });
        reg.attach(42, c);
        expect(reg.get(42)).toBe(c);
        expect(reg.size()).toBe(1);

        reg.detach(42);
        expect(reg.get(42)).toBeUndefined();
        expect(reg.size()).toBe(0);
    });
});
