// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/scheduler.ts
 * @brief   `director.getScheduler()`: timers kept by target rather than by component.
 *
 * A component's own `schedule` stops with the component; the director's scheduler serves anything a script holds, a plain object or a
 * singleton, and is how a game's timer service ticks. It runs once a frame from the frame the host reports, scaled by `setTimeScale`.
 */

interface Entry {
    callback: (dt: number) => void;
    target: object;
    interval: number;
    repeat: number;
    delay: number;
    /** Time since the last fire (or since the delay began). */
    elapsed: number;
    fired: number;
    started: boolean;
    paused: boolean;
}

export class Scheduler {
    static readonly ID = 'scheduler';
    static readonly PRIORITY_SYSTEM = -(2 ** 31);
    static readonly PRIORITY_NON_SYSTEM = Scheduler.PRIORITY_SYSTEM + 1;
    static readonly REPEAT_FOREVER = Number.MAX_VALUE - 1;
    static enableForTarget(_target: unknown): void { /* a target needs no marking here */ }

    private entries_: Entry[] = [];
    private updates_ = new Map<object, { priority: number; paused: boolean }>();
    private pausedTargets_ = new Set<object>();
    private timeScale_ = 1;

    /** Call @p callback on @p target every @p interval seconds (every frame at 0), @p repeat more times after the first, after @p delay. */
    schedule(callback: (dt: number) => void, target: object, interval = 0, repeat = Scheduler.REPEAT_FOREVER, delay = 0, paused = false): void {
        if (typeof callback !== 'function') return;
        this.unschedule(callback, target);
        this.entries_.push({ callback, target, interval, repeat, delay, elapsed: 0, fired: 0, started: delay <= 0, paused });
    }
    scheduleOnce(callback: (dt: number) => void, target: object, delay = 0): void { this.schedule(callback, target, 0, 0, delay); }
    /** Call `target.update(dt)` every frame, lowest priority first. */
    scheduleUpdate(target: object, priority = 0, paused = false): void { this.updates_.set(target, { priority, paused }); }
    unscheduleUpdate(target: object): void { this.updates_.delete(target); }
    unschedule(callback: (dt: number) => void, target: object): void {
        this.entries_ = this.entries_.filter((e) => !(e.callback === callback && e.target === target));
    }
    unscheduleAllForTarget(target: object): void {
        this.entries_ = this.entries_.filter((e) => e.target !== target);
        this.updates_.delete(target);
    }
    unscheduleAll(): void { this.entries_ = []; this.updates_.clear(); }
    unscheduleAllWithMinPriority(minPriority: number): void {
        if (minPriority <= Scheduler.PRIORITY_SYSTEM) { this.unscheduleAll(); return; }
        for (const [target, u] of [...this.updates_]) if (u.priority >= minPriority) this.updates_.delete(target);
        this.entries_ = [];
    }
    isScheduled(callback: (dt: number) => void, target: object): boolean {
        return this.entries_.some((e) => e.callback === callback && e.target === target);
    }
    pauseTarget(target: object): void { this.pausedTargets_.add(target); }
    resumeTarget(target: object): void { this.pausedTargets_.delete(target); }
    isTargetPaused(target: object): boolean { return this.pausedTargets_.has(target); }
    setTimeScale(scale: number): void { this.timeScale_ = scale; }
    getTimeScale(): number { return this.timeScale_; }

    /** @internal Advance by one frame's @p delta seconds. */
    update(delta: number): void {
        const dt = delta * this.timeScale_;
        const updates = [...this.updates_].sort((a, b) => a[1].priority - b[1].priority);
        for (const [target, u] of updates) {
            if (u.paused || this.pausedTargets_.has(target) || !this.updates_.has(target)) continue;
            (target as { update?: (dt: number) => void }).update?.(dt);
        }
        // A callback may schedule or unschedule: walk a copy, and skip an entry that was removed meanwhile.
        for (const e of [...this.entries_]) {
            if (e.paused || this.pausedTargets_.has(e.target) || !this.entries_.includes(e)) continue;
            e.elapsed += dt;
            if (!e.started) {
                if (e.elapsed < e.delay) continue;
                e.started = true;
                e.elapsed -= e.delay;
                this.fire_(e, e.elapsed);
                continue;
            }
            if (e.interval <= 0) { this.fire_(e, dt); continue; }
            while (e.elapsed >= e.interval && this.entries_.includes(e)) {
                e.elapsed -= e.interval;
                this.fire_(e, e.interval);
            }
        }
    }

    private fire_(e: Entry, dt: number): void {
        e.fired++;
        // `repeat` counts the fires after the first, so a once-timer (0) ends with its first
        if (e.fired > e.repeat) this.entries_ = this.entries_.filter((x) => x !== e);
        try { e.callback.call(e.target, dt); } catch (err) { console.error('[cocos] a scheduled callback threw', err); }
    }
}

export const scheduler = new Scheduler();
