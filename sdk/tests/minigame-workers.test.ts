// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The engine's job workers on a mini-game host: the packaged file and the factory, through a host that behaves as WeChat's does.
 *
 * The stand-in host runs the generated worker file with a `worker` global and no `self`, one worker at a time, and hands messages over
 * a task later as copies. What a device adds (a real second thread, its message serializer) is not here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobs, createJobPool, setJobWorkerFactory } from '../src/runtime/jobs';
import {
    MINIGAME_WORKER_ENTRY, miniGameWorkerFactory, miniGameWorkerFile, versionAtLeast, type MiniGameWorker, type MiniGameWorkerHost,
} from '../src/platform/minigame/workers';
import { SOUND_WORKER_SOURCE } from '../src/sound/soundWorkerBundle.generated';
import { PLAN_WORKER_SOURCE } from '../src/runtime/planWorkerBundle.generated';
import { makeSound, type SoundJob } from '../src/sound/soundWorker';

const DOUBLE = 'self.onmessage = (e) => self.postMessage({ id: e.data.id, result: e.data.n * 2 });';
/** Keeps a count in the worker: two pools of it must not share one. */
const COUNTER = 'let count = 0; self.onmessage = (e) => self.postMessage({ id: e.data.id, result: ++count });';

afterEach(() => setJobWorkerFactory(null));

/** A host as WeChat's: workers from files, at most one alive, a base library version. */
function host(files: Record<string, string>, version = '3.4.0') {
    const state = { alive: 0, made: 0, kill: (): void => {}, last: null as MiniGameWorker | null };
    const h: MiniGameWorkerHost = {
        getSystemInfoSync: () => ({ SDKVersion: version }),
        createWorker(scriptPath) {
            if (state.alive > 0) throw new Error('at most one worker');
            const text = files[scriptPath];
            if (text === undefined) throw new Error(`no worker file at ${scriptPath}`);
            state.alive++; state.made++;
            let toMain: ((res: unknown) => void) | null = null, toWorker: ((res: unknown) => void) | null = null, killed: (() => void) | null = null;
            let stopped = false;
            const inside = {
                onMessage(cb: (res: unknown) => void) { toWorker = cb; },
                postMessage(m: unknown) { const copy = structuredClone(m); setTimeout(() => { if (!stopped) toMain?.(copy); }, 0); },
            };
            new Function('worker', text)(inside);
            const w: MiniGameWorker = {
                onMessage(cb) { toMain = cb; },
                postMessage(m) { const copy = structuredClone(m); setTimeout(() => { if (!stopped) toWorker?.(copy); }, 0); },
                terminate() { if (!stopped) { stopped = true; state.alive--; } },
                onProcessKilled(cb) { killed = cb; },
            };
            state.kill = () => { stopped = true; state.alive--; killed?.(); };
            state.last = w;
            return w;
        },
    };
    return { h, state };
}

