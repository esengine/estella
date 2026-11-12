// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { Bakes, finish, type WorkJob } from '../src/runtime/bakes';

function* counting(steps: number): WorkJob<string> {
    for (let i = 0; i < steps; i++) yield i / steps;
    return 'done';
}

/** A clock that moves a millisecond each time it is read. */
const ticking = (): (() => number) => { let t = 0; return () => t++; };

describe('jobs spread over frames', () => {
    it('step for the budget of a frame, show their progress, and settle with what they made', async () => {
        const bakes = new Bakes();
        bakes.budgetMs = 3;
        const job = bakes.run('Counting', counting(10));
        bakes.step(ticking());
        expect(bakes.active).toHaveLength(1);
        expect(bakes.active[0]!.label).toBe('Counting');
        expect(bakes.active[0]!.progress).toBeGreaterThan(0);
        expect(bakes.active[0]!.progress).toBeLessThan(1);
        for (let f = 0; f < 10; f++) bakes.step(ticking());
        await expect(job.done).resolves.toBe('done');
        expect(bakes.active).toHaveLength(0);
    });

    it('stop when cancelled, and show marks of work stepped elsewhere until they are done', () => {
        const bakes = new Bakes();
        const job = bakes.run('Never', counting(1000));
        job.cancel();
        expect(bakes.active).toHaveLength(0);
        const owner = {};
        bakes.mark(owner, 'Building', 0.25);
        expect(bakes.active).toEqual([{ label: 'Building', progress: 0.25 }]);
        bakes.mark(owner, 'Building', 1);
        expect(bakes.active).toHaveLength(0);
    });

    it('reject when the job throws', async () => {
        const bakes = new Bakes();
        const job = bakes.run('Broken', (function* () { yield 0; throw new Error('no'); })());
        bakes.step(ticking());
        bakes.step(ticking());
        await expect(job.done).rejects.toThrow('no');
    });

    it('run to their end at once for a caller with no frames', () => {
        expect(finish(counting(5))).toBe('done');
    });
});

/** A clock the test moves by hand. */
const manual = () => { let t = 0; return { now: () => t, spend: (ms: number) => { t += ms; } }; };

/** Works in 1 ms pieces for as long as it is given time, as the engine's steppers do: one piece whatever it is told (what stands by the
 *  player is made at once), then while it may. Returns how many it got through, which is that first piece and its part of the frame. */
const work = (bakes: Bakes, owner: object, clock: { spend(ms: number): void }, max = 1000): number => {
    let done = 0;
    do { clock.spend(1); done++; } while (done < max && bakes.hasTime(owner));
    return done;
};

// The ground's far pages, asked first each frame, took the whole budget for half a minute while the chunks and the plants
// beside the player had none of it.
describe('the frame budget is shared', () => {
    it('gives each of those that asked the frame before an equal part, whoever runs first', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 9;
        const clock = manual();
        const terrain = {}, chunks = {}, plants = {};
        // The first frame nobody is known yet, so the first to ask is given all of it.
        bakes.step(clock.now);
        expect(work(bakes, terrain, clock)).toBe(1 + 9);
        work(bakes, chunks, clock); work(bakes, plants, clock);
        // From then on each is expected, and the three share.
        for (let frame = 0; frame < 3; frame++) {
            bakes.step(clock.now);
            expect([work(bakes, terrain, clock), work(bakes, chunks, clock), work(bakes, plants, clock)]).toEqual([1 + 3, 1 + 3, 1 + 3]);
        }
    });

    it('passes on what one does not use to those after it', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 9;
        const clock = manual();
        const terrain = {}, chunks = {}, plants = {};
        bakes.step(clock.now);
        work(bakes, terrain, clock); work(bakes, chunks, clock); work(bakes, plants, clock);
        bakes.step(clock.now);
        // The terrain has two pieces left to make and is done as soon as it has asked: the other two share nearly all of the frame,
        // where a third each would have left three milliseconds unused. The chunks have 4.5 ms and stop at 4, a fifth piece not
        // fitting; the plants have the 5 that leaves.
        expect(work(bakes, terrain, clock, 2)).toBe(2);
        expect(work(bakes, chunks, clock)).toBe(1 + 4);
        expect(work(bakes, plants, clock)).toBe(1 + 5);
    });

    it('gives all of it back to one that is left asking alone', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        const clock = manual();
        const terrain = {}, chunks = {};
        bakes.step(clock.now);
        work(bakes, terrain, clock); work(bakes, chunks, clock);
        bakes.step(clock.now);
        expect(work(bakes, terrain, clock)).toBe(1 + 4);
        // The chunks are done and do not ask: the frame after, the terrain is alone.
        bakes.step(clock.now);
        expect(work(bakes, terrain, clock)).toBe(1 + 8);
    });

    it('never gives the work stepped elsewhere more than the frame has, however many ask', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        const clock = manual();
        const owners = [{}, {}, {}, {}, {}];
        bakes.step(clock.now);
        for (const o of owners) work(bakes, o, clock);
        for (let frame = 0; frame < 4; frame++) {
            bakes.step(clock.now);
            const before = clock.now();
            for (const o of owners) work(bakes, o, clock);
            // Each does one piece whatever it is told, so five owners may run a piece each past their part.
            expect(clock.now() - before).toBeLessThanOrEqual(8 + owners.length);
        }
    });
});

