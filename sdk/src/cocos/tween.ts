// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/tween.ts
 * @brief   `tween(target).to(...).by(...).delay(...).call(...)`: Cocos's chainable property animation.
 *
 * A tween is a recipe — a list of steps — and `start()` turns it into a running tree of actions that the frame loop advances by
 * the frame's delta. The shapes Cocos scripts use are all here: `to` / `by` / `set` / `delay` / `call`, `then`, `union`,
 * `sequence` / `parallel`, `repeat` / `repeatForever`, easing by name or function, `progress` and the `onStart` / `onUpdate` /
 * `onComplete` hooks, and `Tween.stopAll*`.
 *
 * What it animates is whatever the target's properties are: numbers lerp, and the value types (`Vec2`, `Vec3`, `Quat`, `Color`)
 * lerp per component and are assigned back as new values, so a `Node` accessor like `position` sees every change. A tween on a
 * `Node` stops when the node is destroyed and waits while it is inactive, which is what Cocos's action manager does.
 */
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../ecs/system';
import { Res, Time } from '../ecs/resource';
import { log } from '../util/logger';
import { easing, resolveEasing, type EasingFunction, type EasingName } from './easing';
import { Node } from './node';
import { Quat } from './math';

type Props = Record<string, unknown>;

export interface TweenOptions<T = unknown> {
    easing?: EasingName | EasingFunction | string;
    /** Replace the interpolation: given a start, an end, the current value and the eased ratio, return the next value. */
    progress?: (start: number, end: number, current: number, ratio: number) => number;
    onStart?: (target?: T) => void;
    onUpdate?: (target: T, ratio: number) => void;
    onComplete?: (target?: T) => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Values.
// ---------------------------------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, number> => typeof v === 'object' && v !== null;

/** A copy that is safe to hold while the target's own value changes underneath. */
function snapshot(v: unknown): unknown {
    if (!isObject(v)) return v;
    const clone = (v as { clone?: () => unknown }).clone;
    if (typeof clone === 'function') return clone.call(v);
    return { ...v };
}

const FIELDS = ['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a', 'width', 'height'];

function addValues(a: unknown, b: unknown): unknown {
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    if (isObject(a) && isObject(b)) {
        const out = snapshot(a) as Record<string, number>;
        for (const f of FIELDS) if (typeof a[f] === 'number' && typeof b[f] === 'number') out[f] = a[f]! + b[f]!;
        return out;
    }
    return b;
}

function interpolate(start: unknown, end: unknown, current: unknown, ratio: number, progress?: TweenOptions['progress']): unknown {
    if (typeof start === 'number' && typeof end === 'number') {
        return progress ? progress(start, end, typeof current === 'number' ? current : start, ratio) : start + (end - start) * ratio;
    }
    if (isObject(start) && isObject(end)) {
        if (start instanceof Quat && end instanceof Quat) return Quat.slerp(new Quat(), start, end, ratio);
        const out = (isObject(current) ? snapshot(current) : snapshot(start)) as Record<string, number>;
        for (const f of FIELDS) {
            const s = start[f], e = end[f];
            if (typeof s === 'number' && typeof e === 'number') out[f] = progress ? progress(s, e, out[f] ?? s, ratio) : s + (e - s) * ratio;
        }
        return out;
    }
    return ratio >= 1 ? end : start;
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions: what a running tween is made of. `step(dt)` returns the time left over when it finished, or -1 while it runs.
// ---------------------------------------------------------------------------------------------------------------------

interface Action { step(dt: number): number }

type Factory = (target: unknown) => Action;

class Sequence implements Action {
    private i = 0;
    constructor(private readonly actions: Action[]) {}
    step(dt: number): number {
        let left = dt;
        while (this.i < this.actions.length) {
            const rest = this.actions[this.i]!.step(left);
            if (rest < 0) return -1;
            left = rest;
            this.i++;
        }
        return left;
    }
}

class Parallel implements Action {
    private readonly done: number[];
    constructor(private readonly actions: Action[]) { this.done = actions.map(() => -1); }
    step(dt: number): number {
        let finished = true;
        for (let i = 0; i < this.actions.length; i++) {
            if (this.done[i]! >= 0) continue;
            this.done[i] = this.actions[i]!.step(dt);
            if (this.done[i]! < 0) finished = false;
        }
        return finished ? Math.min(...this.done) : -1;
    }
}

class Repeat implements Action {
    private n = 0;
    private current: Action;
    constructor(private readonly make: () => Action, private readonly times: number) { this.current = make(); }
    step(dt: number): number {
        let left = dt;
        for (let guard = 0; guard < 10_000; guard++) {
            const rest = this.current.step(left);
            if (rest < 0) return -1;
            left = rest;
            if (++this.n >= this.times) return left;
            this.current = this.make();
            // an iteration that takes no time must not spin
            if (left <= 0 && this.times === Infinity) return -1;
        }
        return -1;
    }
}

/** Frames add up in floating point: ten steps of 0.1 are 0.9999999999999999, and a tween must not wait an extra frame for that. */
const EPS = 1e-9;

class Delay implements Action {
    private t = 0;
    constructor(private readonly duration: number) {}
    step(dt: number): number {
        this.t += dt;
        return this.t >= this.duration - EPS ? Math.max(0, this.t - this.duration) : -1;
    }
}

class Instant implements Action {
    constructor(private readonly run: () => void) {}
    step(dt: number): number { this.run(); return dt; }
}

class Interval implements Action {
    private t = 0;
    private from: Props | null = null;
    private to: Props = {};
    private started = false;
    constructor(
        private readonly target: Record<string, unknown>,
        private readonly duration: number,
        private readonly props: Props,
        private readonly relative: boolean,
        private readonly opts: TweenOptions,
    ) {}

    private begin(): void {
        this.started = true;
        this.from = {};
        for (const key of Object.keys(this.props)) {
            const raw = this.props[key];
            const value = isObject(raw) && 'value' in raw && !('x' in raw) ? (raw as { value: unknown }).value : raw;
            this.from[key] = snapshot(this.target[key]);
            this.to[key] = this.relative ? addValues(this.target[key], value) : value;
        }
        this.opts.onStart?.(this.target);
    }

    step(dt: number): number {
        if (!this.started) this.begin();
        this.t += dt;
        const k = this.duration <= 0 || this.t >= this.duration - EPS ? 1 : this.t / this.duration;
        const eased = resolveEasing(this.opts.easing)(k);
        for (const key of Object.keys(this.props)) {
            const raw = this.props[key];
            const own = isObject(raw) && 'value' in raw && !('x' in raw) ? (raw as { easing?: TweenOptions['easing']; progress?: TweenOptions['progress'] }) : null;
            const ratio = own?.easing ? resolveEasing(own.easing)(k) : eased;
            this.target[key] = interpolate(this.from![key], this.to[key], this.target[key], ratio, own?.progress ?? this.opts.progress);
        }
        this.opts.onUpdate?.(this.target, k);
        if (k < 1) return -1;
        this.opts.onComplete?.(this.target);
        return Math.max(0, this.t - this.duration);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The tween.
// ---------------------------------------------------------------------------------------------------------------------

interface Running {
    tween: Tween<unknown>;
    root: Action;
    paused: boolean;
}
const running = new Set<Running>();
let nextId = 1;

export class Tween<T = unknown> {
    /** @internal */ _steps: Factory[] = [];
    /** @internal */ _target: unknown;
    private tag_ = -1;
    private run_: Running | null = null;
    readonly id = nextId++;

    constructor(target?: T) { this._target = target; }

    get tag(): number { return this.tag_; }
    set tag(v: number) { this.tag_ = v; }

    /** The object being animated. */
    getTarget(): T { return this._target as T; }

    target(t: unknown): Tween<T> { this._target = t; return this; }

    to<P extends Props>(duration: number, props: P, opts?: TweenOptions<T>): Tween<T> {
        this._steps.push((t) => new Interval(t as Record<string, unknown>, duration, props, false, (opts ?? {}) as TweenOptions));
        return this;
    }

    by<P extends Props>(duration: number, props: P, opts?: TweenOptions<T>): Tween<T> {
        this._steps.push((t) => new Interval(t as Record<string, unknown>, duration, props, true, (opts ?? {}) as TweenOptions));
        return this;
    }

    set<P extends Props>(props: P): Tween<T> {
        this._steps.push((t) => new Instant(() => { for (const [k, v] of Object.entries(props)) (t as Record<string, unknown>)[k] = snapshot(v); }));
        return this;
    }

    delay(duration: number): Tween<T> {
        this._steps.push(() => new Delay(duration));
        return this;
    }

    call(callback: (target?: T) => void): Tween<T> {
        this._steps.push((t) => new Instant(() => callback(t as T)));
        return this;
    }

    /** Run another tween's steps here, on this tween's target. */
    then(other: Tween<unknown>): Tween<T> {
        const steps = other._steps.slice();
        this._steps.push((t) => new Sequence(steps.map((f) => f(t))));
        return this;
    }

    /** Fold everything so far into one step, so a following `repeat` repeats all of it. */
    union(): Tween<T> {
        const steps = this._steps;
        this._steps = [(t) => new Sequence(steps.map((f) => f(t)))];
        return this;
    }

    sequence(...tweens: Tween<unknown>[]): Tween<T> {
        const parts = tweens.map((x) => x._steps.slice());
        this._steps.push((t) => new Sequence(parts.flatMap((steps) => steps.map((f) => f(t)))));
        return this;
    }

    parallel(...tweens: Tween<unknown>[]): Tween<T> {
        const parts = tweens.map((x) => x._steps.slice());
        this._steps.push((t) => new Parallel(parts.map((steps) => new Sequence(steps.map((f) => f(t))))));
        return this;
    }

    /** Repeat @p embed, or everything so far when none is given. */
    repeat(times: number, embed?: Tween<unknown>): Tween<T> {
        return this.repeat_(times, embed);
    }
    repeatForever(embed?: Tween<unknown>): Tween<T> {
        return this.repeat_(Infinity, embed);
    }
    private repeat_(times: number, embed?: Tween<unknown>): Tween<T> {
        const steps = embed ? embed._steps.slice() : this._steps;
        const make = (t: unknown) => (): Action => new Sequence(steps.map((f) => f(t)));
        const factory: Factory = (t) => new Repeat(make(t), times);
        if (embed) this._steps.push(factory); else this._steps = [factory];
        return this;
    }

    /** A copy with the same recipe, optionally on another target. */
    clone(target?: unknown): Tween<T> {
        const copy = new Tween<T>((target ?? this._target) as T);
        copy._steps = this._steps.slice();
        copy.tag_ = this.tag_;
        return copy;
    }

    // ---- Node conveniences, as Cocos has them --------------------------------------------------------------------------
    hide(): Tween<T> { return this.call((t) => { if (t instanceof Node) t.active = false; }); }
    show(): Tween<T> { return this.call((t) => { if (t instanceof Node) t.active = true; }); }
    removeSelf(): Tween<T> { return this.call((t) => { if (t instanceof Node) t.removeFromParent(); }); }
    destroySelf(): Tween<T> { return this.call((t) => { if (t instanceof Node) t.destroy(); }); }

    // ---- running -------------------------------------------------------------------------------------------------------

    start(): Tween<T> {
        this.stop();
        const target = this._target ?? {};
        const run: Running = { tween: this as Tween<unknown>, root: new Sequence(this._steps.map((f) => f(target))), paused: false };
        this.run_ = run;
        running.add(run);
        return this;
    }

    stop(): Tween<T> {
        if (this.run_) { running.delete(this.run_); this.run_ = null; }
        return this;
    }

    pause(): Tween<T> { if (this.run_) this.run_.paused = true; return this; }
    resume(): Tween<T> { if (this.run_) this.run_.paused = false; return this; }

    get isRunning(): boolean { return this.run_ !== null; }

    static stopAll(): void { for (const r of [...running]) r.tween.stop(); }
    static stopAllByTag(tag: number, target?: unknown): void {
        for (const r of [...running]) if (r.tween.tag === tag && (target === undefined || r.tween._target === target)) r.tween.stop();
    }
    static stopAllByTarget(target: unknown): void {
        for (const r of [...running]) if (r.tween._target === target) r.tween.stop();
    }
}

/** Start building a tween on @p target. */
export function tween<T>(target?: T): Tween<T> { return new Tween<T>(target); }
export const tweenUtil = tween;

/** Advance every running tween by @p dt seconds. Exported for a host with its own loop, and for tests. */
export function updateTweens(dt: number): void {
    for (const run of [...running]) {
        if (!running.has(run) || run.paused) continue;
        const target = run.tween._target;
        if (target instanceof Node) {
            if (!target.isValid) { run.tween.stop(); continue; }
            if (!target.activeInHierarchy) continue;
        }
        let rest: number;
        try {
            rest = run.root.step(dt);
        } catch (err) {
            log.error('cocos', 'a tween threw and was stopped', err);
            run.tween.stop();
            continue;
        }
        if (rest >= 0) run.tween.stop();
    }
}

/** Register the system that advances tweens with the frame loop. */
export function declareTweenSystem(): void {
    const system = defineSystem(
        [Res(Time), GetWorld()],
        (time) => { updateTweens(time.delta); },
        { name: 'Cocos:Tween', touches: { opaque: true } },
    );
    addSystemToSchedule(Schedule.Update, system);
}

export { easing };
