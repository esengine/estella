/**
 * @file    timer.ts
 * @brief   Frame-based timer system integrated with engine loop
 */

import { defineResource, Res } from './resource';
import { defineSystem } from './system';
import { Schedule } from './system';
import { Time } from './resource';
import type { Plugin } from './app';

// =============================================================================
// Timer Entry
// =============================================================================

interface TimerEntry {
    id: number;
    delay: number;
    elapsed: number;
    repeat: boolean;
    interval: number;
    callback: (timer: TimerHandle) => void;
    paused: boolean;
    repeatCount: number;
    maxRepeatCount: number;
    handle: TimerHandle | null;
}

// =============================================================================
// Timer Handle
// =============================================================================

export class TimerHandle {
    private readonly manager_: TimerManager;
    private readonly id_: number;

    constructor(manager: TimerManager, id: number) {
        this.manager_ = manager;
        this.id_ = id;
    }

    get id(): number {
        return this.id_;
    }

    get isActive(): boolean {
        return this.manager_.has(this.id_);
    }

    get elapsed(): number {
        return this.manager_.getElapsed(this.id_);
    }

    get repeatCount(): number {
        return this.manager_.getRepeatCount(this.id_);
    }

    pause(): this {
        this.manager_.pause(this.id_);
        return this;
    }

    resume(): this {
        this.manager_.resume(this.id_);
        return this;
    }

    cancel(): void {
        this.manager_.cancel(this.id_);
    }

    reset(): this {
        this.manager_.reset(this.id_);
        return this;
    }
}

// =============================================================================
// Timer Manager
// =============================================================================

export class TimerManager {
    private nextId_ = 0;
    private readonly timers_ = new Map<number, TimerEntry>();
    private timeScale_ = 1.0;

    delay(seconds: number, callback: (timer: TimerHandle) => void): TimerHandle {
        return this.addTimer_(seconds, false, 0, 1, callback);
    }

    interval(seconds: number, callback: (timer: TimerHandle) => void, maxRepeat = 0): TimerHandle {
        return this.addTimer_(seconds, true, seconds, maxRepeat, callback);
    }

    private addTimer_(
        delay: number,
        repeat: boolean,
        interval: number,
        maxRepeatCount: number,
        callback: (timer: TimerHandle) => void
    ): TimerHandle {
        const id = ++this.nextId_;
        this.timers_.set(id, {
            id,
            delay,
            elapsed: 0,
            repeat,
            interval,
            callback,
            paused: false,
            repeatCount: 0,
            maxRepeatCount,
            handle: null,
        });
        return new TimerHandle(this, id);
    }

    has(id: number): boolean {
        return this.timers_.has(id);
    }

    getElapsed(id: number): number {
        return this.timers_.get(id)?.elapsed ?? 0;
    }

    getRepeatCount(id: number): number {
        return this.timers_.get(id)?.repeatCount ?? 0;
    }

    pause(id: number): void {
        const t = this.timers_.get(id);
        if (t) t.paused = true;
    }

    resume(id: number): void {
        const t = this.timers_.get(id);
        if (t) t.paused = false;
    }

    cancel(id: number): void {
        this.timers_.delete(id);
    }

    reset(id: number): void {
        const t = this.timers_.get(id);
        if (t) {
            t.elapsed = 0;
            t.repeatCount = 0;
        }
    }

    cancelAll(): void {
        this.timers_.clear();
    }

    get activeCount(): number {
        return this.timers_.size;
    }

    get timeScale(): number {
        return this.timeScale_;
    }

    set timeScale(v: number) {
        this.timeScale_ = Math.max(0, v);
    }

    tick(dt: number): void {
        const scaledDt = dt * this.timeScale_;
        const toRemove: number[] = [];

        for (const [id, entry] of this.timers_) {
            if (entry.paused) continue;

            entry.elapsed += scaledDt;

            if (entry.elapsed >= entry.delay) {
                if (!entry.handle) entry.handle = new TimerHandle(this, id);
                entry.callback(entry.handle);
                entry.repeatCount++;

                if (entry.repeat) {
                    if (entry.maxRepeatCount > 0 && entry.repeatCount >= entry.maxRepeatCount) {
                        toRemove.push(id);
                    } else {
                        entry.elapsed -= entry.delay;
                        entry.delay = entry.interval;
                    }
                } else {
                    toRemove.push(id);
                }
            }
        }

        for (const id of toRemove) {
            this.timers_.delete(id);
        }
    }
}

// =============================================================================
// Resource & System
// =============================================================================

export const TimerRes = defineResource<TimerManager>(new TimerManager(), 'Timer');

const timerSystem = defineSystem(
    [Res(TimerRes), Res(Time)],
    (timerManager, time) => {
        timerManager.tick(time.delta);
    },
    { name: 'TimerSystem' }
);

// =============================================================================
// Plugin
// =============================================================================

export const timerPlugin: Plugin = {
    name: 'Timer',
    build(app) {
        app.insertResource(TimerRes, new TimerManager());
        app.addSystemToSchedule(Schedule.PreUpdate, timerSystem);
    },
};
