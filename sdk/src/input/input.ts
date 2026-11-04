// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../ecs/resource';
import { defineSystem, Schedule } from '../ecs/system';
import type { App, Plugin } from '../app/app';
import { claimsKeyDefault, recordTabModifiers, clearTabModifiers } from './keyDefaultPolicy';
import { getPlatform, platformUnbindInputEvents } from '../platform';
import type { GamepadSnapshot, InputEventCallbacks } from '../platform/types';
import { inputRouter } from './inputRouter';
import { cancelPrimaryPointer, takePrimaryPointerCancellation } from './pointerCancellation';
import { recordTouchEnd } from './touchEdges';
import { recordActionEdge, discardActionEdges, clearActionEdges, beginFixedActionEdges, endFixedActionEdges, cancelActionEdges } from './actionEdges';
import type { Vec2 } from '../types';

/**
 * One active touch, in screen pixels with y growing downward.
 *
 * @beta
 */
export interface TouchPoint {
    id: number;
    x: number;
    y: number;
}

/**
 * Standard-mapping gamepad buttons (W3C "standard gamepad"). Positional names
 * (SDL / Steam Input convention) avoid device assumptions; Xbox / PlayStation
 * face labels are noted for reference.
 *
 * @public
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

/** Standard-mapping gamepad axes (signed, [-1,1]).
 *  @public */
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

const ZERO_VIRTUAL: Vec2 = { x: 0, y: 0 };

/**
 * This frame's raw input — the layer under {@link defineInputMap}'s named actions.
 *
 * `@beta`: per-frame touch state is reachable only as the raw `touches` /
 * `touchesStarted` / `touchesEnded` maps, so freezing it freezes two gaps in that
 * representation — no accessor for started/ended, and no write door at all.
 *
 * @beta
 */
export class InputState {
    keysDown = new Set<string>();
    keysPressed = new Set<string>();
    keysReleased = new Set<string>();
    mouseX = 0;
    mouseY = 0;
    /** How far the pointer moved this frame, summed over its events: what a locked pointer has instead of a position. Cleared at the end of the frame. */
    mouseDeltaX = 0;
    mouseDeltaY = 0;
    mouseButtons = new Set<number>();
    mouseButtonsPressed = new Set<number>();
    mouseButtonsReleased = new Set<number>();
    scrollDeltaX = 0;
    scrollDeltaY = 0;

    /** Whether the device can be touched — asked of the platform, not of history. */
    touchAvailable = false;

    touches = new Map<number, TouchPoint>();
    touchesStarted = new Map<number, TouchPoint>();
    /** Fingers lifted this frame, at the position they lifted AT — a release is
     *  hit-tested where it happened, and the live `touches` no longer hold it. */
    touchesEnded = new Map<number, TouchPoint>();

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

    /** How far the pointer moved this frame. Zero where the host does not say (a mini game has no pointer to lock). */
    getMouseDelta(): { x: number; y: number } {
        return { x: this.mouseDeltaX, y: this.mouseDeltaY };
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
        recordTabModifiers(this, code);
        if (!this.keysDown.has(code)) {
            recordActionEdge(this, 'key', code, true);
            this.keysPressed.add(code);
            this.keysPressedFixed.add(code);
        }
        this.keysDown.add(code);
    }

    noteKeyUp(code: string): void {
        if (this.keysDown.has(code)) recordActionEdge(this, 'key', code, false);
        this.keysDown.delete(code);
        this.keysReleased.add(code);
        this.keysReleasedFixed.add(code);
    }

    noteMouseDown(button: number): void {
        if (!this.mouseButtons.has(button)) recordActionEdge(this, 'mouse', button, true);
        if (button === 0) takePrimaryPointerCancellation(this);
        this.mouseButtons.add(button);
        this.mouseButtonsPressed.add(button);
        this.mouseButtonsPressedFixed.add(button);
    }

