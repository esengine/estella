// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../ecs/resource';
import { defineSystem, Schedule } from '../ecs/system';
import type { App, Plugin } from '../app/app';
import { renderCanvasOf } from '../app/surface';
import { claimsKeyDefault, recordTabModifiers, clearTabModifiers } from './keyDefaultPolicy';
import { getPlatform } from '../platform';
import { InputBinding } from '../platform/listeners';
import type { GamepadSnapshot, InputEventCallbacks } from '../platform/types';
import { inputRouter } from './inputRouter';
import { cancelPrimaryPointer, takePrimaryPointerCancellation } from './pointerCancellation';
import { recordTouchEnd } from './touchEdges';
import { recordActionEdge, discardActionEdges, clearActionEdges, beginFixedActionEdges, endFixedActionEdges, cancelActionEdges } from './actionEdges';
import type { Vec2 } from '../types';
import { RuntimeConfig } from '../defaults';

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

/**
 * The buttons of a VR controller, in the WebXR `xr-standard` layout every headset browser reports: index finger, middle
 * finger, a touchpad (older controllers), the thumbstick's click, and the two face buttons (A and B on the right hand, X and
 * Y on the left). A controller without one reads it as never pressed.
 * @experimental
 */
export enum XRButton {
    Trigger = 0,
    Squeeze = 1,
    Touchpad = 2,
    Thumbstick = 3,
    /** A on the right hand, X on the left. */
    Primary = 4,
    /** B on the right hand, Y on the left. */
    Secondary = 5,
}

/** The axes of a VR controller (`xr-standard`), signed [-1, 1]; +Y is toward the player, as a gamepad's is. @experimental */
export enum XRAxis {
    TouchpadX = 0,
    TouchpadY = 1,
    ThumbstickX = 2,
    ThumbstickY = 3,
}

/** Which hand holds a VR controller. @experimental */
export type XRHandedness = 'left' | 'right';

/** The first gamepad index the VR controllers take: far past any a browser numbers its pads with. */
const XR_PAD_BASE = 1000;

/**
 * The gamepad index of the VR controller in `hand` (1000 left, 1001 right): every gamepad query and binding reaches it there,
 * `GpButton(XRButton.Trigger, xrPadIndex('right'))` among them. @experimental
 */
export function xrPadIndex(hand: XRHandedness): number {
    return XR_PAD_BASE + (hand === 'left' ? 0 : 1);
}

