// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bakes.ts
 * @brief   Work the engine spreads over frames (a terrain worn by rain, a water zone baked, pages made), and how far along it is.
 *
 * @details A bake that runs in one go holds the frame until it is done: the editor freezes, a game's first frame waits, and nobody
 *          can say what for. So such work is a job: a generator that yields how far along it is, stepped each frame for as long as
 *          the frame can spare. Every job running is listed with its label and progress, which the editor shows in its status bar
 *          and a game can put on a loading screen.
 *
 *          The frame's budget is one, and it is here: the jobs and the work stepped elsewhere (pages made, chunks of the world built)
 *          spend the same milliseconds. The jobs run first each frame; when the rest could not finish the frame before, the jobs leave
 *          them half of it.
 *
 *          What is left is SHARED among the work stepped elsewhere, not taken by whichever system runs first. Each asks under its own
 *          name (`hasTime(owner)`) and is given an equal part of what remains when it starts; what one does not use passes to those
 *          after it. Without that the ground's far pages, asked first each frame, took every millisecond for half a minute while the
 *          trees beside the player waited for a turn that never came.
 *
 *          And the budget is not one number. Work that the player would SEE missing (the chunk they stand in, the page under their
 *          feet) says so (`urge`), and while any does the frame gives `priorityExtraMs` more: a few frames run slower so that the
 *          world is there, where a steady budget would keep the frame rate and show the hole. This is the main thread's part only —
 *          putting made things in the world. Making them is for workers, which no budget here slows.
 */
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { defineSystem, Schedule } from '../ecs/system';
import { setMainThreadGate, type MainThreadGate } from './jobs';

/** One piece of work in hand: what it is and how far along, 0 to 1. */
export interface BakeProgress {
    readonly label: string;
    readonly progress: number;
}

/** A job: yields its progress (0 to 1) whenever it may be paused, and returns what it made. */
export type WorkJob<T> = Generator<number, T, void>;

/**
 * What a job yields while its work runs elsewhere (a worker it posted to): its progress, and no more turns this frame. Stepping it
 * again would only ask the same question until the frame's budget was gone.
 */
export const elsewhere = (progress: number): number => -1 - Math.min(Math.max(progress, 0), 1);

interface Running {
    label: string;
    progress: number;
    job: WorkJob<unknown>;
    done: (value: unknown) => void;
    fail: (error: unknown) => void;
}

/** Who asks when a caller names nobody: every such caller is one owner, and shares one turn. */
const SHARED = {};

/** The jobs an App is running. Read {@link Bakes.active} for what to show. */
export class Bakes implements MainThreadGate {
    /** How long, in milliseconds, all the work spread over frames may take of one frame between it. */
    budgetMs = 8;
    /** How much more a frame gives while work that would be seen missing is still to do (see `urge`). */
    priorityExtraMs = 12;
    /** What this frame's work stepped elsewhere may still take, after the jobs and whoever went before. */
    private left_ = 0;
    /** Who asked for time this frame, in the order they first did, and who asked the frame before. */
    private readonly turns_ = new Map<object, { start: number; last: number; allowance: number }>();
    private waiting_ = new Set<object>();
    private open_: { start: number; last: number; allowance: number } | null = null;
    /** How long one piece of each owner's work has been taking, smoothed. */
    private readonly piece_ = new WeakMap<object, number>();
    /** Whose remaining work would be seen missing. */
    private readonly urgent_ = new Set<object>();
    private clock_: () => number = () => performance.now();
    /** Whether work stepped elsewhere ran out of time, this frame and the one before. */
    private starved_ = false;
    private starvedBefore_ = false;
    private readonly running_ = new Set<Running>();
    private readonly marks_ = new Map<object, { label: string; progress: number }>();
    /** Who holds the game for work that must finish first (see `hold`). */
    private readonly holds_ = new Set<object>();
    /** Work waiting for its turn in a frame (see `turn`), in the order it asked. */
    private gates_: Array<{ owner: object; open: () => void }> = [];
    /** How long the work after one turn has been taking, smoothed as `piece_` is; and the turn last given, to measure it. */
    private gateCost_ = 0;
    private lastGate_: { at: number; frame: number } | null = null;
    private frame_ = 0;
    /** When the frames were last stepped, on the clock they were stepped by. */
    private steppedAt_ = -Infinity;

    /**
     * Waits for a turn inside a frame's budget. For work that is not a job but runs whenever something it waited on answers
     * (a cell's preparation resuming from a fetch): without it every such answer ran in full the moment it came, and four
     * cells answered in one task were one long frame. Awaited between pieces of that work, it moves each piece into a frame
     * that has the time for it — as many turns a frame as the budget's remainder fits, and always one.
     *
     * An owner whose work would be seen missing (`urge`) is let through at once, and `release` lets an owner's waiting
     * turns through (it is finishing now, or the frames have stopped).
     */
    turn(owner: object = SHARED): Promise<void> {
        const now = this.clock_();
        // The work since the last turn given, if it ran in that turn's frame: what one piece costs.
        if (this.lastGate_ && this.lastGate_.frame === this.frame_) {
            const piece = now - this.lastGate_.at;
            this.gateCost_ = Math.max(piece, this.gateCost_ * 0.9);
            this.lastGate_ = null;
        }
        if (this.urgent_.has(owner)) return Promise.resolve();
        return new Promise<void>((open) => { this.gates_.push({ owner, open }); });
    }