describe('a piece that would not fit', () => {
    // A cell of grass takes about as long to build as the whole steady budget. Asked only whether time was left, its stepper
    // built two or three a frame.
    it('is left for the next frame once the owner has had its one', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        const clock = manual();
        const grass = {};
        const cells = (): number => { let made = 0; while (bakes.hasTime(grass)) { clock.spend(8); made++; } return made; };
        bakes.step(clock.now);
        // The first frame it is not known how long a cell takes: the second ask finds time gone already.
        expect(cells()).toBe(1);
        for (let frame = 0; frame < 4; frame++) { bakes.step(clock.now); expect(cells()).toBe(1); }
    });

    it('still gives one piece to an owner whose part is smaller than a piece', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        const clock = manual();
        const grass = {}, others = [{}, {}, {}];
        const cells = (): number => { let made = 0; while (bakes.hasTime(grass)) { clock.spend(8); made++; } return made; };
        // The first frame nobody is expected, and whoever asks first has all of it.
        bakes.step(clock.now);
        for (const o of others) work(bakes, o, clock);
        cells();
        for (let frame = 0; frame < 4; frame++) {
            bakes.step(clock.now);
            for (const o of others) work(bakes, o, clock);
            // A quarter of the frame is 2 ms and a cell is 8: one is made all the same, or none ever would be.
            expect(cells()).toBe(1);
        }
    });

    it('fits as many small pieces as the part holds', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        const clock = manual();
        const pages = {};
        const made = (): number => { let n = 0; while (bakes.hasTime(pages)) { clock.spend(2); n++; } return n; };
        bakes.step(clock.now); made();
        bakes.step(clock.now);
        expect(made()).toBe(4);
    });
});

describe('work the player would see missing', () => {
    it('is given more of the frame until it says it is done', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        bakes.priorityExtraMs = 12;
        const clock = manual();
        const chunks = {};
        expect(bakes.urgent).toBe(false);
        bakes.urge(chunks, true);
        expect(bakes.urgent).toBe(true);
        bakes.step(clock.now);
        expect(work(bakes, chunks, clock)).toBe(1 + 20);
        bakes.urge(chunks, false);
        bakes.step(clock.now);
        expect(work(bakes, chunks, clock)).toBe(1 + 8);
        // An owner that goes away does not hold the frame at the larger budget.
        bakes.urge(chunks, true);
        bakes.clear(chunks);
        expect(bakes.frameBudgetMs).toBe(8);
    });
});

describe('an owner whose pieces are not alike', () => {
    it('is held to its longest piece lately, not to a mean the empty ones pull down', () => {
        const bakes = new Bakes();
        bakes.budgetMs = 8;
        const clock = manual();
        const chunks = {};
        // Five chunks wanted a frame: empty ones that cost nothing, and cells of grass at 8 ms each.
        const frame = (costs: number[]): number => { let spent = 0; for (const c of costs) { if (!bakes.hasTime(chunks)) break; clock.spend(c); spent += c; } return spent; };
        bakes.step(clock.now); frame([0, 0, 8, 0, 0]);
        for (let f = 0; f < 6; f++) {
            bakes.step(clock.now);
            // One cell of grass a frame, whatever stands before it in the list.
            expect(frame([0, 0, 8, 8, 8])).toBe(8);
        }
    });
});
