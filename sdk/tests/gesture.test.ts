import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GestureDetector, type SwipeDirection } from '../src/gesture';
import { InputState } from '../src/input';

describe('GestureDetector', () => {
    let input: InputState;
    let gesture: GestureDetector;

    beforeEach(() => {
        input = new InputState();
        gesture = new GestureDetector(input);
    });

    describe('tap', () => {
        it('should detect tap on quick touch and release', () => {
            const onTap = vi.fn();
            gesture.onTap = onTap;

            input.touches.set(0, { id: 0, x: 100, y: 100 });
            input.touchesStarted.set(0, { id: 0, x: 100, y: 100 });
            gesture.update(0.016);
            input.clearFrameState();

            input.touches.delete(0);
            input.touchesEnded.add(0);
            gesture.update(0.016);

            expect(onTap).toHaveBeenCalledWith(100, 100);
        });

        it('should not fire tap if touch moves too far', () => {
            const onTap = vi.fn();
            gesture.onTap = onTap;

            input.touches.set(0, { id: 0, x: 100, y: 100 });
            input.touchesStarted.set(0, { id: 0, x: 100, y: 100 });
            gesture.update(0.016);
            input.clearFrameState();

            input.touches.get(0)!.x = 200;
            input.touches.get(0)!.y = 200;
            gesture.update(0.016);
            input.clearFrameState();

            input.touches.delete(0);
            input.touchesEnded.add(0);
            gesture.update(0.016);

            expect(onTap).not.toHaveBeenCalled();
        });
    });

    describe('swipe', () => {
        it('should detect right swipe', () => {
            const onSwipe = vi.fn();
            gesture.onSwipe = onSwipe;

            input.touches.set(0, { id: 0, x: 100, y: 200 });
            input.touchesStarted.set(0, { id: 0, x: 100, y: 200 });
            gesture.update(0.016);
            input.clearFrameState();

            input.touches.get(0)!.x = 250;
            gesture.update(0.1);
            input.clearFrameState();

            input.touches.delete(0);
            input.touchesEnded.add(0);
            gesture.update(0.016);

            expect(onSwipe).toHaveBeenCalledWith('right', expect.any(Number));
        });
    });

    describe('pinch', () => {
        it('should detect pinch scale change', () => {
            const onPinch = vi.fn();
            gesture.onPinch = onPinch;

            input.touches.set(0, { id: 0, x: 100, y: 100 });
            input.touches.set(1, { id: 1, x: 200, y: 100 });
            input.touchesStarted.set(0, { id: 0, x: 100, y: 100 });
            input.touchesStarted.set(1, { id: 1, x: 200, y: 100 });
            gesture.update(0.016);
            input.clearFrameState();

            input.touches.get(0)!.x = 50;
            input.touches.get(1)!.x = 250;
            gesture.update(0.016);

            expect(onPinch).toHaveBeenCalled();
            const scale = onPinch.mock.calls[0][0];
            expect(scale).toBeGreaterThan(1);
        });
    });

    describe('longPress', () => {
        it('should detect long press after threshold', () => {
            const onLongPress = vi.fn();
            gesture.onLongPress = onLongPress;

            input.touches.set(0, { id: 0, x: 100, y: 100 });
            input.touchesStarted.set(0, { id: 0, x: 100, y: 100 });
            gesture.update(0.016);
            input.clearFrameState();

            for (let i = 0; i < 35; i++) {
                gesture.update(0.016);
            }

            expect(onLongPress).toHaveBeenCalledWith(100, 100);
        });

        it('should not fire if finger moves', () => {
            const onLongPress = vi.fn();
            gesture.onLongPress = onLongPress;

            input.touches.set(0, { id: 0, x: 100, y: 100 });
            input.touchesStarted.set(0, { id: 0, x: 100, y: 100 });
            gesture.update(0.016);
            input.clearFrameState();

            input.touches.get(0)!.x = 200;
            for (let i = 0; i < 35; i++) {
                gesture.update(0.016);
            }

            expect(onLongPress).not.toHaveBeenCalled();
        });
    });
});