    noteMouseUp(button: number): void {
        if (this.mouseButtons.has(button)) recordActionEdge(this, 'mouse', button, false);
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

    /** Fingers that went down this frame. */
    getTouchesStarted(): TouchPoint[] {
        return [...this.touchesStarted.values()];
    }

    /** Fingers that came up this frame, at the position they came up at. */
    getTouchesEnded(): TouchPoint[] {
        return [...this.touchesEnded.values()];
    }

    /** Retire a touch after a normal release, retaining its position and press edge. */
    endTouch(id: number): void {
        const point = this.touches.get(id) ?? { id, x: 0, y: 0 };
        recordTouchEnd(point, this.touchesStarted.has(id));
        this.touches.delete(id);
        this.touchesEnded.set(id, point);
    }

    // — Virtual (an on-screen control, or anything else that decides to be input) —
    /**
     * Named 2D values a game writes itself — an on-screen control, the only
     * input a touch device has. Named rather than a screen rectangle, so what
     * is touched and what is read stay one object when the layout moves.
     */
    private virtual_ = new Map<string, Vec2>();
    private virtualSources_ = new Map<object, { id: string; x: number; y: number }>();

    /** Set a named virtual input; held until overwritten, so stopping means
     *  writing zero. `y` defaults to 0 for button/1D use. */
    setVirtual(id: string, x: number, y = 0): void {
        const v = this.virtual_.get(id);
        if (v) { v.x = x; v.y = y; } else this.virtual_.set(id, { x, y });
    }

    getVirtual(id: string): Vec2 {
        const value = this.virtual_.get(id) ?? ZERO_VIRTUAL;
        let x = value.x, y = value.y, contributed = false;
        for (const source of this.virtualSources_.values()) {
            if (source.id !== id) continue;
            contributed = true; x += source.x; y += source.y;
        }
        return contributed ? { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) } : value;
    }

    /** A control owns only its contribution, even when several share a binding. */
    setVirtualSource(owner: object, id: string, x: number, y = 0): void {
        if (x === 0 && y === 0) { this.virtualSources_.delete(owner); return; }
        const source = this.virtualSources_.get(owner);
        if (source) { source.id = id; source.x = x; source.y = y; }
        else this.virtualSources_.set(owner, { id, x, y });
    }

    removeVirtualSource(owner: object): void { this.virtualSources_.delete(owner); }

    /** @internal Host cancellation releases managed controls, leaving manual values to their writer. */
    cancelVirtualSources(): void { this.virtualSources_.clear(); }

