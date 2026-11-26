// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    jobs.ts
 * @brief   Work done off the main thread where the host can, and inside the frame's budget where it cannot: one way to ask for both.
 *
 * @details Generating a world, transcoding a texture, rendering a sound are computation, and computation on the main thread is a frame
 *          that is not drawn however it is sliced. So such work is sent to workers, which answer with a Promise; the main thread's part is
 *          only to take the answer and put it in the world.
 *
 *          Not every host has workers. A browser does; a mini-game host has one kind of its own (a file in the package, not a script's
 *          text); node and an old WebView have none. How a worker is started is therefore the host's to say ({@link setJobWorkerFactory}),
 *          and the default starts browser workers from a script's text, so nothing depends on where a file is served from.
 *
 *          Where there are no workers, or they have failed, the same job is done here: {@link createJobs} is given the function that does
 *          it on this thread, and each job waits for a turn inside the frame's budget before it runs ({@link setMainThreadGate}; the App's
 *          `Bakes` is that budget). A job of many pieces returns a {@link WorkJob} and is given a turn for each. Without that, the hosts
 *          with the least to spare (a phone's mini-game) were the ones that did every job at once: a scene of three hundred textures was
 *          one frame of nine seconds.
 *
 *          {@link createJobPool} is the workers alone, for callers whose work done here is already spread over frames their own way (a
 *          world laid out a chunk at a time within the frame's budget); it answers null where there are none.
 *
 *          A job names the worker it wants by `affinity` (a number, taken modulo the pool's size), so the jobs that share what a worker keeps
 *          (a plan that has already worked out a layer) go to the same one; a negative affinity takes the worker with the least to do.
 */
import type { WorkJob } from './bakes';

/** What a pool needs of a worker: a browser `Worker` is one, and a host with workers of its own kind wraps them as one. */
export interface JobWorker {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((e: { data: unknown }) => void) | null;
    onerror: ((e: { message?: string }) => void) | null;
}

/**
 * Starts `count` workers running `script`, or answers null where this host has none. `name` says which script it is (`plan`, `basis`,
 * `sound`...), for a host whose workers are files packaged under a name rather than text. A host may start fewer than asked (a
 * mini-game host allows one); the pool is as large as what it is given.
 */
export type JobWorkerFactory = (script: string, name: string, count: number) => JobWorker[] | null;

/** Browser workers from a script's text. */
const textWorkers: JobWorkerFactory = (script, _name, count) => {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const started: JobWorker[] = [];
    try {
        for (let i = 0; i < count; i++) started.push(new Worker(url) as unknown as JobWorker);
    } catch (e) {
        for (const w of started) w.terminate();
        // A host that has Worker and refuses this one (a policy against blob workers) has none to give.
        if (started.length === 0) return null;
        throw e;
    } finally {
        URL.revokeObjectURL(url);
    }
    return started;
};

let workerFactory: JobWorkerFactory = textWorkers;

/** Says how this host starts workers; null puts back the default (browser workers from a script's text). Pools already started keep theirs. */
export function setJobWorkerFactory(factory: JobWorkerFactory | null): void {
    workerFactory = factory ?? textWorkers;
}

/** Why a job did not come back from a worker when the job itself was not at fault: the worker failed, or the pool was stopped. */
export class JobWorkerLost extends Error {
    constructor(message: string, readonly reason: 'failed' | 'disposed') {
        super(message);
        this.name = 'JobWorkerLost';
    }
}

/** A pool of workers. */
export interface JobPool {
    /** How many workers there are. */
    readonly size: number;
    /** How many jobs are out, and how many have been answered. */
    readonly inFlight: number;
    readonly done: number;
    /**
     * Sends `message` to the worker `affinity` names (negative: the one with the least to do) and answers with what it sends back; rejects
     * with its error, or with {@link JobWorkerLost} when the worker is gone. A worker is given a few jobs at a time and the rest wait here,
     * an `urgent` one ahead of those that are not: what the eye is waiting on (the ground under it) is not kept behind a long line of what
     * it is not (the plants a kilometre off).
     */
    run<T>(affinity: number, message: Record<string, unknown>, transfer?: Transferable[], urgent?: boolean): Promise<T>;
    /** Stops the workers; jobs still out are rejected. */
    dispose(): void;
}

/** What a pool may be told besides its script. */
export interface JobPoolOptions {
    /** Which script it is, for a host that packages workers by name. */
    name?: string;
    /** What each worker is sent before any job (a module to instantiate), asked once per worker so each can be handed its own copy. */
    greet?: () => { message: Record<string, unknown>; transfer?: Transferable[] };
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

/**
 * Starts a pool of workers running `script`, or answers null where this host has none.
 *
 * A worker answers `{ id, result }` or `{ id, error }`; one that can do no job at all (its module would not start) answers `{ id, error,
 * lost: true }`, and the pool is then treated as failed, as when a worker throws outside a job.
 */
export function createJobPool(script: string, size = defaultWorkerCount(), options: JobPoolOptions = {}): JobPool | null {
    const workers = workerFactory(script, options.name ?? 'jobs', Math.max(1, size));
    if (!workers || workers.length === 0) return null;
    interface Waiting { id: number; message: Record<string, unknown>; transfer: Transferable[] }
    // What waits for each worker, the urgent ahead of the rest, and how many jobs the worker has now. It has a few and not one: an answer is
    // read here between frames, so a worker given one job at a time would stand idle for the rest of every frame.
    const AT_ONCE = 3;
    const lines: { urgent: Waiting[]; rest: Waiting[]; busy: number }[] = workers.map(() => ({ urgent: [], rest: [], busy: 0 }));
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
    const lose = (why: string): void => {
        dead = true;
        fail(new JobWorkerLost(`a job worker failed: ${why}`, 'failed'));
    };
    workers.forEach((w, i) => {
        w.onmessage = (e) => {
            const data = e.data as { id: number; result?: unknown; error?: string; lost?: boolean };
            if (data.lost) { lose(data.error ?? 'it cannot do jobs'); return; }
            lines[i]!.busy = Math.max(0, lines[i]!.busy - 1);
            next(i);
            const p = pending.get(data.id);
            if (!p) return;
            pending.delete(data.id);
            inFlight--; done++;
            if (data.error !== undefined) p.reject(new Error(data.error)); else p.resolve(data.result);
        };
        // A worker whose script will not even start answers nothing; without this its jobs wait for good.
        w.onerror = (e) => lose(e.message || 'the worker stopped');
        if (options.greet) {
            const hello = options.greet();
            w.postMessage(hello.message, hello.transfer ?? []);
        }
    });
    const idlest = (): number => {
        let best = 0, least = Infinity;
        lines.forEach((l, i) => {
            const load = l.busy + l.urgent.length + l.rest.length;
            if (load < least) { least = load; best = i; }
        });
        return best;
    };
    return {
        size: workers.length,
        get inFlight() { return inFlight; },
        get done() { return done; },
        run<T>(affinity: number, message: Record<string, unknown>, transfer: Transferable[] = [], urgent = false): Promise<T> {
            if (dead) return Promise.reject(new JobWorkerLost('the job workers have stopped', 'failed'));
            const id = nextId++;
            return new Promise<T>((resolve, reject) => {
                pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
                inFlight++;
                const i = affinity < 0 ? idlest() : affinity % workers.length;
                (urgent ? lines[i]!.urgent : lines[i]!.rest).push({ id, message, transfer });
                next(i);
            });
        },
        dispose() {
            for (const w of workers) w.terminate();
            dead = true;
            fail(new JobWorkerLost('the job pool was disposed', 'disposed'));
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The main thread's turns
// ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * The frame's budget, as jobs done here see it. The App's `Bakes` is one: the same milliseconds the world's streaming and the bakes spend,
 * so jobs done here are one more owner sharing them, not a second budget beside it.
 */
export interface MainThreadGate {
    /** Answers when `owner` may run work inside a frame's budget (the next frame's, when this one is spent). */
    turn(owner: object): Promise<void>;
    /** Whether `owner` may run one more piece in this frame; asked before each piece, it is also how the cost of a piece is learned. */
    hasTime(owner: object): boolean;
    /** Whether frames are being stepped now; when they are not (paused, hidden, quit) a turn would never come. */
    stepping(): boolean;
}

let gate: MainThreadGate | null = null;

/**
 * Sets the budget that jobs done here wait their turn in; answers what puts the previous one back. With none (a tool, a test) a job
 * done here runs a task after it is asked for, one piece a task.
 */
export function setMainThreadGate(next: MainThreadGate | null): () => void {
    const before = gate;
    gate = next;
    drain();
    return () => {
        if (gate === next) {
            gate = before;
            drain();
        }
    };
}

/** How long a job done here waits for a turn before it runs anyway: frames that stop after it asked must not keep it waiting for good. */
const TURN_WAIT_MS = 250;

/** What jobs done here have cost, piece by piece: the number a check holds against the frame's budget. */
export interface MainThreadJobStats {
    pieces: number;
    totalMs: number;
    longestMs: number;
    /** The `name` of the jobs whose piece was longest. */
    longestName: string;
}

const stats: MainThreadJobStats = { pieces: 0, totalMs: 0, longestMs: 0, longestName: '' };

/** What jobs done here have cost since the last reset. */
export function mainThreadJobStats(): Readonly<MainThreadJobStats> {
    return { ...stats };
}

export function resetMainThreadJobStats(): void {
    stats.pieces = 0; stats.totalMs = 0; stats.longestMs = 0; stats.longestName = '';
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function isWorkJob(v: unknown): v is WorkJob<unknown> {
    return typeof v === 'object' && v !== null && typeof (v as { next?: unknown }).next === 'function'
        && typeof (v as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

/** A piece waiting to run here: the job's first call, or the next step of a job of many pieces. */
interface Piece {
    name: string;
    run: () => void;
}

/**
 * Every job done here waits in one line, whatever kind it is: the budget is asked about one piece at a time, so the cost it learns is a
 * piece's and a frame never lets through more than it has time for. Separate lines would each be given a first piece a frame, and a
 * frame with ten kinds waiting would run ten.
 */
const urgentLine: Piece[] = [];
const line: Piece[] = [];
/** Who the budget is asked for: the jobs done here are one owner. */
const HERE = {};
let draining = false;

function enqueue(piece: Piece, urgent: boolean): void {
    (urgent ? urgentLine : line).push(piece);
    drain();
}

function waitForTurn(g: MainThreadGate): Promise<void> {
    if (!g.stepping()) return new Promise((go) => setTimeout(go, 0));
    return new Promise<void>((go) => {
        let open = true;
        const timer = setTimeout(() => {
            if (open) {
                open = false;
                go();
            }
        }, TURN_WAIT_MS);
        void g.turn(HERE).then(() => {
            if (open) {
                open = false;
                clearTimeout(timer);
                go();
            }
        });
    });
}

function drain(): void {
    if (draining) return;
    draining = true;
    void (async () => {
        try {
            // A task first: whoever asked goes on with what it was doing, and the job never runs inside the call that asked for it.
            await new Promise((go) => setTimeout(go, 0));
            // A turn given (or waited out) runs the next piece whatever the budget says after: when the frames stop after it asked, the
            // frame it asked in stays spent, and asking again would refuse it every quarter second for good.
            let given = false;
            while (urgentLine.length + line.length > 0) {
                const g = gate;
                if (g && g.stepping()) {
                    // Asked even after a turn: it starts this frame's account, and that is how the cost of a piece is learned.
                    const room = g.hasTime(HERE);
                    if (!room && !given) { await waitForTurn(g); given = true; continue; }
                }
                given = false;
                const piece = (urgentLine.shift() ?? line.shift())!;
                const start = now();
                piece.run();
                const ms = now() - start;
                stats.pieces++;
                stats.totalMs += ms;
                if (ms > stats.longestMs) { stats.longestMs = ms; stats.longestName = piece.name; }
                // With no frames to share, one piece a task, so the host still answers between them.
                if (!g || !g.stepping()) await new Promise((go) => setTimeout(go, 0));
            }
        } finally {
            draining = false;
        }
    })();
}

/** Does `here(message)` on this thread, a piece per turn of the frame's budget. */
function doHere<M, R>(name: string, here: (message: M) => R | Promise<R> | WorkJob<R>, message: M, urgent: boolean): Promise<R> {
    return new Promise<R>((resolve, reject) => {
        const stepOf = (job: WorkJob<R>): Piece => ({
            name,
            run: () => {
                try {
                    const step = job.next();
                    if (step.done) resolve(step.value as R);
                    else enqueue(stepOf(job), urgent);
                } catch (e) { reject(e); }
            },
        });
        enqueue({
            name,
            run: () => {
                try {
                    const made = here(message);
                    if (isWorkJob(made)) enqueue(stepOf(made as WorkJob<R>), urgent);
                    else Promise.resolve(made).then(resolve, reject);
                } catch (e) { reject(e); }
            },
        }, urgent);
    });
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Jobs: on workers, or here in turns
// ---------------------------------------------------------------------------------------------------------------------------------------

/** What {@link createJobs} is told. */
export interface JobsOptions<M extends object, R> {
    /** Which jobs these are: the worker's name for a host that packages workers by name, and what the cost of a piece is reported under. */
    name: string;
    /** The worker's script; none, and every job is done here. */
    script?: string | null;
    /** How many workers to ask for. */
    size?: number;
    /** What each worker is sent before any job. */
    greet?: JobPoolOptions['greet'];
    /**
     * Does a job on this thread: where there are no workers, after they have failed, or when the worker refused it as one only this
     * thread can do (`doHere`). A job of many pieces returns a generator and is given a turn for each piece.
     */
    here: (message: M) => R | Promise<R> | WorkJob<R>;
    /** Whether an error a worker answered means "do it here" rather than "this job is wrong". */
    doHere?: (error: Error) => boolean;
    /** Told once, when the workers fail and every job from then on is done here. */
    onLost?: (error: JobWorkerLost) => void;
}

/** Jobs of one kind. */
export interface Jobs<M extends object, R> {
    /** Whether jobs go to workers now (false: done here, in turns). */
    readonly onWorkers: boolean;
    /**
     * Does `message`'s job and answers what it made. `transfer` is handed to the worker; a job whose buffers were handed over cannot be
     * done again here when the worker fails, and rejects with {@link JobWorkerLost} instead.
     */
    run(message: M, options?: { affinity?: number; transfer?: Transferable[]; urgent?: boolean }): Promise<R>;
    /** Stops the workers; jobs still out on them reject with {@link JobWorkerLost} (`disposed`), and so does every later one. */
    dispose(): void;
}

/** Jobs that go to workers where the host has them and are done here, a turn of the frame's budget at a time, where it has not. */
export function createJobs<M extends object, R>(options: JobsOptions<M, R>): Jobs<M, R> {
    let pool = options.script ? createJobPool(options.script, options.size, { name: options.name, greet: options.greet }) : null;
    let disposed = false;
    return {
        get onWorkers() { return pool !== null; },
        async run(message, o = {}) {
            if (disposed) throw new JobWorkerLost('the jobs were disposed', 'disposed');
            const p = pool;
            if (p) {
                try {
                    return await p.run<R>(o.affinity ?? -1, message as Record<string, unknown>, o.transfer, o.urgent);
                } catch (e) {
                    if (e instanceof JobWorkerLost) {
                        if (e.reason === 'disposed' || disposed) throw e;
                        if (pool === p) {
                            pool = null;
                            p.dispose();
                            options.onLost?.(e);
                        }
                        if (o.transfer?.length) throw e;
                    } else if (!(e instanceof Error && options.doHere?.(e))) throw e;
                }
            }
            return doHere(options.name, options.here, message, o.urgent ?? false);
        },
        dispose() {
            disposed = true;
            pool?.dispose();
            pool = null;
        },
    };
}
