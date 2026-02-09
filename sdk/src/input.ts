import { defineResource } from './resource';
import { defineSystem, Schedule } from './system';
import type { App, Plugin } from './app';

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
    private target_: HTMLElement | null;

    constructor(target?: HTMLElement) {
        this.target_ = target ?? null;
    }

    build(app: App): void {
        const state = new InputState();
        app.insertResource(Input, state);

        const target = this.target_ ?? document.querySelector('canvas') ?? document.body;

        document.addEventListener('keydown', (e) => {
            if (!state.keysDown.has(e.code)) {
                state.keysPressed.add(e.code);
            }
            state.keysDown.add(e.code);
        });
        document.addEventListener('keyup', (e) => {
            state.keysDown.delete(e.code);
            state.keysReleased.add(e.code);
        });

        target.addEventListener('mousemove', (e) => {
            state.mouseX = (e as MouseEvent).offsetX;
            state.mouseY = (e as MouseEvent).offsetY;
        });
        target.addEventListener('mousedown', (e) => {
            const btn = (e as MouseEvent).button;
            state.mouseButtons.add(btn);
            state.mouseButtonsPressed.add(btn);
        });
        target.addEventListener('mouseup', (e) => {
            const btn = (e as MouseEvent).button;
            state.mouseButtons.delete(btn);
            state.mouseButtonsReleased.add(btn);
        });

        target.addEventListener('touchstart', (e) => {
            const touch = (e as TouchEvent).touches[0];
            if (touch) {
                const rect = (target as HTMLElement).getBoundingClientRect();
                state.mouseX = touch.clientX - rect.left;
                state.mouseY = touch.clientY - rect.top;
                state.mouseButtons.add(0);
                state.mouseButtonsPressed.add(0);
            }
        });
        target.addEventListener('touchmove', (e) => {
            const touch = (e as TouchEvent).touches[0];
            if (touch) {
                const rect = (target as HTMLElement).getBoundingClientRect();
                state.mouseX = touch.clientX - rect.left;
                state.mouseY = touch.clientY - rect.top;
            }
        });
        target.addEventListener('touchend', () => {
            state.mouseButtons.delete(0);
            state.mouseButtonsReleased.add(0);
        });

        target.addEventListener('wheel', (e) => {
            state.scrollDeltaX += (e as WheelEvent).deltaX;
            state.scrollDeltaY += (e as WheelEvent).deltaY;
        });

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
