// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    jobs.ts
 * @brief   Work done off the main thread: a pool of workers that answer questions, and nothing else.
 *
 * @details Generating a world is computation, and computation on the main thread is a frame that is not drawn however it is sliced. A pool starts workers from
 *          the text of a script (so nothing depends on where a file is served from), sends each job to one of them and answers with a Promise. The main thread's
 *          part is only to take the answer and put it in the world.
 *
 *          A job names the worker it wants by `affinity` (a number, taken modulo the pool's size), so the jobs that share what a worker keeps (a plan that has
 *          already worked out a layer) go to the same one. A host with no Worker has no pool: `createJobPool` answers null and the caller does its work in place.
 */

/** A pool of workers. */
export interface JobPool {
    /** How many workers there are. */
    readonly size: number;
    /** How many jobs are out, and how many have been answered. */
    readonly inFlight: number;
    readonly done: number;
    /**
     * Sends `message` to the worker `affinity` names and answers with what it sends back; rejects with its error. A worker is given a few jobs at a
     * time and the rest wait here, an `urgent` one ahead of those that are not: what the eye is waiting on (the ground under it) is not kept
     * behind a long line of what it is not (the plants a kilometre off).
     */
    run<T>(affinity: number, message: Record<string, unknown>, transfer?: Transferable[], urgent?: boolean): Promise<T>;
    /** Stops the workers; jobs still out are rejected. */
    dispose(): void;
}

/**
 * How many workers to start: the cores beside the main thread's and the render's, at most four, on a machine of eight cores or fewer (a phone,
 * whose cores are not all alike and all heat it); on a larger one half its cores, at most eight, since four of twenty left the ground a
 * fast ship flies over a long way behind her.
 */
export function defaultWorkerCount(): number {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 2 : 2;
    return cores <= 8 ? Math.max(1, Math.min(4, cores - 2)) : Math.min(8, Math.floor(cores / 2));
}

/**
 * The worker a job goes to when a pool is shared by the ground under the eye and by everything else: the ground has the first half of the
 * workers to itself and the rest have the other half, `key` choosing among them. A long job of the one kind then never stands in front of
 * the other: sharing every worker, the pages of a planet's ground waited behind the laying out of its plants, a third of a second a page.
 * A pool of one has one worker for both.
 */
export function workerLane(pool: Pick<JobPool, 'size'>, key: number, ground: boolean): number {
    const half = pool.size >> 1, k = Math.abs(Math.trunc(key));
    if (half === 0) return 0;
    return ground ? k % half : half + k % (pool.size - half);
}

/** Starts a pool from the text of a worker script, or answers null where this realm has no Worker. */
export function createJobPool(script: string, size = defaultWorkerCount()): JobPool | null {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const workers: Worker[] = [];
    interface Waiting { id: number; message: Record<string, unknown>; transfer: Transferable[] }
    // What waits for each worker, the urgent ahead of the rest, and how many jobs the worker has now. It has a few and not one: an answer is
    // read here between frames, so a worker given one job at a time would stand idle for the rest of every frame.
    const AT_ONCE = 3;
    const lines: { urgent: Waiting[]; rest: Waiting[]; busy: number }[] = [];
    const next = (i: number): void => {
        const line = lines[i]!;
        while (line.busy < AT_ONCE) {
            const job = line.urgent.shift() ?? line.rest.shift();
            if (!job) return;
            line.busy++;
            workers[i]!.postMessage({ ...job.message, id: job.id }, job.transfer);
        }
    };
    const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
    let nextId = 1, inFlight = 0, done = 0, dead = false;
    const fail = (e: Error): void => {
        for (const p of pending.values()) p.reject(e);
        pending.clear();
        inFlight = 0;
        for (const line of lines) { line.urgent.length = 0; line.rest.length = 0; line.busy = 0; }
    };
    try {
        for (let i = 0; i < Math.max(1, size); i++) {
            const w = new Worker(url);
            lines.push({ urgent: [], rest: [], busy: 0 });
            w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
                lines[i]!.busy = Math.max(0, lines[i]!.busy - 1);
                next(i);
                const p = pending.get(e.data.id);
                if (!p) return;
                pending.delete(e.data.id);
                inFlight--; done++;
                if (e.data.error !== undefined) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
            };
            w.onerror = (e) => { dead = true; fail(new Error(`a job worker failed: ${e.message}`)); };
            workers.push(w);
        }
    } finally {
        URL.revokeObjectURL(url);
    }
    return {
        size: workers.length,
        get inFlight() { return inFlight; },
        get done() { return done; },
        run<T>(affinity: number, message: Record<string, unknown>, transfer: Transferable[] = [], urgent = false): Promise<T> {
            if (dead) return Promise.reject(new Error('the job workers have stopped'));
            const id = nextId++;
            return new Promise<T>((resolve, reject) => {
                pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
                inFlight++;
                const i = ((affinity % workers.length) + workers.length) % workers.length;
                (urgent ? lines[i]!.urgent : lines[i]!.rest).push({ id, message, transfer });
                next(i);
            });
        },
        dispose() {
            for (const w of workers) w.terminate();
            dead = true;
            fail(new Error('the job pool was disposed'));
        },
    };
}
