// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    inputMap.ts
 * @brief   defineInputMap — named input actions over raw input (UE5 Enhanced
 *          Input / Unity Input System analog).
 *
 * Decouples gameplay from physical keys: declare named actions ("Jump", "Move")
 * with one or more device-agnostic bindings (keyboard / mouse / gamepad, plus
 * composites), then query them by name. The binding model is plain serializable
 * data (the rebinding + persistence format), and the whole thing rides the
 * existing resource/system model — a `defineInputMap` registers ONE evaluation
 * system that reads the raw `Input` resource each frame (REARCH_INPUT.md §2.2).
 */
import { Schedule, defineSystem, addSystemToSchedule } from './system';
import { Res } from './resource';
import { Input, InputState, GamepadAxis, GamepadButton } from './input';
import { Storage } from './storage';

// =============================================================================
// Binding model (plain, serializable — also the rebind / persistence format)
// =============================================================================

export type Binding =
    | { kind: 'key'; code: string }
    | { kind: 'mouse'; button: number }
    | { kind: 'gpButton'; button: number; pad?: number }
    | { kind: 'gpAxis'; axis: number; pad?: number; scale?: number }
    | { kind: 'keys1d'; neg: string; pos: string }
    | { kind: 'keys2d'; up: string; down: string; left: string; right: string }
    | { kind: 'stick'; stick: 'left' | 'right'; pad?: number };

export type ActionType = 'button' | 'axis' | 'axis2d';

export interface ActionDef {
    type: ActionType;
    bindings: Binding[];
}

/** The serialized form of a whole map — the content of an `.inputmap` asset.
 *  Data-driven input: author/ship this JSON, then {@link loadInputMapAsset}. */
export interface InputMapAsset {
    version: number;
    actions: Record<string, ActionDef>;
}

const INPUT_MAP_ASSET_VERSION = 1;

// — Binding constructors (Capitalized, matching the engine DSL: Query/Mut/With) —
export const Key = (code: string): Binding => ({ kind: 'key', code });
export const MouseButton = (button: number): Binding => ({ kind: 'mouse', button });
export const GpButton = (button: number, pad?: number): Binding => ({ kind: 'gpButton', button, pad });
export const GpAxis = (axis: number, pad?: number, scale?: number): Binding => ({ kind: 'gpAxis', axis, pad, scale });
/** Two keys → a signed 1D axis (neg = -1, pos = +1). */
export const Keys1D = (neg: string, pos: string): Binding => ({ kind: 'keys1d', neg, pos });
/** Four keys → a 2D axis (up = +y, right = +x). */
export const Keys2D = (up: string, down: string, left: string, right: string): Binding =>
    ({ kind: 'keys2d', up, down, left, right });
/** A gamepad stick → a 2D axis (up = +y; the raw Y axis is inverted to match Keys2D). */
export const Stick = (stick: 'left' | 'right', pad?: number): Binding => ({ kind: 'stick', stick, pad });

// — Action constructors —
export const Button = (...bindings: Binding[]): ActionDef => ({ type: 'button', bindings });
export const Axis1D = (...bindings: Binding[]): ActionDef => ({ type: 'axis', bindings });
export const Axis2D = (...bindings: Binding[]): ActionDef => ({ type: 'axis2d', bindings });

// =============================================================================
// Evaluation
// =============================================================================

/** An action reads as "down" once its magnitude reaches this (digital + analog). */
const DOWN_THRESHOLD = 0.5;

interface Vec2 { x: number; y: number; }

interface ActionState {
    value: number;   // button: [0,1]; axis: [-1,1]; axis2d: magnitude [0,1]
    vec: Vec2;       // axis2d direction; scalar actions put value in x
    down: boolean;
    pressed: boolean;
    released: boolean;
}

function evalScalar(b: Binding, input: InputState): number {
    switch (b.kind) {
        case 'key': return input.isKeyDown(b.code) ? 1 : 0;
        case 'mouse': return input.isMouseButtonDown(b.button) ? 1 : 0;
        case 'gpButton': return input.getGamepadButtonValue(b.button, b.pad ?? 0);
        case 'keys1d': return (input.isKeyDown(b.pos) ? 1 : 0) - (input.isKeyDown(b.neg) ? 1 : 0);
        case 'gpAxis': return input.getGamepadAxis(b.axis, b.pad ?? 0) * (b.scale ?? 1);
        default: return 0; // keys2d / stick are 2D sources — no scalar contribution
    }
}

