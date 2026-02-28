import { describe, it, expect, beforeEach } from 'vitest';
import { InputState } from '../src/input';

describe('InputState', () => {
    let input: InputState;

    beforeEach(() => {
        input = new InputState();
    });

    describe('keyboard', () => {
        it('should report key down', () => {
            expect(input.isKeyDown('Space')).toBe(false);
            input.keysDown.add('Space');
            expect(input.isKeyDown('Space')).toBe(true);
        });

        it('should report key pressed', () => {
            expect(input.isKeyPressed('Enter')).toBe(false);
            input.keysPressed.add('Enter');
            expect(input.isKeyPressed('Enter')).toBe(true);
        });

        it('should report key released', () => {
            expect(input.isKeyReleased('Escape')).toBe(false);
            input.keysReleased.add('Escape');
            expect(input.isKeyReleased('Escape')).toBe(true);
        });
    });

    describe('mouse', () => {
        it('should report mouse position', () => {
            expect(input.getMousePosition()).toEqual({ x: 0, y: 0 });
            input.mouseX = 100;
            input.mouseY = 200;
            expect(input.getMousePosition()).toEqual({ x: 100, y: 200 });
        });

        it('should report mouse button down', () => {
            expect(input.isMouseButtonDown(0)).toBe(false);
            input.mouseButtons.add(0);
            expect(input.isMouseButtonDown(0)).toBe(true);
        });

        it('should report mouse button pressed', () => {
            expect(input.isMouseButtonPressed(0)).toBe(false);
            input.mouseButtonsPressed.add(0);
            expect(input.isMouseButtonPressed(0)).toBe(true);
        });

        it('should report mouse button released', () => {
            expect(input.isMouseButtonReleased(2)).toBe(false);
            input.mouseButtonsReleased.add(2);
            expect(input.isMouseButtonReleased(2)).toBe(true);
        });
    });

    describe('scroll', () => {
        it('should report scroll delta', () => {
            expect(input.getScrollDelta()).toEqual({ x: 0, y: 0 });
            input.scrollDeltaX = 10;
            input.scrollDeltaY = -5;
            expect(input.getScrollDelta()).toEqual({ x: 10, y: -5 });
        });
    });

    describe('frame reset pattern', () => {
        it('should clear per-frame state independently', () => {
            input.keysDown.add('KeyA');
            input.keysPressed.add('KeyA');
            input.mouseButtons.add(0);
            input.mouseButtonsPressed.add(0);
            input.scrollDeltaX = 5;
            input.scrollDeltaY = 10;

            input.keysPressed.clear();
            input.keysReleased.clear();
            input.mouseButtonsPressed.clear();
            input.mouseButtonsReleased.clear();
            input.scrollDeltaX = 0;
            input.scrollDeltaY = 0;

            expect(input.isKeyDown('KeyA')).toBe(true);
            expect(input.isKeyPressed('KeyA')).toBe(false);
            expect(input.isMouseButtonDown(0)).toBe(true);
            expect(input.isMouseButtonPressed(0)).toBe(false);
            expect(input.getScrollDelta()).toEqual({ x: 0, y: 0 });
        });
    });
});
