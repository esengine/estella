import { defineResource } from './resource';
import { defineSystem, Schedule } from './system';
import type { App, Plugin } from './app';
import { getPlatform } from './platform';

export class InputState {
    keysDown = new Set<string>();
    keysPressed = new Set<string>();
    keysReleased = new Set<string>();
    mouseX = 0;
    mouseY = 0;
    mouseButtons = new Set<number>();
    mouseButtonsPressed = new Set<number>();
    mouseButtonsReleased = new Set<number>();
    scrollDeltaX = 0;
    scrollDeltaY = 0;

    isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    isKeyPressed(key: string): boolean {
        return this.keysPressed.has(key);
    }

    isKeyReleased(key: string): boolean {
        return this.keysReleased.has(key);
    }

    getMousePosition(): { x: number; y: number } {
        return { x: this.mouseX, y: this.mouseY };
    }

    isMouseButtonDown(button: number): boolean {
        return this.mouseButtons.has(button);
    }

    isMouseButtonPressed(button: number): boolean {
        return this.mouseButtonsPressed.has(button);
    }

    isMouseButtonReleased(button: number): boolean {
        return this.mouseButtonsReleased.has(button);
    }

    getScrollDelta(): { x: number; y: number } {
        return { x: this.scrollDeltaX, y: this.scrollDeltaY };
    }
}

export const Input = defineResource<InputState>(new InputState(), 'Input');

export class InputPlugin implements Plugin {
    private target_: unknown;

    constructor(target?: unknown) {
        this.target_ = target ?? null;
    }

    build(app: App): void {
        const state = new InputState();
        app.insertResource(Input, state);

        getPlatform().bindInputEvents({
            onKeyDown(code) {
                if (!state.keysDown.has(code)) {
                    state.keysPressed.add(code);
                }
                state.keysDown.add(code);
            },
            onKeyUp(code) {
                state.keysDown.delete(code);
                state.keysReleased.add(code);
            },
            onPointerMove(x, y) {
                state.mouseX = x;
                state.mouseY = y;
            },
            onPointerDown(button, x, y) {
                state.mouseX = x;
                state.mouseY = y;
                state.mouseButtons.add(button);
                state.mouseButtonsPressed.add(button);
            },
            onPointerUp(button) {
                state.mouseButtons.delete(button);
                state.mouseButtonsReleased.add(button);
            },
            onWheel(deltaX, deltaY) {
                state.scrollDeltaX += deltaX;
                state.scrollDeltaY += deltaY;
            },
        }, this.target_ ?? undefined);

        app.addSystemToSchedule(Schedule.First, defineSystem([], () => {
            state.keysPressed.clear();
            state.keysReleased.clear();
            state.mouseButtonsPressed.clear();
            state.mouseButtonsReleased.clear();
            state.scrollDeltaX = 0;
            state.scrollDeltaY = 0;
        }, { name: 'InputClearSystem' }));
    }
}

export const inputPlugin = new InputPlugin();
