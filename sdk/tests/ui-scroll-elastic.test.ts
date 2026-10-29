// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pulling a scroll area past its end and letting it spring back, and the gesture (grab, drag, let go, coast) around it.
 *
 * No input, no ECS, no engine: ScrollContainer, KineticScroll and ScrollMotion are models. What is pinned is what a hand feels: a
 * pull past an end is stiffer the further out it goes and never more than the viewport, the offset itself never leaves its range,
 * letting go returns the content to its end, a flick that reaches an end bounces instead of stopping dead, and taking hold of
 * content in mid-bounce continues from where it is.
 */
import { describe, expect, it } from 'vitest';
import { ScrollContainer, rubberBand, rubberBandInverse } from '../src/ui/collection/scroll-container';
import { ScrollMotion } from '../src/ui/collection/scroll-motion';

const view = { x: 300, y: 400 };

function area(over: Partial<ConstructorParameters<typeof ScrollContainer>[0]> = {}): ScrollContainer {
    return new ScrollContainer({ viewportSize: view, contentSize: { x: 300, y: 1400 }, elastic: true, bounceTime: 0.4, ...over });
}

const run = (m: ScrollMotion, seconds: number, dt = 1 / 60): void => { for (let t = 0; t < seconds; t += dt) m.tick(dt); };

describe('rubber banding', () => {
    it('is zero for no pull, grows with the pull, and never reaches the viewport', () => {
        expect(rubberBand(0, 400)).toBe(0);
        const a = rubberBand(50, 400), b = rubberBand(200, 400), c = rubberBand(100000, 400);
        expect(a).toBeGreaterThan(0);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeLessThan(400);
        expect(rubberBand(-50, 400)).toBe(-a);
    });

    it('is stiffer the further out: the second 100px of pull shows less than the first', () => {
        expect(rubberBand(200, 400) - rubberBand(100, 400)).toBeLessThan(rubberBand(100, 400));
    });

    it('has an inverse: the pull that holds the content where it is shown', () => {
        for (const pull of [10, 80, 300, 900]) expect(rubberBandInverse(rubberBand(pull, 400), 400)).toBeCloseTo(pull, 5);
        expect(rubberBandInverse(-rubberBand(70, 400), 400)).toBeCloseTo(-70, 5);
    });
});

describe('ScrollContainer overscroll', () => {
    it('is off by default: a pull past an end is just clamped', () => {
        const c = area({ elastic: false });
        c.dragTo({ x: 0, y: -80 });
        expect(c.getOffset().y).toBe(0);
        expect(c.getOverscroll()).toEqual({ x: 0, y: 0 });
    });

    it('keeps the offset in range and shows the pull past an end as overscroll, in the direction of the pull', () => {
        const c = area();
        c.dragTo({ x: 0, y: -80 });                       // 80 before the start
        expect(c.getOffset().y).toBe(0);
        expect(c.getOverscroll().y).toBeLessThan(0);
        expect(c.getOverscroll().y).toBeGreaterThan(-80);
        c.dragTo({ x: 0, y: 1000 + 80 });                 // 80 past the end (max is 1000)
        expect(c.getOffset().y).toBe(1000);
        expect(c.getOverscroll().y).toBeGreaterThan(0);
    });

    it('does not overscroll an axis it does not scroll', () => {
        const c = area({ direction: 'vertical' });
        c.dragTo({ x: -50, y: 20 });
        expect(c.getOverscroll().x).toBe(0);
    });

    it('springs back to its end by the bounce time, and says so, without touching the offset', () => {
        const c = area();
        c.dragTo({ x: 0, y: -120 });
        const seen: number[] = [];
        const scrolled: number[] = [];
        c.onOverscroll((o) => seen.push(o.y));
        c.onScroll(() => scrolled.push(1));
        for (let t = 0; t < 0.4 * 1.5; t += 1 / 60) c.tickSpring(1 / 60);
        expect(c.getOverscroll().y).toBe(0);
        expect(c.isSpringing()).toBe(false);
        expect(seen.length).toBeGreaterThan(1);
        expect(Math.abs(seen[0]!)).toBeGreaterThan(Math.abs(seen[seen.length - 2]!));   // it only closes
        expect(scrolled).toEqual([]);                                                     // the offset never moved
    });

    it('does not tick when it is not elastic or has nothing to return', () => {
        expect(area({ elastic: false }).tickSpring(1 / 60)).toBe(false);
        expect(area().tickSpring(1 / 60)).toBe(false);
    });
});

