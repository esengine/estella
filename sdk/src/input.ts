// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from './resource';
import { defineSystem, Schedule } from './system';
import type { App, Plugin } from './app';
import { getPlatform } from './platform';
import type { GamepadSnapshot } from './platform/types';
import { inputRouter } from './inputRouter';

export interface TouchPoint {
    id: number;
    x: number;
    y: number;
}

/**
 * Standard-mapping gamepad buttons (W3C "standard gamepad"). Positional names
 * (SDL / Steam Input convention) avoid device assumptions; Xbox / PlayStation
 * face labels are noted for reference.
 */
export enum GamepadButton {
    South = 0,        // A (Xbox) · Cross (PS)
    East = 1,         // B · Circle
    West = 2,         // X · Square
    North = 3,        // Y · Triangle
    LeftBumper = 4,   // LB · L1
    RightBumper = 5,  // RB · R1
    LeftTrigger = 6,  // LT · L2 (analog)
    RightTrigger = 7, // RT · R2 (analog)
    Back = 8,         // View · Select / Share
    Start = 9,        // Menu · Options
    LeftStick = 10,   // L3 (stick click)
    RightStick = 11,  // R3
    DpadUp = 12,
    DpadDown = 13,
    DpadLeft = 14,
    DpadRight = 15,
    Guide = 16,       // Xbox · PS · Home
}

/** Standard-mapping gamepad axes (signed, [-1,1]). */
export enum GamepadAxis {
    LeftX = 0,
    LeftY = 1,
    RightX = 2,
    RightY = 3,
}

/** @internal Per-gamepad runtime state — current + previous frame, for edges. */
interface PadState {
    connected: boolean;
    buttons: number[];
    prevButtons: number[];
    axes: number[];
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

    // — Fixed-timestep edge mirrors —
    // The render edges above are cleared once per rendered frame (Schedule.Last),
    // but FixedUpdate runs a variable number of steps per frame (0 on a frame
    // shorter than the timestep, 2+ when catching up). Reading a render edge from
    // a fixed system therefore drops presses on sub-timestep frames and doubles
    // them on catch-up frames. These mirrors are populated alongside the render
    // edges but cleared per *step* (see endFixedStep), so a press/release reaches
    // exactly one fixed step — the first one at or after it arrived. While a fixed
    // step is running, the keyboard/mouse edge queries read these instead.
    // (Godot's idle- vs physics-frame `just_pressed` split.)
    keysPressedFixed = new Set<string>();
    keysReleasedFixed = new Set<string>();
    mouseButtonsPressedFixed = new Set<number>();
    mouseButtonsReleasedFixed = new Set<number>();
    private fixedContext_ = false;

    isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    isKeyPressed(key: string): boolean {
        return (this.fixedContext_ ? this.keysPressedFixed : this.keysPressed).has(key);
    }

    isKeyReleased(key: string): boolean {
        return (this.fixedContext_ ? this.keysReleasedFixed : this.keysReleased).has(key);
    }

    getMousePosition(): { x: number; y: number } {
        return { x: this.mouseX, y: this.mouseY };
    }

    isMouseButtonDown(button: number): boolean {
        return this.mouseButtons.has(button);
    }

    isMouseButtonPressed(button: number): boolean {
        return (this.fixedContext_ ? this.mouseButtonsPressedFixed : this.mouseButtonsPressed).has(button);
    }

    isMouseButtonReleased(button: number): boolean {
        return (this.fixedContext_ ? this.mouseButtonsReleasedFixed : this.mouseButtonsReleased).has(button);
    }

    // — Edge intake (called by the platform binding for every raw event) —
    // Centralised here so the render and fixed mirrors can never drift apart.

    /** Record a key-down. The pressed edge only fires on the transition, so a
     *  browser's auto-repeat keydown for a held key doesn't re-trigger it. */
    noteKeyDown(code: string): void {
        if (!this.keysDown.has(code)) {
            this.keysPressed.add(code);
            this.keysPressedFixed.add(code);
        }
        this.keysDown.add(code);
    }

    noteKeyUp(code: string): void {
        this.keysDown.delete(code);
        this.keysReleased.add(code);
        this.keysReleasedFixed.add(code);
    }

    noteMouseDown(button: number): void {
        this.mouseButtons.add(button);
        this.mouseButtonsPressed.add(button);
        this.mouseButtonsPressedFixed.add(button);
    }

