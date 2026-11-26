// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Jobs where the host has no workers: done here, inside the frame's budget, and not all at once.
 *
 * Node has no Worker, which is what a mini-game host looks like to the job layer. The frames are stepped by hand on a clock that the
 * jobs themselves move, so what a frame let through is counted, not timed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bakes } from '../src/runtime/bakes';
import {
    createJobs, JobWorkerLost, mainThreadJobStats, resetMainThreadJobStats, setJobWorkerFactory, setMainThreadGate, type JobWorker,
} from '../src/runtime/jobs';

const tasks = async (n = 4): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((go) => setTimeout(go, 0)); };

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; setJobWorkerFactory(null); resetMainThreadJobStats(); });

/** A Bakes on a hand-moved clock: `frame()` is 16 ms passing and the frame being stepped. */
function frames() {
    let t = 1000;
    const bakes = new Bakes();
    restore = setMainThreadGate(bakes);
    return {
        spend(ms: number) { t += ms; },
        async frame() { t += 16; bakes.step(() => t); await tasks(); },
    };
}

describe('jobs with no workers', () => {
    it('are done here, and say so', async () => {
        const jobs = createJobs<{ n: number }, number>({ name: 'double', script: 'self.onmessage = () => {}', here: (m) => m.n * 2 });
        expect(jobs.onWorkers).toBe(false);
        expect(await jobs.run({ n: 21 })).toBe(42);
    });

    it('take a frame only as much as its budget has, however many are asked for at once', async () => {
        const clock = frames();
        await clock.frame();
        let made = 0;
        // Each costs 5 ms of an 8 ms budget: one, or at most two, a frame; never all six in the frame they were asked in.
        const jobs = createJobs<{ i: number }, number>({ name: 'heavy', here: (m) => { clock.spend(5); made++; return m.i; } });
        const all = Promise.all([0, 1, 2, 3, 4, 5].map((i) => jobs.run({ i })));
        const perFrame: number[] = [];
        for (let f = 0; f < 12 && made < 6; f++) {
            const before = made;
            await clock.frame();
            perFrame.push(made - before);
        }
        expect(await all).toEqual([0, 1, 2, 3, 4, 5]);
        expect(Math.max(...perFrame)).toBeLessThanOrEqual(2);
        expect(perFrame.length).toBeGreaterThanOrEqual(3);
        expect(mainThreadJobStats().pieces).toBe(6);
    });

    it('share one line whatever kind they are, so ten kinds waiting are not ten pieces a frame', async () => {
        const clock = frames();
        await clock.frame();
        let made = 0;
        const kinds = Array.from({ length: 10 }, (_, k) => createJobs<{ k: number }, number>({
            name: `kind${k}`, here: (m) => { clock.spend(5); made++; return m.k; },
        }));
        const all = Promise.all(kinds.map((jobs, k) => jobs.run({ k })));
        await clock.frame();
        expect(made).toBeLessThanOrEqual(2);
        for (let f = 0; f < 20 && made < 10; f++) await clock.frame();
        expect(await all).toHaveLength(10);
    });

    it('give a job of many pieces a turn for each piece', async () => {
        const clock = frames();
        await clock.frame();
        let pieces = 0;
        const jobs = createJobs<{ n: number }, string>({
            name: 'pieces',
            *here(m) { for (let i = 0; i < m.n; i++) { clock.spend(5); pieces++; yield i / m.n; } return 'done'; },
        });
        const out = jobs.run({ n: 6 });
        await clock.frame();
        expect(pieces).toBeLessThan(6);
        for (let f = 0; f < 12 && pieces < 6; f++) await clock.frame();
        expect(await out).toBe('done');
    });

    it('finish when the frames stop after they asked for a turn', async () => {
        const clock = frames();
        await clock.frame();
        const jobs = createJobs<{ n: number }, number>({ name: 'stalled', here: (m) => { clock.spend(6); return m.n; } });
        // Three asked in a stepped frame, and then no frame comes: each waits a quarter second for its turn and runs.
        expect(await Promise.all([1, 2, 3].map((n) => jobs.run({ n })))).toEqual([1, 2, 3]);
    });

    it('run anyway when the frames have stopped (a paused game, a hidden editor)', async () => {
        const clock = frames();
        await clock.frame();
        const jobs = createJobs<{ n: number }, number>({ name: 'paused', here: (m) => { clock.spend(30); return m.n; } });
        // Many frames' worth of jobs and no frame stepped: the clock moves past the quarter second and they go on.
        clock.spend(300);
        expect(await Promise.all([1, 2, 3].map((n) => jobs.run({ n })))).toEqual([1, 2, 3]);
    });

    it('reject with what the job threw', async () => {
        const jobs = createJobs<{ n: number }, number>({ name: 'bad', here: () => { throw new Error('no such recipe'); } });
        await expect(jobs.run({ n: 1 })).rejects.toThrow('no such recipe');
    });
});

