// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `tween`: the chain a Cocos script writes, advanced by hand.
 *
 * Pure objects as targets, so the arithmetic is what is under test: `to` goes to a value and `by` goes by it, an easing reshapes
 * progress, a chain runs its steps in order and hands the time left over from one to the next, `repeat` and `union` mean what Cocos
 * means by them, and the value types are interpolated per component.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Color, Vec3, Tween, easing, tween, updateTweens } from '../../src/cocos';

afterEach(() => Tween.stopAll());

/** Run for @p seconds in @p frames equal steps. */
function run(seconds: number, frames = 10): void { for (let i = 0; i < frames; i++) updateTweens(seconds / frames); }

describe('tween steps', () => {
    it('goes to a value over its duration, and stops there', () => {
        const o = { x: 0 };
        tween(o).to(1, { x: 10 }).start();
        run(0.5, 5);
        expect(o.x).toBeCloseTo(5, 5);
        run(1, 10);
        expect(o.x).toBe(10);
    });

    it('goes by a value from wherever the target is when the step begins', () => {
        const o = { x: 3 };
        tween(o).by(1, { x: 4 }).by(1, { x: 4 }).start();
        run(2, 20);
        expect(o.x).toBe(11);
    });

    it('runs steps in order and carries the leftover time of one into the next', () => {
        const o = { x: 0, y: 0 };
        tween(o).to(1, { x: 1 }).to(1, { y: 1 }).start();
        updateTweens(1.5);   // one step's worth and half of the next in a single frame
        expect(o.x).toBe(1);
        expect(o.y).toBeCloseTo(0.5, 5);
    });

    it('sets at once, waits, and calls back with the target', () => {
        const o = { x: 0 };
        const log: string[] = [];
        tween(o).set({ x: 5 }).call((t) => log.push(`call:${(t as typeof o).x}`)).delay(1).call(() => log.push('after')).start();
        updateTweens(0.1);
        expect(log).toEqual(['call:5']);
        updateTweens(1);
        expect(log).toEqual(['call:5', 'after']);
    });

    it('applies an easing by name or by function', () => {
        const a = { x: 0 }, b = { x: 0 };
        tween(a).to(1, { x: 100 }, { easing: 'quadIn' }).start();
        tween(b).to(1, { x: 100 }, { easing: (k) => k * k * k }).start();
        updateTweens(0.5);
        expect(a.x).toBeCloseTo(25, 5);
        expect(b.x).toBeCloseTo(12.5, 5);
    });

    it('has curves that begin at 0 and end at 1', () => {
        for (const [name, fn] of Object.entries(easing)) {
            expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
            expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
        }
    });

    it('reports its progress through onUpdate, and start and completion once each', () => {
        const o = { x: 0 };
        const seen: number[] = [];
        let started = 0, completed = 0;
        tween(o).to(1, { x: 1 }, { onStart: () => started++, onUpdate: (_t, r) => seen.push(r), onComplete: () => completed++ }).start();
        run(1, 4);
        expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
        expect([started, completed]).toEqual([1, 1]);
    });
});

describe('tween composition', () => {
    it('repeats a sub-tween a number of times', () => {
        const o = { n: 0 };
        tween(o).repeat(3, tween(o).by(0.1, { n: 1 })).start();
        run(1, 20);
        expect(o.n).toBe(3);
    });

    it('repeats everything so far when no tween is given, and forever until stopped', () => {
        const o = { x: 0 };
        const t = tween(o).by(0.5, { x: 1 }).delay(0.5).repeatForever().start();
        run(5, 50);
        expect(o.x).toBe(5);
        expect(t.isRunning).toBe(true);
        t.stop();
        run(2, 20);
        expect(o.x).toBe(5);
    });

    it('unions what came before so a repeat covers all of it', () => {
        const o = { x: 0, y: 0 };
        tween(o).by(0.1, { x: 1 }).by(0.1, { y: 1 }).union().repeat(2).start();
        run(1, 20);
        expect([o.x, o.y]).toEqual([2, 2]);
    });

    it('runs tweens in parallel, finishing when the longest does', () => {
        const o = { x: 0, y: 0 };
        let done = false;
        tween(o).parallel(tween(o).to(1, { x: 1 }), tween(o).to(2, { y: 1 })).call(() => { done = true; }).start();
        run(1, 10);
        expect(o.x).toBe(1);
        expect(o.y).toBeCloseTo(0.5, 6);
        expect(done).toBe(false);
        run(1, 10);
        expect([o.x, o.y, done]).toEqual([1, 1, true]);
    });

    it('runs tweens in sequence, and another tween\'s steps with then', () => {
        const o = { x: 0 };
        tween(o).sequence(tween(o).to(1, { x: 1 }), tween(o).to(1, { x: 3 })).then(tween(o).to(1, { x: 0 })).start();
        run(1, 10);
        expect(o.x).toBe(1);
        run(1, 10);
        expect(o.x).toBe(3);
        run(1, 10);
        expect(o.x).toBe(0);
    });

    it('stops by target and by tag, and not the others', () => {
        const a = { x: 0 }, b = { x: 0 }, c = { x: 0 };
        tween(a).to(1, { x: 1 }).start();
        const tb = tween(b).to(1, { x: 1 }); tb.tag = 7; tb.start();
        tween(c).to(1, { x: 1 }).start();
        Tween.stopAllByTarget(a);
        Tween.stopAllByTag(7);
        run(1, 10);
        expect([a.x, b.x, c.x]).toEqual([0, 0, 1]);
    });

    it('restarts from the beginning when started again', () => {
        const o = { x: 0 };
        const t = tween(o).to(1, { x: 10 }).start();
        run(0.5, 5);
        t.start();
        expect(t.isRunning).toBe(true);
        run(0.5, 5);
        // the second run began its own clock, from the value it found (5): half of the way from there to 10
        expect(o.x).toBeCloseTo(7.5, 5);
    });

    it('can be paused and resumed', () => {
        const o = { x: 0 };
        const t = tween(o).to(1, { x: 1 }).start();
        run(0.5, 5);
        t.pause();
        run(5, 50);
        expect(o.x).toBeCloseTo(0.5, 5);
        t.resume();
        run(0.5, 5);
        expect(o.x).toBe(1);
    });

    it('keeps one throwing callback from stopping the others', () => {
        const a = { x: 0 }, b = { x: 0 };
        tween(a).call(() => { throw new Error('boom'); }).start();
        tween(b).to(1, { x: 1 }).start();
        run(1, 10);
        expect(b.x).toBe(1);
    });
});

describe('tween values', () => {
    it('interpolates vectors and colours per component, and assigns a new value back', () => {
        const o = { position: new Vec3(0, 0, 0), color: new Color(0, 0, 0, 255) };
        const before = o.position;
        tween(o).to(1, { position: new Vec3(10, 20, 30), color: new Color(200, 100, 0, 255) }).start();
        run(0.5, 5);
        expect([o.position.x, o.position.y, o.position.z]).toEqual([5, 10, 15]);
        expect(o.position).not.toBe(before);   // an accessor on a Node sees every write
        expect([o.color.r, o.color.g]).toEqual([100, 50]);
    });

    it('lets the target\'s own start value be anything the property returns, without changing it as it moves', () => {
        const start = new Vec3(1, 1, 1);
        const o = { position: start };
        tween(o).by(1, { position: new Vec3(1, 1, 1) }).start();
        run(1, 10);
        expect(start.x).toBe(1);
        expect(o.position.x).toBe(2);
    });
});