describe('ScrollMotion', () => {
    it('follows a drag, with the offset moving until an end and the overscroll after it', () => {
        const c = area();
        const m = new ScrollMotion(c);
        m.grab();
        m.dragBy({ x: 0, y: 300 }, 1 / 60);
        expect(c.getOffset().y).toBe(300);
        expect(c.getOverscroll().y).toBe(0);
        m.dragBy({ x: 0, y: 1100 }, 1 / 60);              // 100 past the end
        expect(c.getOffset().y).toBe(1000);
        expect(c.getOverscroll().y).toBeGreaterThan(0);
        // pulling back re-tracks the finger from the grab point
        m.dragBy({ x: 0, y: 600 }, 1 / 60);
        expect(c.getOffset().y).toBe(600);
        expect(c.getOverscroll().y).toBe(0);
    });

    it('returns an over-pulled end when let go', () => {
        const c = area();
        const m = new ScrollMotion(c);
        m.grab();
        m.dragBy({ x: 0, y: -150 }, 1 / 60);
        m.release();
        expect(m.isMoving).toBe(true);
        run(m, 1);
        expect(c.getOverscroll().y).toBe(0);
        expect(c.getOffset().y).toBe(0);
        expect(m.isMoving).toBe(false);
    });

    it('coasts on after a flick, and a flick that reaches an end bounces off it instead of stopping dead', () => {
        const c = area({ contentSize: { x: 300, y: 700 } });   // only 300 to scroll
        const m = new ScrollMotion(c);
        m.grab();
        for (let i = 1; i <= 8; i++) m.dragBy({ x: 0, y: i * 40 }, 1 / 60);   // fast: 40px a frame
        m.release();
        let sawOverscroll = false;
        let maxOffset = 0;
        for (let t = 0; t < 2; t += 1 / 60) {
            m.tick(1 / 60);
            if (c.getOverscroll().y > 0) sawOverscroll = true;
            maxOffset = Math.max(maxOffset, c.getOffset().y);
        }
        expect(maxOffset).toBe(300);
        expect(sawOverscroll).toBe(true);
        expect(c.getOverscroll().y).toBe(0);
        expect(c.getOffset().y).toBe(300);
    });

    it('stops a coast dead at an end when the area is not elastic', () => {
        const c = area({ elastic: false, contentSize: { x: 300, y: 700 } });
        const m = new ScrollMotion(c);
        m.grab();
        for (let i = 1; i <= 8; i++) m.dragBy({ x: 0, y: i * 40 }, 1 / 60);
        m.release();
        run(m, 2);
        expect(c.getOffset().y).toBe(300);
        expect(c.getOverscroll().y).toBe(0);
    });

    it('takes hold of content in mid-bounce where it is, not where it will end up', () => {
        const c = area();
        const m = new ScrollMotion(c);
        m.grab();
        m.dragBy({ x: 0, y: -200 }, 1 / 60);
        m.release();
        run(m, 0.1);
        const shown = c.getOffset().y + c.getOverscroll().y;
        expect(shown).toBeLessThan(0);
        m.grab();
        m.dragBy({ x: 0, y: 0 }, 1 / 60);                  // a finger that has not moved
        expect(c.getOffset().y + c.getOverscroll().y).toBeCloseTo(shown, 3);
    });

    it('scrolls to a place over a time, clamped, and stops a coast to do it', () => {
        const c = area();
        const m = new ScrollMotion(c);
        m.animateTo({ x: 0, y: 500 }, 0.5);
        expect(m.isMoving).toBe(true);
        run(m, 0.6);
        expect(c.getOffset().y).toBe(500);
        expect(m.isMoving).toBe(false);
        m.animateTo({ x: 0, y: 99999 }, 0);
        expect(c.getOffset().y).toBe(1000);
    });

    it('does not move on its own while a finger holds it', () => {
        const c = area();
        const m = new ScrollMotion(c);
        m.grab();
        m.dragBy({ x: 0, y: -100 }, 1 / 60);
        const held = c.getOverscroll().y;
        run(m, 1);
        expect(c.getOverscroll().y).toBe(held);
    });
});