/** Workers that run `answer` a task later, and can be made to fail. */
function fakeWorkers(answer: (data: Record<string, unknown>) => Record<string, unknown>) {
    const made: Array<JobWorker & { fail(): void }> = [];
    setJobWorkerFactory((_script, _name, count) => Array.from({ length: count }, () => {
        const w: JobWorker & { fail(): void; stopped: boolean } = {
            onmessage: null, onerror: null, stopped: false,
            postMessage(data) {
                setTimeout(() => { if (!w.stopped) w.onmessage?.({ data: { id: (data as { id: number }).id, ...answer(data as Record<string, unknown>) } }); }, 0);
            },
            terminate() { w.stopped = true; },
            fail() { w.onerror?.({ message: 'out of memory' }); },
        };
        made.push(w);
        return w;
    }));
    return made;
}

describe('jobs on workers', () => {
    it('go to the workers the host starts', async () => {
        fakeWorkers((d) => ({ result: (d.n as number) + 1 }));
        const jobs = createJobs<{ n: number }, number>({ name: 'inc', script: 'x', size: 2, here: () => -1 });
        expect(jobs.onWorkers).toBe(true);
        expect(await jobs.run({ n: 1 })).toBe(2);
    });

    it('are done here, once the workers fail, and the failure is told once', async () => {
        const workers = fakeWorkers(() => ({}));
        const lost = vi.fn();
        const jobs = createJobs<{ n: number }, number>({ name: 'fails', script: 'x', size: 1, here: (m) => m.n * 10, onLost: lost });
        const out = Promise.all([jobs.run({ n: 1 }), jobs.run({ n: 2 })]);
        workers[0]!.fail();
        expect(await out).toEqual([10, 20]);
        expect(await jobs.run({ n: 3 })).toBe(30);
        expect(jobs.onWorkers).toBe(false);
        expect(lost).toHaveBeenCalledTimes(1);
        expect(lost.mock.calls[0]![0]).toBeInstanceOf(JobWorkerLost);
    });

    it('treat a worker that says it cannot do jobs as failed', async () => {
        fakeWorkers(() => ({ error: 'the module would not start', lost: true }));
        const lost = vi.fn();
        const jobs = createJobs<{ n: number }, number>({ name: 'nomodule', script: 'x', size: 1, here: (m) => m.n, onLost: lost });
        expect(await jobs.run({ n: 7 })).toBe(7);
        expect(lost).toHaveBeenCalledTimes(1);
    });

    it('cannot do again here a job whose buffers were handed over', async () => {
        const workers = fakeWorkers(() => ({}));
        const jobs = createJobs<{ n: number }, number>({ name: 'moved', script: 'x', size: 1, here: (m) => m.n });
        const out = jobs.run({ n: 1 }, { transfer: [new ArrayBuffer(8)] });
        workers[0]!.fail();
        await expect(out).rejects.toBeInstanceOf(JobWorkerLost);
    });

    it('send back here a job the worker says only this thread can do, and keep the workers', async () => {
        fakeWorkers((d) => (d.text ? { error: 'no canvas' } : { result: 'worker' }));
        const jobs = createJobs<{ text: boolean }, string>({
            name: 'canvas', script: 'x', size: 1, here: () => 'here', doHere: (e) => e.message === 'no canvas',
        });
        expect(await jobs.run({ text: true })).toBe('here');
        expect(await jobs.run({ text: false })).toBe('worker');
        expect(jobs.onWorkers).toBe(true);
    });

    it('stop with dispose, and answer nothing after', async () => {
        fakeWorkers((d) => ({ result: d.n }));
        const jobs = createJobs<{ n: number }, number>({ name: 'stopped', script: 'x', here: (m) => m.n });
        const out = jobs.run({ n: 1 });
        jobs.dispose();
        await expect(out).rejects.toMatchObject({ reason: 'disposed' });
        await expect(jobs.run({ n: 2 })).rejects.toMatchObject({ reason: 'disposed' });
    });
});