describe('the packaged worker file', () => {
    it('runs a pool through the one worker, with `self` as the script expects', async () => {
        const { h } = host({ [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ double: DOUBLE }) });
        setJobWorkerFactory(miniGameWorkerFactory(h, ['double']));
        const jobs = createJobs<{ n: number }, number>({ name: 'double', script: 'ignored: the package carries it', here: () => -1 });
        expect(jobs.onWorkers).toBe(true);
        expect(await Promise.all([1, 2, 3].map((n) => jobs.run({ n })))).toEqual([2, 4, 6]);
    });

    it('gives every pool a channel of its own, so two pools of one kind keep their own state', async () => {
        const { h, state } = host({ [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ count: COUNTER, double: DOUBLE }) });
        setJobWorkerFactory(miniGameWorkerFactory(h, ['count', 'double']));
        const a = createJobPool('x', 4, { name: 'count' })!, b = createJobPool('x', 4, { name: 'count' })!;
        const d = createJobPool('x', 4, { name: 'double' })!;
        // However many a pool asks for, the host allows one worker: each pool is one channel of it.
        expect(a.size).toBe(1);
        expect(state.made).toBe(1);
        expect(await a.run(0, {})).toBe(1);
        expect(await a.run(0, {})).toBe(2);
        expect(await b.run(0, {})).toBe(1);
        expect(await d.run(0, { n: 5 })).toBe(10);
        a.dispose(); b.dispose();
        expect(state.alive).toBe(1);
        // The last pool gone lets the worker go, and the next pool starts it again.
        d.dispose();
        expect(state.alive).toBe(0);
        const again = createJobPool('x', 1, { name: 'double' })!;
        expect(await again.run(0, { n: 4 })).toBe(8);
        expect(state.made).toBe(2);
        again.dispose();
    });

    it('starts no pool for a kind the package does not carry, nor on a base library older than 2.20.2', () => {
        const files = { [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ double: DOUBLE }) };
        setJobWorkerFactory(miniGameWorkerFactory(host(files).h, ['double']));
        expect(createJobPool('x', 1, { name: 'sound' })).toBeNull();
        setJobWorkerFactory(miniGameWorkerFactory(host(files, '2.20.1').h, ['double']));
        expect(createJobPool('x', 1, { name: 'double' })).toBeNull();
        setJobWorkerFactory(miniGameWorkerFactory({ createWorker: host(files).h.createWorker }, ['double']));
        expect(createJobPool('x', 1, { name: 'double' })).toBeNull();
        setJobWorkerFactory(miniGameWorkerFactory({ getSystemInfoSync: () => ({ SDKVersion: '3.0.0' }) }, ['double']));
        expect(createJobPool('x', 1, { name: 'double' })).toBeNull();
    });

    it('answers lost for a kind the factory was told of and the file does not carry, and the jobs are done here', async () => {
        const { h } = host({ [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ double: DOUBLE }) });
        setJobWorkerFactory(miniGameWorkerFactory(h, ['double', 'triple']));
        const lost = vi.fn();
        const jobs = createJobs<{ n: number }, number>({ name: 'triple', script: 'x', here: (m) => m.n * 3, onLost: lost });
        expect(await jobs.run({ n: 2 })).toBe(6);
        expect(lost).toHaveBeenCalledTimes(1);
        expect(jobs.onWorkers).toBe(false);
    });

    it('does the jobs here once the host takes the worker back, and starts no other', async () => {
        const { h, state } = host({ [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ double: DOUBLE }) });
        setJobWorkerFactory(miniGameWorkerFactory(h, ['double']));
        const lost = vi.fn();
        const jobs = createJobs<{ n: number }, number>({ name: 'double', script: 'x', here: (m) => m.n * 20, onLost: lost });
        expect(await jobs.run({ n: 1 })).toBe(2);
        const out = jobs.run({ n: 2 });
        state.kill();
        expect(await out).toBe(40);
        expect(lost).toHaveBeenCalledTimes(1);
        expect(createJobPool('x', 1, { name: 'double' })).toBeNull();
    });

    it("runs the engine's sound worker as packaged, answering what the main thread makes", async () => {
        const { h } = host({ [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ sound: SOUND_WORKER_SOURCE }) });
        setJobWorkerFactory(miniGameWorkerFactory(h, ['sound']));
        const job: SoundJob = { source: JSON.stringify({ duration: 0.1, layers: [{ source: 'sine', freq: 880, decay: 0.05 }] }), path: 'assets/chime.essound', files: {} };
        const jobs = createJobs<SoundJob, ArrayBuffer>({ name: 'sound', script: 'x', here: () => { throw new Error('done here'); } });
        const wav = await jobs.run(job);
        expect(new Uint8Array(wav)).toEqual(new Uint8Array(makeSound(job)));
    });

    it("finds the planning worker's test for a worker true, so it listens", async () => {
        const { h } = host({ [MINIGAME_WORKER_ENTRY]: miniGameWorkerFile({ plan: PLAN_WORKER_SOURCE }) });
        setJobWorkerFactory(miniGameWorkerFactory(h, ['plan']));
        const pool = createJobPool('x', 1, { name: 'plan' })!;
        // A question it cannot answer is answered with an error, not with silence: its onmessage was installed.
        await expect(pool.run(0, { type: 'no-such-question' })).rejects.toThrow();
        pool.dispose();
    });
});

describe('versionAtLeast', () => {
    it('compares dotted numbers', () => {
        expect(versionAtLeast('2.20.2', '2.20.2')).toBe(true);
        expect(versionAtLeast('2.21', '2.20.2')).toBe(true);
        expect(versionAtLeast('2.3.10', '2.20.2')).toBe(false);
        expect(versionAtLeast('3.0.0', '2.20.2')).toBe(true);
    });
});