    /**
     * Whether frames are being stepped: one was in the last quarter second. A game paused at its menu, a hidden editor or an App that
     * has quit steps none, and a turn asked for there would not come.
     */
    stepping(): boolean {
        return this.clock_() - this.steppedAt_ < 250;
    }

    /** Lets every turn `owner` is waiting for through, now. */
    release(owner: object): void {
        const kept: typeof this.gates_ = [];
        for (const gate of this.gates_) {
            if (gate.owner === owner) gate.open();
            else kept.push(gate);
        }
        this.gates_ = kept;
    }

    /** How many turns are waiting. */
    get waiting(): number {
        return this.gates_.length;
    }

    /** Gives this frame's turns: in the order asked, as many as fit what the frame has left, and at least one. */
    private openGates_(now: () => number, left: number): void {
        let given = 0;
        while (this.gates_.length > 0) {
            if (given > 0 && (given + 1) * Math.max(this.gateCost_, 0.25) > left) break;
            const gate = this.gates_.shift()!;
            gate.open();
            given++;
        }
        if (given > 0) {
            this.lastGate_ = { at: now(), frame: this.frame_ };
            // What the turns given will take comes off what the work stepped elsewhere may still have this frame.
            this.left_ -= given * this.gateCost_;
        }
    }

    /**
     * Holds the game while `owner`'s work finishes: the App is paused for it and the jobs go on being stepped through the
     * pause, as a world that cannot keep up with its player stops the game rather than showing a hole
     * `wp.Runtime.BlockOnSlowStreaming`). Say false when the work is done. A pause the game itself asked for does not step
     * the jobs; only a hold does.
     */
    hold(owner: object, held: boolean): void {
        if (held) this.holds_.add(owner);
        else this.holds_.delete(owner);
    }

    /** Whether anyone holds the game for its work. */
    get holding(): boolean {
        return this.holds_.size > 0;
    }

    /**
     * Runs `job` over the frames to come, under `label`; the promise is what it returns. A job that is cancelled (see `cancel`)
     * never settles.
     */
    run<T>(label: string, job: WorkJob<T>): { done: Promise<T>; cancel: () => void; finish: () => void } {
        let entry!: Running;
        const done = new Promise<T>((resolve, reject) => {
            entry = { label, progress: 0, job, done: resolve as (v: unknown) => void, fail: reject };
        });
        this.running_.add(entry);
        return {
            done,
            cancel: () => { this.running_.delete(entry); },
            // What is left, now, in this call: for work that must not wait for frames any more (the player is upon it, or
            // the frames have stopped and something waits on the promise).
            finish: () => {
                if (!this.running_.delete(entry)) return;
                try {
                    for (;;) {
                        const next = entry.job.next();
                        if (next.done) { entry.done(next.value); return; }
                        // Waiting on a worker: nothing here can finish it now, so it goes back to the frames.
                        if (next.value < 0) { this.running_.add(entry); return; }
                    }
                } catch (e) {
                    entry.fail(e);
                }
            },
        };
    }

    /**
     * Shows work that is stepped elsewhere (pages made a few a frame) under `label` while `progress` is below 1; `owner` names it,
     * so a later mark replaces it. Mark it 1, or `clear` it, when it is done.
     */
    mark(owner: object, label: string, progress: number): void {
        if (progress >= 1) this.marks_.delete(owner);
        else this.marks_.set(owner, { label, progress: Math.max(0, progress) });
    }

    clear(owner: object): void {
        this.marks_.delete(owner);
        this.urgent_.delete(owner);
    }

    /** Every piece of work in hand now. Empty when the engine is idle. */
    get active(): BakeProgress[] {
        const out: BakeProgress[] = [];
        for (const r of this.running_) out.push({ label: r.label, progress: r.progress });
        for (const m of this.marks_.values()) out.push({ label: m.label, progress: m.progress });
        return out;
    }

