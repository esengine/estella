import type { Vec2 } from '../../types';

export interface ScrollContainerOptions {
    viewportSize: Vec2;
    contentSize: Vec2;
    initialOffset?: Vec2;
    /** Axis restrictions. Default 'vertical'. */
    direction?: 'both' | 'vertical' | 'horizontal';
    /** Multiplier applied to wheel deltas. Default 1. */
    wheelSpeed?: number;
}

export type ScrollListener = (offset: Vec2) => void;

/**
 * Scroll state for a virtualized view. Clamps offset to the legal range
 * `[0, contentSize - viewportSize]` and notifies listeners on any change.
 *
 * The ScrollContainer itself has no input knowledge; a system pushes
 * wheel / drag deltas into `scrollBy`. Consumers that need to react
 * (e.g. a ListView) subscribe via `onScroll`.
 */
export class ScrollContainer {
    private viewportSize_: Vec2;
    private contentSize_: Vec2;
    private offset_: Vec2 = { x: 0, y: 0 };
    private readonly direction_: 'both' | 'vertical' | 'horizontal';
    private readonly wheelSpeed_: number;
    private readonly listeners_ = new Set<ScrollListener>();

    constructor(opts: ScrollContainerOptions) {
        this.viewportSize_ = { x: opts.viewportSize.x, y: opts.viewportSize.y };
        this.contentSize_ = { x: opts.contentSize.x, y: opts.contentSize.y };
        this.direction_ = opts.direction ?? 'vertical';
        this.wheelSpeed_ = opts.wheelSpeed ?? 1;
        this.setOffset(opts.initialOffset ?? { x: 0, y: 0 });
    }

    getOffset(): Vec2 {
        return { x: this.offset_.x, y: this.offset_.y };
    }

    getViewportSize(): Vec2 {
        return { x: this.viewportSize_.x, y: this.viewportSize_.y };
    }

    getContentSize(): Vec2 {
        return { x: this.contentSize_.x, y: this.contentSize_.y };
    }

    getMaxOffset(): Vec2 {
        return {
            x: Math.max(0, this.contentSize_.x - this.viewportSize_.x),
            y: Math.max(0, this.contentSize_.y - this.viewportSize_.y),
        };
    }

    getWheelSpeed(): number {
        return this.wheelSpeed_;
    }

    setOffset(offset: Vec2): void {
        const max = this.getMaxOffset();
        const lockX = this.direction_ === 'vertical';
        const lockY = this.direction_ === 'horizontal';
        const next: Vec2 = {
            x: lockX ? 0 : clamp(offset.x, 0, max.x),
            y: lockY ? 0 : clamp(offset.y, 0, max.y),
        };
        if (next.x === this.offset_.x && next.y === this.offset_.y) return;
        this.offset_ = next;
        for (const listener of Array.from(this.listeners_)) {
            try {
                listener({ x: next.x, y: next.y });
            } catch (err) {
                console.error('[ScrollContainer] listener error:', err);
            }
        }
    }

    scrollBy(delta: Vec2): void {
        this.setOffset({
            x: this.offset_.x + delta.x,
            y: this.offset_.y + delta.y,
        });
    }

    setViewportSize(size: Vec2): void {
        if (size.x === this.viewportSize_.x && size.y === this.viewportSize_.y) return;
        this.viewportSize_ = { x: size.x, y: size.y };
        this.setOffset(this.offset_);   // re-clamp
    }

    setContentSize(size: Vec2): void {
        if (size.x === this.contentSize_.x && size.y === this.contentSize_.y) return;
        this.contentSize_ = { x: size.x, y: size.y };
        this.setOffset(this.offset_);
    }

    onScroll(listener: ScrollListener): () => void {
        this.listeners_.add(listener);
        return () => {
            this.listeners_.delete(listener);
        };
    }

    dispose(): void {
        this.listeners_.clear();
    }
}

/** Registry of scroll containers keyed by the entity they're attached to. */
export class ScrollContainerRegistry {
    private readonly entries_ = new Map<number, ScrollContainer>();

    attach(entity: number, container: ScrollContainer): void {
        this.entries_.set(entity, container);
    }

    detach(entity: number): void {
        this.entries_.delete(entity);
    }

    get(entity: number): ScrollContainer | undefined {
        return this.entries_.get(entity);
    }

    entries(): IterableIterator<[number, ScrollContainer]> {
        return this.entries_.entries();
    }

    size(): number {
        return this.entries_.size;
    }

    clear(): void {
        this.entries_.clear();
    }
}

function clamp(value: number, lo: number, hi: number): number {
    return value < lo ? lo : value > hi ? hi : value;
}