/** Whether a gamepad index is a VR controller's. @experimental */
export function isXRPadIndex(index: number): boolean {
    return index === XR_PAD_BASE || index === XR_PAD_BASE + 1;
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
    /** @internal Earlier taps of a reused id that also ended this frame, oldest
     *  first. `touchesEnded` keeps only the last gesture per id, so without these
     *  a second tap within one frame overwrote the first and its click was lost. */
    touchesEndedBefore: TouchPoint[] = [];

    // Fixed-timestep edge mirrors: render edges clear once per frame, but FixedUpdate runs 0..n steps a frame, so a
    // fixed system reading them drops or doubles presses. These fill with the render edges and clear per step
    // (endFixedStep): a press reaches exactly one fixed step, and edge queries read these while a step runs.
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
        recordTouchEnd(point, this.touchesStarted.get(id));
        this.touches.delete(id);
        const earlier = this.touchesEnded.get(id);
        if (earlier) this.touchesEndedBefore.push(earlier);
        this.touchesEnded.set(id, point);
    }

    // — Multi-touch —
    /**
     * Whether several fingers are handled at once. On (the default), every touch
     * reaches the UI and the game. Off, one finger at a time does: the first to
     * go down is the touch until it lifts, and a finger pressed meanwhile is
     * ignored for its whole life, by the UI and the game alike, so a second
     * finger cannot press a button or move a joystick under the first.
     */
    /** What the game set with {@link setMultiTouch}, or null to follow the project (RuntimeConfig.multiTouch). */
    private multiTouch_: boolean | null = null;
    /** Single-touch mode: the finger being handled, or null when none is down. */
    private soleTouch_: number | null = null;
    /** Single-touch mode: fingers ignored until they lift. */
    private ignoredTouches_ = new Set<number>();

    /** On unless the project turned it off (Project Settings → Runtime) or the game did. */
    isMultiTouchEnabled(): boolean {
        return this.multiTouch_ ?? RuntimeConfig.multiTouch;
    }

    /**
     * Handle several fingers at once, or one. Turning it off while several are
     * down keeps the first that went down and cancels the rest, as the platform
     * cancelling them would: their touches end with no release edge, and a UI
     * control they were pressing lets go without a click.
     */
    setMultiTouch(enabled: boolean): void {
        const was = this.isMultiTouchEnabled();
        this.multiTouch_ = enabled;
        if (enabled === was) return;
        this.ignoredTouches_.clear();
        this.soleTouch_ = null;
        if (enabled) return;
        const down = [...this.touches.keys()];
        this.soleTouch_ = down[0] ?? null;
        for (const id of down.slice(1)) {
            inputRouter.dispatchTouchCancel(id);
            this.touches.delete(id);
            this.touchesStarted.delete(id);
            this.touchesEnded.delete(id);
            this.ignoredTouches_.add(id);
        }
    }

    /** @internal Whether a finger going down is handled; records it as the one in single-touch mode. */
    admitTouch(id: number): boolean {
        if (this.isMultiTouchEnabled()) return true;
        if (this.soleTouch_ === null || this.soleTouch_ === id) {
            this.soleTouch_ = id;
            return true;
        }
        this.ignoredTouches_.add(id);
        return false;
    }

    /** @internal Whether a finger's move, lift or cancel is ignored; a lift or cancel also retires it. */
    touchIgnored(id: number, retiring = false): boolean {
        if (this.ignoredTouches_.has(id)) {
            if (retiring) this.ignoredTouches_.delete(id);
            return true;
        }
        if (retiring && this.soleTouch_ === id) this.soleTouch_ = null;
        return false;
    }

    /** @internal Every finger is gone (focus lost, the app hidden). */
    forgetTouches(): void {
        this.soleTouch_ = null;
        this.ignoredTouches_.clear();
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

    // — VR controllers (set each headset frame by the session) —
    // They are gamepads at two indices of their own ({@link xrPadIndex}), so every gamepad query, binding and rebind reaches
    // them; these methods read them by hand. Their layout is `xr-standard`, not the standard one: query them with XRButton.

    /** Whether the controller in `hand` is tracked now. @experimental */
    isXRControllerConnected(hand: XRHandedness): boolean {
        return this.isGamepadConnected(xrPadIndex(hand));
    }

    /** Whether `button` on the controller in `hand` is held down (an analog one at or past {@link gamepadButtonThreshold}). @experimental */
    isXRButtonDown(button: XRButton, hand: XRHandedness): boolean {
        return this.isGamepadButtonDown(button, xrPadIndex(hand));
    }

    /** Whether `button` went down this frame. @experimental */
    isXRButtonPressed(button: XRButton, hand: XRHandedness): boolean {
        return this.isGamepadButtonPressed(button, xrPadIndex(hand));
    }

    /** Whether `button` came up this frame. @experimental */
    isXRButtonReleased(button: XRButton, hand: XRHandedness): boolean {
        return this.isGamepadButtonReleased(button, xrPadIndex(hand));
    }

    /** How far `button` is pressed, 0..1 (a trigger is analog; a face button is 0 or 1). @experimental */
    getXRButtonValue(button: XRButton, hand: XRHandedness): number {
        return this.getGamepadButtonValue(button, xrPadIndex(hand));
    }

    /** An axis of the controller in `hand`, with the gamepad dead zone applied. @experimental */
    getXRAxis(axis: XRAxis, hand: XRHandedness): number {
        return this.getGamepadAxis(axis, xrPadIndex(hand));
    }

    /**
     * This headset frame's controllers, into their gamepad indices: the previous values become the ones edges are measured
     * from, and a hand not in `controllers` reads as disconnected. The XR session calls it once a frame; an empty list when it
     * ends. @experimental
     */
    updateXRControllers(controllers: ReadonlyArray<{ hand: string; buttons: number[]; axes: number[] }>): void {
        const seen = new Set<number>();
        for (const c of controllers) {
            if (c.hand !== 'left' && c.hand !== 'right') continue;
            const index = xrPadIndex(c.hand);
            this.updateConnectedPad_(index, c.buttons, c.axes);
            seen.add(index);
        }
        for (const hand of ['left', 'right'] as const) {
            const p = this.gamepads.get(xrPadIndex(hand));
            if (p && !seen.has(xrPadIndex(hand))) p.connected = false;
        }
    }

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
     *  True while the pointer is over a UI node that takes it. */
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
    private readonly polledPadIndices_ = new Set<number>();

    private updateConnectedPad_(index: number, buttons: number[], axes: number[]): void {
        let pad = this.gamepads.get(index);
        if (!pad) {
            pad = { connected: false, buttons: [], prevButtons: [], axes: [] };
            this.gamepads.set(index, pad);
        }
        // A reconnected controller starts with no button history from the last connection.
        pad.prevButtons = pad.connected ? pad.buttons : [];
        pad.buttons = buttons;
        pad.axes = axes;
        pad.connected = true;
    }

    updateGamepads(snapshots: GamepadSnapshot[]): void {
        // An injected pad REPLACES the polled one at its index; a polled pad at
        // an index nobody injected is untouched, so handing the game a
        // controller does not blind it to one somebody plugged in.
        const merged = this.injected_.size === 0 ? snapshots : [
            ...snapshots.filter((s) => !this.injected_.has(s.index)),
            ...this.injected_.values(),
        ];
        const seen = this.polledPadIndices_;
        seen.clear();
        for (const snap of merged) {
            if (snap.connected) {
                seen.add(snap.index);
                this.updateConnectedPad_(snap.index, snap.buttons, snap.axes);
            } else {
                seen.delete(snap.index);
                const pad = this.gamepads.get(snap.index);
                if (pad) pad.connected = false;
            }
        }
        // The VR controllers' indices are the session's, not the poll's.
        for (const [index, pad] of this.gamepads) if (!isXRPadIndex(index) && !seen.has(index)) pad.connected = false;
    }

    clearFrameState(): void {
        mousePresses.delete(this);
        wheelFrames.delete(this);
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
        this.touchesEndedBefore.length = 0;
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
const mousePresses = new WeakMap<InputState, Vec2>();
interface PositionedWheel {
    x: number;
    y: number;
    deltaX: number;
    deltaY: number;
}
interface WheelFrame {
    readonly samples: PositionedWheel[];
    unpositionedX: number;
    unpositionedY: number;
    totalX: number;
    totalY: number;
}
const wheelFrames = new WeakMap<InputState, WheelFrame>();

/** @internal Wheel input grouped by whether the host supplied a canvas position. */
export function wheelFrame(state: InputState): Readonly<WheelFrame> | undefined {
    return wheelFrames.get(state);
}

/** @internal The hover fallback also accepts direct writes to the public totals. */
export function unpositionedWheelDelta(state: InputState, frame: Readonly<WheelFrame> | undefined): Vec2 | undefined {
    const x = (frame?.unpositionedX ?? 0) + (state.scrollDeltaX - (frame?.totalX ?? 0));
    const y = (frame?.unpositionedY ?? 0) + (state.scrollDeltaY - (frame?.totalY ?? 0));
    return x !== 0 || y !== 0 ? { x, y } : undefined;
}

/** The primary mouse press before a move or release superseded its position. */
export function mousePressPoint(state: InputState): Vec2 | undefined { return mousePresses.get(state); }
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
    const discardMouse = (button: number): boolean => {
        const held = state.mouseButtons.delete(button);
        discardActionEdges(state, 'mouse', button);
        state.mouseButtonsPressed.delete(button);
        state.mouseButtonsReleased.delete(button);
        state.mouseButtonsPressedFixed.delete(button);
        state.mouseButtonsReleasedFixed.delete(button);
        return held;
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
            if (button === 0 && !state.mouseButtons.has(0)) mousePresses.set(state, { x, y });
            state.noteMouseDown(button);
        },
        onPointerUp(button, x, y) {
            if (executionOwners.has(state)) return;
            if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
                state.mouseX = x;
                state.mouseY = y;
            }
            if (inputRouter.dispatchPointerUp(button)) {
                state.mouseButtons.delete(button);
                discardActionEdges(state, 'mouse', button);
                if (button === 0) cancelPrimaryPointer(state);
            }
            else if (state.mouseButtons.has(button)) state.noteMouseUp(button);
        },
        onPointerCancel(button) {
            if (discardMouse(button) && button === 0) cancelPrimaryPointer(state);
        },
        onWheel(deltaX, deltaY, x, y) {
            if (executionOwners.has(state)) return;
            const positioned = x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y);
            if (positioned) {
                state.mouseX = x;
                state.mouseY = y;
            }
            if (inputRouter.dispatchWheel(deltaX, deltaY)) return;
            if (deltaX === 0 && deltaY === 0) return;
            let frame = wheelFrames.get(state);
            if (!frame) {
                frame = { samples: [], unpositionedX: 0, unpositionedY: 0, totalX: 0, totalY: 0 };
                wheelFrames.set(state, frame);
            }
            // Keep direct writes made between host events in the hover fallback.
            frame.unpositionedX += state.scrollDeltaX - frame.totalX;
            frame.unpositionedY += state.scrollDeltaY - frame.totalY;
            state.scrollDeltaX += deltaX;
            state.scrollDeltaY += deltaY;
            frame.totalX = state.scrollDeltaX;
            frame.totalY = state.scrollDeltaY;
            if (positioned) {
                frame.samples.push({ x, y, deltaX, deltaY });
            } else {
                frame.unpositionedX += deltaX;
                frame.unpositionedY += deltaY;
            }
        },
        onTouchStart(id, x, y) {
            if (executionOwners.has(state)) return;
            // Before the UI: with multi-touch off, a second finger presses nothing.
            if (!state.admitTouch(id)) return;
            if (inputRouter.dispatchTouchStart(id, x, y)) return;
            const point = { id, x, y };
            state.touches.set(id, point);
            state.touchesStarted.set(id, { ...point });
        },
        onTouchMove(id, x, y) {
            if (executionOwners.has(state)) return;
            if (state.touchIgnored(id)) return;
            if (inputRouter.dispatchTouchMove(id, x, y)) return;
            const existing = state.touches.get(id);
            if (existing) {
                existing.x = x;
                existing.y = y;
            }
        },
        onTouchEnd(id, x, y) {
            if (executionOwners.has(state)) return;
            if (state.touchIgnored(id, true)) return;
            const touch = state.touches.get(id);
            if (touch && x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
                touch.x = x;
                touch.y = y;
            }
            finishTouch(id, inputRouter.dispatchTouchEnd(id));
        },
        onTouchCancel(id, primary) {
            if (executionOwners.has(state)) return;
            if (state.touchIgnored(id, true)) return;
            inputRouter.dispatchTouchCancel(id);
            state.touches.delete(id);
            state.touchesStarted.delete(id);
            state.touchesEnded.delete(id);
            if (primary === true || (primary === undefined && state.touches.size === 0)) {
                discardMouse(0);
                cancelPrimaryPointer(state);
            }
        },
        onInputCancel() {
            if (!hostInput.owner || hostInput.owner === state) inputRouter.resetModifiers();
            state.keysDown.clear();
            state.mouseButtons.clear();
            for (const pad of state.gamepads.values()) pad.connected = false;
            state.touches.clear();
            state.forgetTouches();
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

// The selected platform and its input router are shared within a realm.
// Release the old host even when the next App selects a different adapter.
const hostInput = new InputBinding<InputState>();

export class InputPlugin implements Plugin {
    name = 'input';
    private target_: unknown;
    private readonly cleanup_ = new WeakMap<App, () => void>();
    private activeApp_?: App;

    constructor(target?: unknown) {
        this.target_ = target ?? null;
    }

    build(app: App): void {
        const platform = getPlatform();
        const state = new InputState();
        app.insertResource(Input, state);
        const offExecution = app.onExecutionChange(held => setInputExecutionHeld(state, app, held));
        const callbacks = inputEventCallbacks(state);
        this.cleanup_.set(app, () => {
            offExecution();
            setInputExecutionHeld(state, app, false);
            hostInput.unbind(state);
        });

        state.touchAvailable = platform.hasTouch?.() ?? false;
        hostInput.bind(state, scope => {
            this.activeApp_ = app;
            scope.add(() => platform.unbindInputEvents?.(callbacks));
            scope.add(() => {
                this.activeApp_ = undefined;
                state.updateGamepads([]);
            });
            inputRouter.resetModifiers();
            platform.bindInputEvents(callbacks, this.target_ ?? renderCanvasOf(app));
        });

        // Gamepads are polled (no DOM events). Web supplies pollGamepads; platforms
        // without it (WeChat, headless) skip gamepad input. Runs in First so the
        // freshest pad state is up before any gameplay / action-map system reads it.
        if (platform.pollGamepads) {
            const poll = platform.pollGamepads.bind(platform);
            app.addSystemToSchedule(Schedule.First, defineSystem([], () => {
                state.updateGamepads(hostInput.owner === state ? poll() : []);
            }, { name: 'GamepadPollSystem' }));
        }

        app.addSystemToSchedule(Schedule.Last, defineSystem([], () => {
            state.clearFrameState();
        }, { name: 'InputClearSystem' }));
    }

    cleanup(app?: App): void {
        const owner = app ?? this.activeApp_;
        if (!owner) return;
        const cleanup = this.cleanup_.get(owner);
        this.cleanup_.delete(owner);
        cleanup?.();
    }
}

export const inputPlugin = new InputPlugin();
