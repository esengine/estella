/**
 * @file    TweenGroup.ts
 * @brief   Parallel and sequential tween composition utilities
 */

import { TweenState, valueTweenManager, ValueTweenHandle } from './ValueTween';
import type { TweenOptions } from './ValueTween';

// =============================================================================
// Completable - common interface for things that finish
// =============================================================================

interface Completable {
    get state(): TweenState;
    pause(): void;
    resume(): void;
    cancel(): void;
}

// =============================================================================
// TweenGroup - parallel execution
// =============================================================================

export class TweenGroup implements Completable {
    private readonly tweens_: Completable[];
    private onComplete_: (() => void) | null = null;
    private completed_ = false;

    constructor(tweens: Completable[]) {
        this.tweens_ = [...tweens];
    }

    get state(): TweenState {
        if (this.completed_) return TweenState.Completed;
        if (this.tweens_.every(t => t.state === TweenState.Completed)) return TweenState.Completed;
        if (this.tweens_.some(t => t.state === TweenState.Cancelled)) return TweenState.Cancelled;
        if (this.tweens_.every(t => t.state === TweenState.Paused || t.state === TweenState.Completed)) return TweenState.Paused;
        return TweenState.Running;
    }

    pause(): void {
        for (const t of this.tweens_) {
            if (t.state === TweenState.Running) t.pause();
        }
    }

    resume(): void {
        for (const t of this.tweens_) {
            if (t.state === TweenState.Paused) t.resume();
        }
    }

    cancel(): void {
        for (const t of this.tweens_) t.cancel();
    }

    onComplete(callback: () => void): this {
        this.onComplete_ = callback;
        return this;
    }

    /** @internal - called by TweenSequence/checker to poll completion */
    checkComplete(): boolean {
        if (this.completed_) return true;
        if (this.state === TweenState.Completed) {
            this.completed_ = true;
            this.onComplete_?.();
            return true;
        }
        return false;
    }
}

// =============================================================================
// TweenSequence - sequential execution
// =============================================================================

type TweenFactory = () => Completable;

export class TweenSequence implements Completable {
    private readonly factories_: TweenFactory[];
    private currentIndex_ = 0;
    private currentTween_: Completable | null = null;
    private completed_ = false;
    private cancelled_ = false;
    private paused_ = false;
    private onComplete_: (() => void) | null = null;

    constructor(factories: TweenFactory[]) {
        this.factories_ = [...factories];
        if (this.factories_.length > 0) {
            this.currentTween_ = this.factories_[0]();
        } else {
            this.completed_ = true;
        }
    }

    get state(): TweenState {
        if (this.cancelled_) return TweenState.Cancelled;
        if (this.completed_) return TweenState.Completed;
        if (this.paused_) return TweenState.Paused;
        return TweenState.Running;
    }

    pause(): void {
        this.paused_ = true;
        this.currentTween_?.pause();
    }

    resume(): void {
        this.paused_ = false;
        this.currentTween_?.resume();
    }

    cancel(): void {
        this.cancelled_ = true;
        this.currentTween_?.cancel();
    }

    onComplete(callback: () => void): this {
        this.onComplete_ = callback;
        return this;
    }

    /** @internal */
    checkComplete(): boolean {
        if (this.completed_ || this.cancelled_) return true;
        if (this.paused_ || !this.currentTween_) return false;

        if (this.currentTween_.state === TweenState.Completed) {
            this.currentIndex_++;
            if (this.currentIndex_ >= this.factories_.length) {
                this.completed_ = true;
                this.onComplete_?.();
                return true;
            }
            this.currentTween_ = this.factories_[this.currentIndex_]();
        }
        return false;
    }
}

// =============================================================================
// Composition Manager - polls groups/sequences for completion
// =============================================================================

class TweenCompositionManager {
    private readonly active_ = new Set<TweenGroup | TweenSequence>();

    add(item: TweenGroup | TweenSequence): void {
        this.active_.add(item);
    }

    update(): void {
        for (const item of this.active_) {
            if (item.checkComplete()) {
                this.active_.delete(item);
            }
        }
    }

    clear(): void {
        this.active_.clear();
    }

    get activeCount(): number {
        return this.active_.size;
    }
}

export const tweenCompositionManager = new TweenCompositionManager();

// =============================================================================
// Builder API
// =============================================================================

export const TweenCompose = {
    parallel(tweens: Completable[]): TweenGroup {
        const group = new TweenGroup(tweens);
        tweenCompositionManager.add(group);
        return group;
    },

    sequence(factories: TweenFactory[]): TweenSequence {
        const seq = new TweenSequence(factories);
        tweenCompositionManager.add(seq);
        return seq;
    },

    delay(seconds: number): ValueTweenHandle {
        const id = valueTweenManager.create(0, 0, seconds, () => {});
        return new ValueTweenHandle(id);
    },
};
