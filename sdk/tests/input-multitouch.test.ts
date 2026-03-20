import { describe, it, expect, beforeEach } from 'vitest';
import { InputState } from '../src/input';

describe('InputState multi-touch', () => {
    let input: InputState;

    beforeEach(() => {
        input = new InputState();
    });

    it('should start with no touches', () => {
        expect(input.getTouchCount()).toBe(0);
        expect(input.getTouches()).toEqual([]);
        expect(input.getTouch(0)).toBeNull();
        expect(input.isTouchActive(0)).toBe(false);
    });

    it('should track a single touch', () => {
        input.touches.set(0, { id: 0, x: 100, y: 200 });
        input.touchesStarted.set(0, { id: 0, x: 100, y: 200 });

        expect(input.getTouchCount()).toBe(1);
        expect(input.isTouchActive(0)).toBe(true);
        expect(input.getTouch(0)).toEqual({ id: 0, x: 100, y: 200 });
    });

    it('should track multiple simultaneous touches', () => {
        input.touches.set(0, { id: 0, x: 10, y: 20 });
        input.touches.set(1, { id: 1, x: 300, y: 400 });
        input.touches.set(2, { id: 2, x: 500, y: 600 });

        expect(input.getTouchCount()).toBe(3);
        expect(input.getTouch(1)).toEqual({ id: 1, x: 300, y: 400 });
        expect(input.isTouchActive(2)).toBe(true);
        expect(input.isTouchActive(99)).toBe(false);
    });

    it('should update touch position', () => {
        input.touches.set(0, { id: 0, x: 10, y: 20 });
        const touch = input.touches.get(0)!;
        touch.x = 50;
        touch.y = 60;

        expect(input.getTouch(0)).toEqual({ id: 0, x: 50, y: 60 });
    });

    it('should remove touch on end', () => {
        input.touches.set(0, { id: 0, x: 10, y: 20 });
        input.touches.set(1, { id: 1, x: 30, y: 40 });

        input.touches.delete(0);
        input.touchesEnded.add(0);

        expect(input.getTouchCount()).toBe(1);
        expect(input.isTouchActive(0)).toBe(false);
        expect(input.isTouchActive(1)).toBe(true);
    });

    it('should clear per-frame touch state', () => {
        input.touchesStarted.set(0, { id: 0, x: 10, y: 20 });
        input.touchesEnded.add(1);
        input.touches.set(0, { id: 0, x: 10, y: 20 });

        input.clearFrameState();

        expect(input.touchesStarted.size).toBe(0);
        expect(input.touchesEnded.size).toBe(0);
        expect(input.getTouchCount()).toBe(1);
    });

    it('getTouches should return array copy', () => {
        input.touches.set(0, { id: 0, x: 1, y: 2 });
        input.touches.set(1, { id: 1, x: 3, y: 4 });

        const touches = input.getTouches();
        expect(touches).toHaveLength(2);

        input.touches.delete(0);
        expect(touches).toHaveLength(2);
    });
});