    /**
     * Whether `owner`'s work stepped elsewhere may go on this frame. Such work does what it must at once (what stands right by the
     * player) whatever this says, and stops when it says no; saying no is remembered, so the jobs leave it more of the next frame.
     *
     * The first time an owner asks in a frame it is given its part: what the frame has left, divided among it and those that asked
     * the frame before and have not had their turn yet. An owner that asks alone has all of it.
     */
    hasTime(owner: object = SHARED): boolean {
        const now = this.clock_();
        let turn = this.turns_.get(owner);
        if (!turn) {
            // Whoever went before is done for this frame: what it took comes off what is left.
            if (this.open_) this.left_ -= this.open_.last - this.open_.start;
            this.waiting_.delete(owner);
            turn = { start: now, last: now, allowance: Math.max(0, this.left_) / (this.waiting_.size + 1) };
            this.turns_.set(owner, turn);
            this.open_ = turn;
        }
        else {
            // What one piece of this owner's work takes, from the time between its asks: a piece is not started that would run past
            // the owner's part. Asking only "is there time left" let a stepper whose pieces take as long as the budget start a second
            // and a third, and a frame meant to give 8 ms gave 21.
            // The LONGEST lately, let down slowly, and not the mean: an owner's pieces are not alike (a cell of grass is 8 ms, a chunk
            // with nothing in it is none), and a mean pulled down by the empty ones lets the next full one through.
            const piece = now - turn.last;
            const known = this.piece_.get(owner);
            this.piece_.set(owner, known === undefined ? piece : Math.max(piece, known * 0.9));
        }
        const first = turn.last === turn.start && now === turn.start;
        turn.last = now;
        // The first piece of a turn is always given: a part smaller than one piece would otherwise never make anything.
        if (first ? turn.allowance > 0 : now - turn.start + (this.piece_.get(owner) ?? 0) <= turn.allowance) return true;
        this.starved_ = true;
        return false;
    }

    /**
     * Says whether what `owner` still has to do would be seen missing by the player: the chunk they stand in, the ground under them.
     * While any owner says so the frame's budget is larger by `priorityExtraMs`. Say false when it is done, or it is held for good.
     */
    urge(owner: object, urgent: boolean): void {
        if (urgent) {
            this.urgent_.add(owner);
            // What it is waiting for a turn for is now wanted at once.
            this.release(owner);
        } else this.urgent_.delete(owner);
    }

    /** Whether something the player would see missing is still being made: what a loading screen waits for. */
    get urgent(): boolean {
        return this.urgent_.size > 0;
    }

    /** What this frame may spend: the steady budget, and the extra while something urgent is outstanding. */
    get frameBudgetMs(): number {
        return this.budgetMs + (this.urgent_.size > 0 ? this.priorityExtraMs : 0);
    }

    /** Starts the frame's budget and steps the jobs for their part of it, oldest first; a job that finishes or throws settles its promise. */
    step(now: () => number = () => performance.now()): void {
        this.clock_ = now;
        this.frame_++;
        this.steppedAt_ = now();
        this.starvedBefore_ = this.starved_;
        this.starved_ = false;
        const start = now();
        const budget = this.frameBudgetMs;
        // Those that asked last frame are expected again: each new turn is sized by how many of them are still to come.
        this.waiting_ = new Set(this.turns_.keys());
        this.turns_.clear();
        this.open_ = null;
        this.left_ = budget;
        if (this.running_.size === 0) {
            this.openGates_(now, budget / (this.starvedBefore_ ? 2 : 1));
            return;
        }
        const end = start + (this.starvedBefore_ ? budget / 2 : budget);
        for (const r of [...this.running_]) {
            // Every job advances at least once a frame, so a long one cannot starve those behind it.
            do {
                let next: IteratorResult<number, unknown>;
                try {
                    next = r.job.next();
                } catch (e) {
                    this.running_.delete(r);
                    r.fail(e);
                    break;
                }
                if (next.done) {
                    this.running_.delete(r);
                    r.done(next.value);
                    break;
                }
                if (next.value < 0) { r.progress = -1 - next.value; break; }
                r.progress = Math.min(Math.max(next.value, 0), 1);
            } while (now() < end);
            if (now() >= end) break;
        }
        this.left_ = budget - (now() - start);
        this.openGates_(now, Math.max(0, this.left_));
    }
}

/** The resource; {@link bakesOf} installs it where it is missing. @experimental */
export const BakesRes = defineResource<Bakes>(new Bakes(), 'Bakes');

/** The App's jobs, installed (with the system that steps them, before Update) on first use, so a plugin that bakes needs nothing else. */
export function bakesOf(app: App): Bakes {
    if (!app.hasResource(BakesRes)) {
        const bakes = new Bakes();
        app.insertResource(BakesRes, bakes);
        // Jobs done on the main thread (no workers on this host, or they failed) wait their turn in this App's budget.
        setMainThreadGate(bakes);
        // Through a pause only while something holds the game for its work: a game paused at its menu bakes nothing, as before.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            if (app.isPaused() && !bakes.holding) return;
            bakes.step();
        }, { name: 'BakeSystem', runWhenPaused: true }));
    }
    return app.getResource(BakesRes);
}

/** Runs a job to its end at once, for a caller with no frames to spread it over (a test, a tool). */
export function finish<T>(job: WorkJob<T>): T {
    for (;;) {
        const next = job.next();
        if (next.done) return next.value;
    }
}