    /** Drop every virtual input — used when a control layer is torn down. */
    clearVirtual(): void {
        this.virtual_.clear();
        this.virtualSources_.clear();
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
    /**
     * Pads supplied by the HOST rather than by the hardware — a test harness, a
     * driver, the editor's agent. They outrank the poll at the same index: the
     * poll runs every frame, so anything merely written into {@link gamepads}
     * is gone before a system reads it.
     *
     * @beta
     */
    injectGamepad(snapshot: GamepadSnapshot): void {
        this.injected_.set(snapshot.index, snapshot);
    }

    /** Give an index (or all of them) back to the hardware. @beta */
    releaseGamepad(index?: number): void {
        if (index === undefined) this.injected_.clear();
        else this.injected_.delete(index);
    }

    private injected_ = new Map<number, GamepadSnapshot>();

    updateGamepads(snapshots: GamepadSnapshot[]): void {
        // An injected pad REPLACES the polled one at its index; a polled pad at
        // an index nobody injected is untouched, so handing the game a
        // controller does not blind it to one somebody plugged in.
        const merged = this.injected_.size === 0 ? snapshots : [
            ...snapshots.filter((s) => !this.injected_.has(s.index)),
            ...this.injected_.values(),
        ];
        for (const p of this.gamepads.values()) p.connected = false;
        for (const snap of merged) {
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
        clearActionEdges(this);
        this.keysPressed.clear();
        clearTabModifiers(this);
        this.keysReleased.clear();
        this.mouseButtonsPressed.clear();
        this.mouseButtonsReleased.clear();
        this.scrollDeltaX = 0;
        this.scrollDeltaY = 0;
        this.mouseDeltaX = 0;
        this.mouseDeltaY = 0;
        this.touchesStarted.clear();
        this.touchesEnded.clear();
    }

    /** Enter a fixed-timestep step: keyboard/mouse edge queries now read the fixed
     *  mirrors. Called by App before each FixedUpdate step. */
    beginFixedStep(): void {
        this.fixedContext_ = true;
        beginFixedActionEdges(this);
    }

    /** Leave a fixed step: drop the consumed edges (so a later step this frame
     *  doesn't see them again) and restore the render context. Edges that arrived
     *  on a frame with no fixed step are never cleared here, so they survive to the
     *  next frame's first step instead of being lost. */
    endFixedStep(): void {
        endFixedActionEdges(this);
        this.keysPressedFixed.clear();
        this.keysReleasedFixed.clear();
        this.mouseButtonsPressedFixed.clear();
        this.mouseButtonsReleasedFixed.clear();
        this.fixedContext_ = false;
    }
}

/**
 * This frame's raw input, as a resource. The input plugin writes it before any
 * game system runs, and clears the per-frame edges after the last one.
 *
 * @beta
 */
export const Input = defineResource<InputState>(new InputState(), 'Input');

const executionOwners = new WeakMap<InputState, Set<object>>();
/** Internal, per-owner execution gate for the platform event funnel. */
export function setInputExecutionHeld(state: InputState, owner: object, held: boolean): void {
    let owners = executionOwners.get(state);
    if (held) {
        if (!owners) { owners = new Set(); executionOwners.set(state, owners); }
        const wasHeld = owners.size > 0;
        owners.add(owner);
        if (!wasHeld) inputEventCallbacks(state).onInputCancel?.();
    } else {
        owners?.delete(owner);
        if (!owners?.size) executionOwners.delete(state);
    }
}

/**
 * The callbacks a platform's raw events arrive through — routed past the UI
 * first, then recorded on `state`.
 *
 * Named and exported because the platform binding is not the only caller that
 * should exist. A harness driving a running game has to be able to deliver a
 * click, and the only faithful way to do that is through the same funnel the
 * real event uses: a synthetic DOM event carries no usable `offsetX`, and
 * poking `mouseX` and `mouseButtonsPressed` by hand skips the router, so UI
 * that should have swallowed the click never sees it and gameplay behind a
 * button reacts to presses the player never made.
 *
 * One implementation, so the injected event and the real one cannot diverge.
 */
export function inputEventCallbacks(state: InputState): InputEventCallbacks {
    const finishTouch = (id: number, consumed: boolean): void => {
        if (consumed) state.touches.delete(id);
        else if (state.touches.has(id)) state.endTouch(id);
    };
    return {
        onKeyDown(code) {
            if (executionOwners.has(state)) return claimsKeyDefault(state, code);
            if (inputRouter.dispatchKeyDown(code)) return true;
            state.noteKeyDown(code);
            return claimsKeyDefault(state, code);
        },
        onKeyUp(code) {
            if (executionOwners.has(state)) return;
            if (inputRouter.dispatchKeyUp(code)) {
                state.keysDown.delete(code);
                discardActionEdges(state, 'key', code);
            }
            else if (state.keysDown.has(code)) state.noteKeyUp(code);
        },
        onPointerMove(x, y, dx, dy) {
            if (executionOwners.has(state)) return;
            // Summed before anything can consume the move: a look that follows the pointer is not a click UI should swallow.
            if (dx !== undefined && dy !== undefined && Number.isFinite(dx) && Number.isFinite(dy)) { state.mouseDeltaX += dx; state.mouseDeltaY += dy; }
            // Pointer position tracks the cursor even when consumed so
            // gameplay code that reads `getMousePosition()` (e.g. HUD
            // cursor rendering) doesn't freeze while the editor is
            // dragging a gizmo.
            state.mouseX = x;
            state.mouseY = y;
            inputRouter.dispatchPointerMove(x, y);
        },
        onPointerDown(button, x, y) {
            if (executionOwners.has(state)) return;
            state.mouseX = x;
            state.mouseY = y;
            if (inputRouter.dispatchPointerDown(button, x, y)) return;
            state.noteMouseDown(button);
        },
        onPointerUp(button) {
            if (executionOwners.has(state)) return;
            if (inputRouter.dispatchPointerUp(button)) {
                state.mouseButtons.delete(button);
                discardActionEdges(state, 'mouse', button);
                if (button === 0) cancelPrimaryPointer(state);
            }
            else if (state.mouseButtons.has(button)) state.noteMouseUp(button);
        },
        onWheel(deltaX, deltaY) {
            if (executionOwners.has(state)) return;
            if (inputRouter.dispatchWheel(deltaX, deltaY)) return;
            state.scrollDeltaX += deltaX;
            state.scrollDeltaY += deltaY;
        },
        onTouchStart(id, x, y) {
            if (executionOwners.has(state)) return;
            if (inputRouter.dispatchTouchStart(id, x, y)) return;
            const point = { id, x, y };
            state.touches.set(id, point);
            state.touchesStarted.set(id, point);
        },
        onTouchMove(id, x, y) {
            if (executionOwners.has(state)) return;
            if (inputRouter.dispatchTouchMove(id, x, y)) return;
            const existing = state.touches.get(id);
            if (existing) {
                existing.x = x;
                existing.y = y;
            }
        },
        onTouchEnd(id) {
            if (executionOwners.has(state)) return;
            finishTouch(id, inputRouter.dispatchTouchEnd(id));
        },
        onTouchCancel(id, primary) {
            if (executionOwners.has(state)) return;
            inputRouter.dispatchTouchCancel(id);
            state.touches.delete(id);
            state.touchesStarted.delete(id);
            state.touchesEnded.delete(id);
            if (primary === true || (primary === undefined && state.touches.size === 0)) {
                discardActionEdges(state, 'mouse', 0);
                state.mouseButtons.delete(0);
                state.mouseButtonsPressed.delete(0);
                state.mouseButtonsReleased.delete(0);
                state.mouseButtonsPressedFixed.delete(0);
                state.mouseButtonsReleasedFixed.delete(0);
                cancelPrimaryPointer(state);
            }
        },
        onInputCancel() {
            inputRouter.resetModifiers();
            state.keysDown.clear();
            state.mouseButtons.clear();
            state.touches.clear();
            state.cancelVirtualSources();
            state.clearFrameState();
            cancelActionEdges(state);
            state.keysPressedFixed.clear();
            state.keysReleasedFixed.clear();
            state.mouseButtonsPressedFixed.clear();
            state.mouseButtonsReleasedFixed.clear();
            cancelPrimaryPointer(state);
        },
    };
}

export class InputPlugin implements Plugin {
    name = 'input';
    private target_: unknown;
    private unbind_: (() => void) | null = null;
    private readonly executionCleanup_ = new WeakMap<App, () => void>();

    constructor(target?: unknown) {
        this.target_ = target ?? null;
    }

    build(app: App): void {
        const state = new InputState();
        app.insertResource(Input, state);
        const offExecution = app.onExecutionChange(held => setInputExecutionHeld(state, app, held));
        this.executionCleanup_.set(app, () => { offExecution(); setInputExecutionHeld(state, app, false); });

        state.touchAvailable = getPlatform().hasTouch?.() ?? false;
        getPlatform().bindInputEvents(inputEventCallbacks(state), this.target_ ?? undefined);

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

    cleanup(app?: App): void {
        if (app) { this.executionCleanup_.get(app)?.(); this.executionCleanup_.delete(app); }
        platformUnbindInputEvents();
    }
}

export const inputPlugin = new InputPlugin();
