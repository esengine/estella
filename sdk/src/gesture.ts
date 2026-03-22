import type { InputState } from './input';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

const TAP_MAX_DISTANCE = 10;
const TAP_MAX_DURATION = 0.3;
const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MIN_SPEED = 200;
const LONG_PRESS_DURATION = 0.5;
const LONG_PRESS_MAX_MOVE = 10;

interface TouchTrack {
    startX: number;
    startY: number;
    startTime: number;
    elapsed: number;
    maxDist: number;
    longPressFired: boolean;
}

export class GestureDetector {
    private input_: InputState;
    private tracks_ = new Map<number, TouchTrack>();
    private prevPinchDist_ = 0;

    onTap: ((x: number, y: number) => void) | null = null;
    onSwipe: ((direction: SwipeDirection, speed: number) => void) | null = null;
    onPinch: ((scale: number, centerX: number, centerY: number) => void) | null = null;
    onLongPress: ((x: number, y: number) => void) | null = null;

    constructor(input: InputState) {
        this.input_ = input;
    }

    update(dt: number): void {
        this.processStarts_();
        this.processActive_(dt);
        this.processEnds_();
        this.processPinch_();
    }

    private processStarts_(): void {
        for (const [id, touch] of this.input_.touchesStarted) {
            this.tracks_.set(id, {
                startX: touch.x,
                startY: touch.y,
                startTime: 0,
                elapsed: 0,
                maxDist: 0,
                longPressFired: false,
            });
        }

        if (this.input_.touchesStarted.size > 0 && this.input_.touches.size === 2) {
            const ids = [...this.input_.touches.keys()];
            const t0 = this.input_.touches.get(ids[0])!;
            const t1 = this.input_.touches.get(ids[1])!;
            this.prevPinchDist_ = Math.hypot(t1.x - t0.x, t1.y - t0.y);
        }
    }

    private lastPositions_ = new Map<number, { x: number; y: number }>();

    private processActive_(dt: number): void {
        for (const [id, track] of this.tracks_) {
            const touch = this.input_.touches.get(id);
            if (!touch) continue;

            track.elapsed += dt;
            this.lastPositions_.set(id, { x: touch.x, y: touch.y });

            const dx = touch.x - track.startX;
            const dy = touch.y - track.startY;
            const dist = Math.hypot(dx, dy);
            if (dist > track.maxDist) track.maxDist = dist;

            if (!track.longPressFired &&
                track.elapsed >= LONG_PRESS_DURATION &&
                track.maxDist < LONG_PRESS_MAX_MOVE &&
                this.input_.touches.size === 1) {
                track.longPressFired = true;
                this.onLongPress?.(touch.x, touch.y);
            }
        }
    }

    private processEnds_(): void {
        for (const id of this.input_.touchesEnded) {
            const track = this.tracks_.get(id);
            if (!track) continue;

            if (track.elapsed < TAP_MAX_DURATION && track.maxDist < TAP_MAX_DISTANCE) {
                this.onTap?.(track.startX, track.startY);
            } else if (track.maxDist >= SWIPE_MIN_DISTANCE) {
                const last = this.lastPositions_.get(id);
                const endX = last?.x ?? track.startX;
                const endY = last?.y ?? track.startY;

                const dx = endX - track.startX;
                const dy = endY - track.startY;
                const dist = Math.hypot(dx, dy);
                const speed = track.elapsed > 0 ? dist / track.elapsed : 0;

                if (dist >= SWIPE_MIN_DISTANCE && speed >= SWIPE_MIN_SPEED) {
                    let direction: SwipeDirection;
                    if (Math.abs(dx) > Math.abs(dy)) {
                        direction = dx > 0 ? 'right' : 'left';
                    } else {
                        direction = dy > 0 ? 'down' : 'up';
                    }
                    this.onSwipe?.(direction, speed);
                }
            }

            this.tracks_.delete(id);
        }
    }

    private processPinch_(): void {
        if (this.input_.touches.size !== 2) {
            this.prevPinchDist_ = 0;
            return;
        }

        const ids = [...this.input_.touches.keys()];
        const t0 = this.input_.touches.get(ids[0])!;
        const t1 = this.input_.touches.get(ids[1])!;
        const dist = Math.hypot(t1.x - t0.x, t1.y - t0.y);

        if (this.prevPinchDist_ > 0 && dist > 0) {
            const scale = dist / this.prevPinchDist_;
            if (Math.abs(scale - 1) > 0.001) {
                const cx = (t0.x + t1.x) / 2;
                const cy = (t0.y + t1.y) / 2;
                this.onPinch?.(scale, cx, cy);
            }
        }

        this.prevPinchDist_ = dist;
    }

    reset(): void {
        this.tracks_.clear();
        this.prevPinchDist_ = 0;
    }
}