    noteMouseUp(button: number): void {
        this.mouseButtons.delete(button);
        this.mouseButtonsReleased.add(button);
        this.mouseButtonsReleasedFixed.add(button);
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

    // — Gamepad (polled each frame; edges via current/prev diff, not events) —
    /** Per-index pad state; an index persists across disconnect so a reconnect resumes. */
    gamepads = new Map<number, PadState>();
    /** Analog buttons (e.g. triggers) count as "down" at/above this value. */
    gamepadButtonThreshold = 0.5;
    /** Axis magnitudes below this read as 0 (rest-position stick jitter). */
    gamepadDeadzone = 0.15;

    /** Indices of currently-connected gamepads. */
    getGamepads(): number[] {
        const out: number[] = [];
        for (const [i, p] of this.gamepads) if (p.connected) out.push(i);
        return out;
    }

    isGamepadConnected(pad = 0): boolean {
        return this.gamepads.get(pad)?.connected ?? false;
    }

    isGamepadButtonDown(button: number, pad = 0): boolean {
        const p = this.connectedPad_(pad);
        return !!p && (p.buttons[button] ?? 0) >= this.gamepadButtonThreshold;
    }

    isGamepadButtonPressed(button: number, pad = 0): boolean {
        const p = this.connectedPad_(pad);
        if (!p) return false;
        const t = this.gamepadButtonThreshold;
        return (p.buttons[button] ?? 0) >= t && (p.prevButtons[button] ?? 0) < t;
    }

    isGamepadButtonReleased(button: number, pad = 0): boolean {
        const p = this.connectedPad_(pad);
        if (!p) return false;
        const t = this.gamepadButtonThreshold;
        return (p.buttons[button] ?? 0) < t && (p.prevButtons[button] ?? 0) >= t;
    }

    /** Raw analog value of a button in [0,1] (triggers; 0/1 for digital buttons). */
    getGamepadButtonValue(button: number, pad = 0): number {
        return this.connectedPad_(pad)?.buttons[button] ?? 0;
    }

    /** Signed axis value in [-1,1], with the deadzone applied. */
    getGamepadAxis(axis: number, pad = 0): number {
        const p = this.connectedPad_(pad);
        if (!p) return 0;
        const v = p.axes[axis] ?? 0;
        return Math.abs(v) < this.gamepadDeadzone ? 0 : v;
    }

    private connectedPad_(pad: number): PadState | undefined {
        const p = this.gamepads.get(pad);
        return p?.connected ? p : undefined;
    }

    /** True when the pointer is over an interactive UI element this frame (set each
     *  frame by the UI interaction system). Gameplay checks this to ignore input
     *  the UI handled — e.g. don't fire a weapon when clicking a HUD button.
     *  Unity's `EventSystem.IsPointerOverGameObject()` analog. */
    pointerOverUI = false;

    isPointerOverUI(): boolean {
        return this.pointerOverUI;
    }

    /** Ingest this frame's snapshots: shift current→prev (edge detection) then
     *  store new values. Pads absent from `snapshots` are marked disconnected. */
    updateGamepads(snapshots: GamepadSnapshot[]): void {
        for (const p of this.gamepads.values()) p.connected = false;
        for (const snap of snapshots) {
            let p = this.gamepads.get(snap.index);
            if (!p) {
                p = { connected: true, buttons: [], prevButtons: [], axes: [] };
                this.gamepads.set(snap.index, p);
            }
            p.prevButtons = p.buttons;
            p.buttons = snap.buttons;
            p.axes = snap.axes;
            p.connected = snap.connected;
        }
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

    /** Enter a fixed-timestep step: keyboard/mouse edge queries now read the fixed
     *  mirrors. Called by App before each FixedUpdate step. */
    beginFixedStep(): void {
        this.fixedContext_ = true;
    }

    /** Leave a fixed step: drop the consumed edges (so a later step this frame
     *  doesn't see them again) and restore the render context. Edges that arrived
     *  on a frame with no fixed step are never cleared here, so they survive to the
     *  next frame's first step instead of being lost. */
    endFixedStep(): void {
        this.keysPressedFixed.clear();
        this.keysReleasedFixed.clear();
        this.mouseButtonsPressedFixed.clear();
        this.mouseButtonsReleasedFixed.clear();
        this.fixedContext_ = false;
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
                if (inputRouter.dispatchKeyDown(code)) return;
                state.noteKeyDown(code);
            },
            onKeyUp(code) {
                if (inputRouter.dispatchKeyUp(code)) return;
                state.noteKeyUp(code);
            },
            onPointerMove(x, y) {
                // Pointer position tracks the cursor even when consumed so
                // gameplay code that reads `getMousePosition()` (e.g. HUD
                // cursor rendering) doesn't freeze while the editor is
                // dragging a gizmo.
                state.mouseX = x;
                state.mouseY = y;
                inputRouter.dispatchPointerMove(x, y);
            },
            onPointerDown(button, x, y) {
                state.mouseX = x;
                state.mouseY = y;
                if (inputRouter.dispatchPointerDown(button, x, y)) return;
                state.noteMouseDown(button);
            },
            onPointerUp(button) {
                if (inputRouter.dispatchPointerUp(button)) return;
                state.noteMouseUp(button);
            },
            onWheel(deltaX, deltaY) {
                if (inputRouter.dispatchWheel(deltaX, deltaY)) return;
                state.scrollDeltaX += deltaX;
                state.scrollDeltaY += deltaY;
            },
            onTouchStart(id, x, y) {
                if (inputRouter.dispatchTouchStart(id, x, y)) return;
                const point = { id, x, y };
                state.touches.set(id, point);
                state.touchesStarted.set(id, point);
            },
            onTouchMove(id, x, y) {
                if (inputRouter.dispatchTouchMove(id, x, y)) return;
                const existing = state.touches.get(id);
                if (existing) {
                    existing.x = x;
                    existing.y = y;
                } else {
                    state.touches.set(id, { id, x, y });
                }
            },
            onTouchEnd(id) {
                if (inputRouter.dispatchTouchEnd(id)) return;
                state.touches.delete(id);
                state.touchesEnded.add(id);
            },
            onTouchCancel(id) {
                if (inputRouter.dispatchTouchCancel(id)) return;
                state.touches.delete(id);
                state.touchesEnded.add(id);
            },
        }, this.target_ ?? undefined);

        // Gamepads are polled (no DOM events). Web supplies pollGamepads; platforms
        // without it (WeChat, headless) skip gamepad input. Runs in First so the
        // freshest pad state is up before any gameplay / action-map system reads it.
        const platform = getPlatform();
        if (platform.pollGamepads) {
            const poll = platform.pollGamepads.bind(platform);
            app.addSystemToSchedule(Schedule.First, defineSystem([], () => {
                state.updateGamepads(poll());
            }, { name: 'GamepadPollSystem' }));
        }

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