function evalVec(b: Binding, input: InputState): Vec2 {
    switch (b.kind) {
        case 'keys2d': return {
            x: (input.isKeyDown(b.right) ? 1 : 0) - (input.isKeyDown(b.left) ? 1 : 0),
            y: (input.isKeyDown(b.up) ? 1 : 0) - (input.isKeyDown(b.down) ? 1 : 0),
        };
        case 'stick': {
            const pad = b.pad ?? 0;
            const xAxis = b.stick === 'left' ? GamepadAxis.LeftX : GamepadAxis.RightX;
            const yAxis = b.stick === 'left' ? GamepadAxis.LeftY : GamepadAxis.RightY;
            // Gamepad Y is +down; invert so up = +y (matches Keys2D).
            return { x: input.getGamepadAxis(xAxis, pad), y: -input.getGamepadAxis(yAxis, pad) };
        }
        default: return { x: 0, y: 0 };
    }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// =============================================================================
// InputMap
// =============================================================================

/** Which device families an interactive rebind listens to. Mouse is OFF by
 *  default (so the click that started the rebind isn't captured). */
export interface ListenOptions {
    keyboard?: boolean;
    mouse?: boolean;
    gamepad?: boolean;
}

interface PendingListen {
    resolve: (binding: Binding | null) => void;
    opts: ListenOptions;
}

export class InputMap {
    private readonly defs_ = new Map<string, ActionDef>();
    private readonly state_ = new Map<string, ActionState>();
    private pendingListen_: PendingListen | null = null;

    constructor(actions: Record<string, ActionDef>) {
        for (const [name, def] of Object.entries(actions)) {
            this.defs_.set(name, def);
            this.state_.set(name, { value: 0, vec: { x: 0, y: 0 }, down: false, pressed: false, released: false });
        }
    }

    /** Recompute every action from the current raw input. Called once per frame by
     *  the registered evaluation system; edges (pressed/released) diff vs last frame. */
    evaluate(input: InputState): void {
        if (this.pendingListen_) this.scanForRebind_(input);
        for (const [name, def] of this.defs_) {
            const st = this.state_.get(name)!;
            const prevDown = st.down;

            if (def.type === 'axis2d') {
                let x = 0, y = 0;
                for (const b of def.bindings) { const v = evalVec(b, input); x += v.x; y += v.y; }
                const mag = Math.hypot(x, y);
                if (mag > 1) { x /= mag; y /= mag; }
                st.vec.x = x;
                st.vec.y = y;
                st.value = Math.min(1, mag);
            } else {
                let v = 0;
                for (const b of def.bindings) v += evalScalar(b, input);
                v = def.type === 'button' ? clamp(v, 0, 1) : clamp(v, -1, 1);
                st.value = v;
                st.vec.x = v;
                st.vec.y = 0;
            }

            st.down = Math.abs(st.value) >= DOWN_THRESHOLD;
            st.pressed = st.down && !prevDown;
            st.released = !st.down && prevDown;
        }
    }

    // — Query —
    down(name: string): boolean { return this.state_.get(name)?.down ?? false; }
    pressed(name: string): boolean { return this.state_.get(name)?.pressed ?? false; }
    released(name: string): boolean { return this.state_.get(name)?.released ?? false; }
    /** Scalar value: button [0,1], axis [-1,1], axis2d the magnitude [0,1]. */
    value(name: string): number { return this.state_.get(name)?.value ?? 0; }
    /** 2D value (axis2d); scalar actions return {value, 0}. A fresh object each call. */
    axis2d(name: string): Vec2 {
        const v = this.state_.get(name)?.vec;
        return v ? { x: v.x, y: v.y } : { x: 0, y: 0 };
    }
    actions(): string[] { return [...this.defs_.keys()]; }

    // — Rebinding + persistence (the binding model is the serialization format) —
    getBindings(name: string): Binding[] { return this.defs_.get(name)?.bindings.map((b) => ({ ...b })) ?? []; }
    /** Replace an action's bindings (no-op for an unknown action). */
    setBindings(name: string, bindings: Binding[]): void {
        const def = this.defs_.get(name);
        if (def) def.bindings = bindings.map((b) => ({ ...b }));
    }
    /** Serialize current bindings (persist via Storage). */
    toJSON(): Record<string, Binding[]> {
        const out: Record<string, Binding[]> = {};
        for (const [name, def] of this.defs_) out[name] = def.bindings.map((b) => ({ ...b }));
        return out;
    }

    /** Serialize the FULL map (action types + bindings) — an `.inputmap` asset's
     *  content. (vs {@link toJSON}, which is bindings-only for rebind persistence.) */
    toAsset(): InputMapAsset {
        const actions: Record<string, ActionDef> = {};
        for (const [name, def] of this.defs_) {
            actions[name] = { type: def.type, bindings: def.bindings.map((b) => ({ ...b })) };
        }
        return { version: INPUT_MAP_ASSET_VERSION, actions };
    }
    /** Override bindings for actions that EXIST in this map (unknown names ignored,
     *  so stale saved data for a removed action never resurrects it). */
    loadJSON(data: Record<string, Binding[]>): void {
        for (const [name, bindings] of Object.entries(data)) {
            if (this.defs_.has(name) && Array.isArray(bindings)) this.setBindings(name, bindings);
        }
    }

    // — Persistence (platform Storage) —
    /** Save current bindings under `key`. */
    save(key: string): void { Storage.setJSON(key, this.toJSON()); }
    /** Apply bindings previously {@link save}d under `key`; returns true if found. */
    load(key: string): boolean {
        const data = Storage.getJSON<Record<string, Binding[]>>(key);
        if (!data) return false;
        this.loadJSON(data);
        return true;
    }

    // — Interactive rebinding ("press any input") —
    /** Resolve with the next physical input the user presses (or null if cancelled /
     *  superseded by another listen). Drives a rebind UI — the evaluation system
     *  feeds it each frame, so the map must be installed and the app running. */
    listenForBinding(opts?: ListenOptions): Promise<Binding | null> {
        this.cancelListen();
        return new Promise((resolve) => { this.pendingListen_ = { resolve, opts: opts ?? {} }; });
    }
    /** Capture the next input and (re)bind it to `name` (replaces, or appends when `append`). */
    async rebind(name: string, opts?: ListenOptions & { append?: boolean }): Promise<Binding | null> {
        const b = await this.listenForBinding(opts);
        if (b) this.setBindings(name, opts?.append ? [...this.getBindings(name), b] : [b]);
        return b;
    }
    /** Cancel a pending {@link listenForBinding} (resolves it with null). */
    cancelListen(): void {
        const p = this.pendingListen_;
        if (p) { this.pendingListen_ = null; p.resolve(null); }
    }
    isListening(): boolean { return this.pendingListen_ !== null; }

    private scanForRebind_(input: InputState): void {
        const found = this.scanBinding_(input, this.pendingListen_!.opts);
        if (found) {
            const p = this.pendingListen_!;
            this.pendingListen_ = null;
            p.resolve(found);
        }
    }

    /** First newly-pressed input this frame, as a Binding (keyboard + gamepad by
     *  default; mouse opt-in). Axis sources aren't captured — rebinding targets
     *  discrete inputs. */
    private scanBinding_(input: InputState, opts: ListenOptions): Binding | null {
        if (opts.keyboard !== false) {
            for (const code of input.keysPressed) return Key(code);
        }
        if (opts.mouse) {
            for (const button of input.mouseButtonsPressed) return MouseButton(button);
        }
        if (opts.gamepad !== false) {
            for (const pad of input.getGamepads()) {
                for (let b = 0; b <= GamepadButton.Guide; b++) {
                    if (input.isGamepadButtonPressed(b, pad)) return GpButton(b, pad);
                }
            }
        }
        return null;
    }
}

/**
 * Define a named-action input map and register its per-frame evaluation system.
 * Returns the live map — import it and query by name from any system.
 *
 * @example
 * export const Game = defineInputMap({
 *   Move: Axis2D(Keys2D('KeyW','KeyS','KeyA','KeyD'), Stick('left')),
 *   Jump: Button(Key('Space'), GpButton(GamepadButton.South)),
 * });
 * // in a system:  if (Game.pressed('Jump')) ...;  const dir = Game.axis2d('Move');
 */
export function defineInputMap(actions: Record<string, ActionDef>): InputMap {
    const map = new InputMap(actions);
    // PreUpdate: after gamepad poll (First) + always-current event input, before gameplay (Update).
    addSystemToSchedule(
        Schedule.PreUpdate,
        defineSystem([Res(Input)], (input) => map.evaluate(input), { name: 'InputMapEval' }),
    );
    return map;
}

/**
 * Build a live InputMap from a loaded `.inputmap` asset (data-driven input —
 * fetch / import the JSON, then call this). Registers the evaluation system, same
 * as {@link defineInputMap}.
 */
export function loadInputMapAsset(asset: InputMapAsset): InputMap {
    return defineInputMap(asset.actions);
}
