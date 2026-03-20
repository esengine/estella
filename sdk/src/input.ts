import { defineResource } from './resource';
import { defineSystem, Schedule } from './system';
import type { App, Plugin } from './app';
import { getPlatform } from './platform';

export interface TouchPoint {
    id: number;
    x: number;
    y: number;
}

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

    touches = new Map<number, TouchPoint>();
    touchesStarted = new Map<number, TouchPoint>();
    touchesEnded = new Set<number>();

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

    getTouches(): TouchPoint[] {
        return [...this.touches.values()];
    }

    getTouchCount(): number {
        return this.touches.size;
    }

    getTouch(id: number): TouchPoint | null {
        return this.touches.get(id) ?? null;
    }

    isTouchActive(id: number): boolean {
        return this.touches.has(id);
    }

    clearFrameState(): void {
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.mouseButtonsPressed.clear();
        this.mouseButtonsReleased.clear();
        this.scrollDeltaX = 0;
        this.scrollDeltaY = 0;
        this.touchesStarted.clear();
        this.touchesEnded.clear();
    }
}

export const Input = defineResource<InputState>(new InputState(), 'Input');

export class InputPlugin implements Plugin {
    name = 'input';
    private target_: unknown;
    private unbind_: (() => void) | null = null;

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
            onTouchStart(id, x, y) {
                const point = { id, x, y };
                state.touches.set(id, point);
                state.touchesStarted.set(id, point);
            },
            onTouchMove(id, x, y) {
                const existing = state.touches.get(id);
                if (existing) {
                    existing.x = x;
                    existing.y = y;
                } else {
                    state.touches.set(id, { id, x, y });
                }
            },
            onTouchEnd(id) {
                state.touches.delete(id);
                state.touchesEnded.add(id);
            },
            onTouchCancel(id) {
                state.touches.delete(id);
                state.touchesEnded.add(id);
            },
        }, this.target_ ?? undefined);

        app.addSystemToSchedule(Schedule.Last, defineSystem([], () => {
            state.clearFrameState();
        }, { name: 'InputClearSystem' }));
    }

    cleanup(): void {
        const platform = getPlatform() as any;
        if (typeof platform.unbindInputEvents === 'function') {
            platform.unbindInputEvents();
        }
    }
}

export const inputPlugin = new InputPlugin();
