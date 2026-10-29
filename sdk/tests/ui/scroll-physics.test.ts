// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Drag, inertia and elastic bounce, with no layout or engine in the way.
 */
import { describe, expect, it } from 'vitest';
import { ScrollAxis } from '../../src/ui/collection/scroll-physics';

const run = (axis: ScrollAxis, seconds: number): void => { for (let i = 0; i < seconds * 60; i++) axis.update(1 / 60); };

function axis(max = 500, over: Partial<ConstructorParameters<typeof ScrollAxis>[0]> = {}): ScrollAxis {
    const a = new ScrollAxis({ inertia: true, elastic: true, brake: 0.5, bounceTime: 0.5, ...over });
    a.setExtents(400, 400 + max);
    return a;
}

describe('ScrollAxis', () => {
    it('follows a drag inside its range', () => {
        const a = axis();
        a.press();
        a.drag(30, 0.0, 400);
        a.drag(20, 0.1, 400);
        expect(a.offset).toBe(50);
        expect(a.overscroll).toBe(0);
    });

    it('damps a drag past an end, more the further out it goes, and lets it back in freely', () => {
        const a = axis();
        a.press();
        a.drag(-100, 0, 400);               // 100 past the start
        const first = a.offset;
        expect(first).toBeLessThan(0);
        expect(first).toBeGreaterThan(-100);   // damped
        a.drag(-100, 0.05, 400);
        expect(a.offset - first).toBeGreaterThan(-100 * 0.5);   // the second step moves less than the first would have
        const out = a.offset;
        a.drag(20, 0.1, 400);
        expect(a.offset).toBe(out + 20);        // back in: undamped
    });

    it('springs back inside its range after a release past an end', () => {
        const a = axis(500, { bounceTime: 0.5 });
        a.press();
        a.drag(-80, 0, 400);
        a.release();
        run(a, 0.6);
        expect(a.offset).toBeCloseTo(0, 3);
        expect(a.moving).toBe(false);
    });

    it('glides on after a flick, further for a harder one, and rests', () => {
        const slow = axis(5000), fast = axis(5000);
        for (const [a, step] of [[slow, 10], [fast, 40]] as const) {
            a.press();
            for (let i = 0; i < 6; i++) a.drag(step, i * 0.016, 400);
            a.release();
        }
        const atRelease = { slow: slow.offset, fast: fast.offset };
        run(slow, 5); run(fast, 5);
        expect(slow.offset).toBeGreaterThan(atRelease.slow);
        expect(fast.offset - atRelease.fast).toBeGreaterThan(slow.offset - atRelease.slow);
        expect(slow.moving).toBe(false);
        expect(fast.moving).toBe(false);
    });

    it('does not glide with inertia off, and a finger landing stops a glide where it is', () => {
        const still = axis(5000, { inertia: false });
        still.press();
        for (let i = 0; i < 6; i++) still.drag(30, i * 0.016, 400);
        still.release();
        const rest = still.offset;
        run(still, 1);
        expect(still.offset).toBe(rest);

        const a = axis(5000);
        a.press();
        for (let i = 0; i < 6; i++) a.drag(30, i * 0.016, 400);
        a.release();
        run(a, 0.2);
        const mid = a.offset;
        a.press();
        run(a, 1);
        expect(a.offset).toBe(mid);
    });

    it('clamps hard when it is not elastic', () => {
        const a = axis(500, { elastic: false });
        a.press();
        a.drag(-100, 0, 400);
        expect(a.offset).toBe(0);
        a.drag(2000, 0.1, 400);
        expect(a.offset).toBe(500);
    });

    it('scrolls to a place over a time, clamped to its range, or at once', () => {
        const a = axis(500);
        a.scrollTo(300, 1);
        run(a, 1.1);
        expect(a.offset).toBe(300);
        a.scrollTo(9999);
        expect(a.offset).toBe(500);
        a.scrollTo(-5);
        expect(a.offset).toBe(0);
    });

    it('has nothing to scroll when the content fits', () => {
        const a = new ScrollAxis();
        a.setExtents(400, 300);
        expect(a.max).toBe(0);
    });
});
