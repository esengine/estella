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
 * existing resource/system model — evaluation reads the raw `Input` resource
 * independently for render frames and fixed simulation steps.
 */
import { Schedule, defineSystem, addSystemToSchedule } from '../ecs/system';
import { Res } from '../ecs/resource';
import { SystemLabel } from '../ecs/systemLabels';
import { Input, InputState, GamepadAxis, GamepadButton } from './input';
import { Storage } from '../util/storage';
import type { Vec2 } from '../types';
import { actionEdges, type ActionEdge } from './actionEdges';

// =============================================================================
// Binding model (plain, serializable — also the rebind / persistence format)
// =============================================================================

/**
 * One physical source for an action. Plain serializable data on purpose: this is
 * also the rebind and persistence format, so what a player remaps is the same
 * shape a `.inputmap` asset ships.
 *
 * @public
 */
export type Binding =
    | { kind: 'key'; code: string }
    | { kind: 'mouse'; button: number }
    | { kind: 'gpButton'; button: number; pad?: number }
    | { kind: 'gpAxis'; axis: number; pad?: number; scale?: number }
    | { kind: 'keys1d'; neg: string; pos: string }
    | { kind: 'keys2d'; up: string; down: string; left: string; right: string }
    | { kind: 'stick'; stick: 'left' | 'right'; pad?: number }
    | { kind: 'virtual'; id: string };

/**
 * How an action's bindings combine: a digital `button`, a signed 1D `axis`, or a
 * 2D `axis2d`. It decides which query answers — `pressed`/`down` for a button,
 * `value` for an axis, `axis2d` for the last.
 *
 * @public
 */
export type ActionType = 'button' | 'axis' | 'axis2d';

/**
 * A named action: what kind of value it produces and every source that feeds it.
 * Bindings are alternatives, not a chord — whichever is strongest this frame wins.
 *
 * @public
 */
export interface ActionDef {
    type: ActionType;
    bindings: Binding[];
}

/**
 * The serialized form of a whole map — the content of an `.inputmap` asset.
 * Data-driven input: author/ship this JSON, then {@link loadInputMapAsset}.
 * `version` is the asset format's, so an older file stays readable.
 *
 * @public
 */
export interface InputMapAsset {
    version: number;
    actions: Record<string, ActionDef>;
}

const INPUT_MAP_ASSET_VERSION = 1;

// — Binding constructors (Capitalized, matching the engine DSL: Query/Mut/With) —
/** A keyboard key, by `KeyboardEvent.code` — physical position, not the character
 *  it types, so WASD stays WASD on AZERTY.
 *  @public */
export const Key = (code: string): Binding => ({ kind: 'key', code });
/** A mouse button, by the DOM numbering (0 = left, 1 = middle, 2 = right) — and
 *  those three by name, so `MouseButton.Left` reads the same in a binding
 *  (`MouseButton(MouseButton.Left)`) and in a direct query
 *  (`input.isMouseButtonDown(MouseButton.Left)`). Before the names existed
 *  `MouseButton.Left` was undefined, and a query with it was never true.
 *  @public */
export const MouseButton = Object.assign(
    (button: number): Binding => ({ kind: 'mouse', button }),
    { Left: 0, Middle: 1, Right: 2 } as const,
);
/** A gamepad button — see {@link GamepadButton}. `pad` defaults to the first one.
 *  @public */
export const GpButton = (button: number, pad?: number): Binding => ({ kind: 'gpButton', button, pad });
/** A gamepad axis — see {@link GamepadAxis}. `scale` multiplies the reading, so
 *  `-1` inverts a stick axis that points the other way.
 *  @public */
export const GpAxis = (axis: number, pad?: number, scale?: number): Binding => ({ kind: 'gpAxis', axis, pad, scale });
/** Two keys → a signed 1D axis (neg = -1, pos = +1).
 *  @public */
export const Keys1D = (neg: string, pos: string): Binding => ({ kind: 'keys1d', neg, pos });
/** Four keys → a 2D axis (up = +y, right = +x).
 *  @public */
export const Keys2D = (up: string, down: string, left: string, right: string): Binding =>
    ({ kind: 'keys2d', up, down, left, right });
/** A gamepad stick → a 2D axis (up = +y; the raw Y axis is inverted to match Keys2D).
 *  @public */
export const Stick = (stick: 'left' | 'right', pad?: number): Binding => ({ kind: 'stick', stick, pad });
/**
 * A named value the game writes itself (`Input.setVirtual`) — an on-screen
 * stick or button, which is the only input a touch device has. Works as a
 * scalar or a 2D source, so one kind covers both.
 *
 * @public
 */
export const Virtual = (id: string): Binding => ({ kind: 'virtual', id });

// — Action constructors —
/** A digital action, read with `pressed`/`down`/`released`. Alternatives use the
 *  strongest value; an analog source counts as down past half its range.
 *  A complete keyboard/mouse tap between samples sets both edge flags while
 *  leaving `down` false and the sampled value at zero.
 *  @public */
export const Button = (...bindings: Binding[]): ActionDef => ({ type: 'button', bindings });
/** A signed 1D action in [-1, 1], read with `value`.
 *  @public */
export const Axis1D = (...bindings: Binding[]): ActionDef => ({ type: 'axis', bindings });
/** A 2D action, read with `axis2d`. Diagonals are not normalised — the vector is
 *  what the sources produced.
 *  @public */
export const Axis2D = (...bindings: Binding[]): ActionDef => ({ type: 'axis2d', bindings });

// =============================================================================
// Evaluation
// =============================================================================

/** An action reads as "down" once its magnitude reaches this (digital + analog). */
const DOWN_THRESHOLD = 0.5;


interface ActionState {
    tapSequence: number;
    pendingPressed: boolean;
    pendingReleased: boolean;
    value: number;   // button: [0,1]; axis: [-1,1]; axis2d: magnitude [0,1]
    vec: Vec2;       // axis2d direction; scalar actions put value in x
    down: boolean;
    pressed: boolean;
    released: boolean;
}

function observedButtonEdges(bindings: Binding[], input: InputState,
    events: readonly ActionEdge[], after: number, previouslyDown: boolean): number {
    let relevant: ActionEdge[] | undefined;
    for (const event of events) {
        if (event.sequence <= after) continue;
        if (bindings.some(binding => event.source === 'mouse'
            ? binding.kind === 'mouse' && binding.button === event.code
            : binding.kind === 'key' && binding.code === event.code
                || binding.kind === 'keys1d' && (binding.neg === event.code || binding.pos === event.code))) {
            (relevant ??= []).push(event);
        }
    }
    if (!relevant) return 0;
    const digital = new Map<string | number, boolean>();
    let other = 0;
    for (const binding of bindings) {
        if (binding.kind === 'key') digital.set(binding.code, input.isKeyDown(binding.code));
        else if (binding.kind === 'mouse') digital.set(binding.button, input.isMouseButtonDown(binding.button));
        else if (binding.kind === 'keys1d') {
            digital.set(binding.neg, input.isKeyDown(binding.neg));
            digital.set(binding.pos, input.isKeyDown(binding.pos));
        } else other = Math.max(other, evalScalar(binding, input));
    }
    for (let i = relevant.length - 1; i >= 0; i--) digital.set(relevant[i].code, !relevant[i].down);
    const down = (): boolean => {
        let value = other;
        for (const binding of bindings) {
            if (binding.kind === 'key') value = Math.max(value, digital.get(binding.code) ? 1 : 0);
            else if (binding.kind === 'mouse') value = Math.max(value, digital.get(binding.button) ? 1 : 0);
            else if (binding.kind === 'keys1d') value = Math.max(value,
                Number(digital.get(binding.pos)) - Number(digital.get(binding.neg)));
        }
        return value >= DOWN_THRESHOLD;
    };
    let held = down(), flags = 0;
    for (const event of relevant) {
        digital.set(event.code, event.down);
        const next = down();
        if (held && !next && (previouslyDown || (flags & 1))) flags |= 2;
        if (!held && next && (!previouslyDown || (flags & 2))) flags |= 1;
        held = next;
    }
    return flags;
}

function evalScalar(b: Binding, input: InputState): number {
    switch (b.kind) {
        case 'key': return input.isKeyDown(b.code) ? 1 : 0;
        case 'mouse': return input.isMouseButtonDown(b.button) ? 1 : 0;
        case 'gpButton': return input.getGamepadButtonValue(b.button, b.pad ?? 0);
        case 'keys1d': return (input.isKeyDown(b.pos) ? 1 : 0) - (input.isKeyDown(b.neg) ? 1 : 0);
        case 'gpAxis': return input.getGamepadAxis(b.axis, b.pad ?? 0) * (b.scale ?? 1);
        case 'virtual': return input.getVirtual(b.id).x;
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
        case 'virtual': {
            const v = input.getVirtual(b.id);
            return { x: v.x, y: v.y };
        }
        default: return { x: 0, y: 0 };
    }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// =============================================================================
// InputMap
// =============================================================================

/**
 * Which device families an interactive rebind listens to. Mouse is OFF by default
 * (so the click that started the rebind isn't captured).
 *
 * @public
 */
export interface ListenOptions {
    keyboard?: boolean;
    mouse?: boolean;
    gamepad?: boolean;
}

interface PendingListen {
    resolve: (binding: Binding | null) => void;
    opts: ListenOptions;
}

/**
 * A live set of named actions, as {@link defineInputMap} answers it. Query it by
 * name from a system. Every read within a render frame or fixed simulation step
 * sees the same values; edges reach each cadence independently, once.
 *
 * @public
 */
export class InputMap {
    private readonly defs_ = new Map<string, ActionDef>();
    private readonly state_ = new Map<string, ActionState>();
    private readonly fixedState_ = new Map<string, ActionState>();
    private pendingListen_: PendingListen | null = null;
    private tapOwner_: { fixed: boolean; cancellation: number } | undefined;
    private cancellation_ = 0;

    constructor(actions: Record<string, ActionDef>) {
        for (const [name, def] of Object.entries(actions)) {
            this.defs_.set(name, def);
            this.state_.set(name, { value: 0, vec: { x: 0, y: 0 }, down: false, pressed: false, released: false, tapSequence: 0, pendingPressed: false, pendingReleased: false });
            this.fixedState_.set(name, { ...this.state_.get(name)!, vec: { x: 0, y: 0 } });
        }
    }

    /** @internal Recompute the active cadence. Render evaluation also buffers
     *  edges for the next fixed step; complete physical taps survive between
     *  samples alongside the normal held-state transitions. */
    evaluate(input: InputState): void {
        const edges = actionEdges(input);
        const tapOwner = edges.owner;
        if (this.tapOwner_ !== tapOwner) {
            this.tapOwner_ = tapOwner;
            for (const states of [this.state_, this.fixedState_]) {
                for (const state of states.values()) state.tapSequence = 0;
            }
            for (const state of this.fixedState_.values()) state.pendingPressed = state.pendingReleased = false;
        }
        if (this.cancellation_ !== tapOwner.cancellation) {
            this.cancellation_ = tapOwner.cancellation;
            for (const state of this.fixedState_.values()) state.pendingPressed = state.pendingReleased = false;
        }
        if (tapOwner.fixed) this.evaluateStates_(input, this.fixedState_, false);
        else {
            if (this.pendingListen_) this.scanForRebind_(input);
            this.evaluateStates_(input, this.state_, false);
            this.evaluateStates_(input, this.fixedState_, true);
        }
    }

    private evaluateStates_(input: InputState, states: Map<string, ActionState>, buffer: boolean): void {
        const edges = actionEdges(input);
        for (const [name, def] of this.defs_) {
            const st = states.get(name)!;
            const prevDown = st.down;

            if (buffer) {
                const sampled = this.state_.get(name)!;
                st.value = sampled.value;
                st.vec.x = sampled.vec.x;
                st.vec.y = sampled.vec.y;
            } else if (def.type === 'axis2d') {
                let x = 0, y = 0;
                for (const b of def.bindings) { const v = evalVec(b, input); x += v.x; y += v.y; }
                const mag = Math.hypot(x, y);
                if (mag > 1) { x /= mag; y /= mag; }
                st.vec.x = x;
                st.vec.y = y;
                st.value = Math.min(1, mag);
            } else {
                let v = 0;
                for (const b of def.bindings) {
                    const value = evalScalar(b, input);
                    if (def.type === 'button') {
                        v = Math.max(v, value);
                    } else v += value;
                }
                v = def.type === 'button' ? clamp(v, 0, 1) : clamp(v, -1, 1);
                st.value = v;
                st.vec.x = v;
                st.vec.y = 0;
            }

            st.down = Math.abs(st.value) >= DOWN_THRESHOLD;
            st.pressed = st.down && !prevDown;
            st.released = !st.down && prevDown;
            if (def.type === 'button' && edges.events.length) {
                const observed = observedButtonEdges(def.bindings, input, edges.events, st.tapSequence, prevDown);
                st.pressed ||= !!(observed & 1);
                st.released ||= !!(observed & 2);
            }
            // A held alternative absorbs taps too, so releasing it cannot replay
            // an earlier pulse. Each map owns its watermark independently.
            st.tapSequence = edges.sequence;
            if (buffer) {
                // Constant space per action even if no simulation step runs for
                // many render frames. Raw frame events can be cleared normally.
                st.pendingPressed ||= st.pressed;
                st.pendingReleased ||= st.released;
            } else if (states === this.fixedState_) {
                st.pressed ||= st.pendingPressed;
                st.released ||= st.pendingReleased;
                st.pendingPressed = st.pendingReleased = false;
            }
        }
    }

    private readStates_(): Map<string, ActionState> {
        return this.tapOwner_?.fixed ? this.fixedState_ : this.state_;
    }

    // — Query —
    down(name: string): boolean { return this.readStates_().get(name)?.down ?? false; }
    pressed(name: string): boolean { return this.readStates_().get(name)?.pressed ?? false; }
    released(name: string): boolean { return this.readStates_().get(name)?.released ?? false; }
    /** Scalar value: button [0,1], axis [-1,1], axis2d the magnitude [0,1]. */
    value(name: string): number { return this.readStates_().get(name)?.value ?? 0; }
    /** 2D value (axis2d); scalar actions return {value, 0}. A fresh object each call. */
    axis2d(name: string): Vec2 {
        const v = this.readStates_().get(name)?.vec;
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
 * Define a named-action input map and register render/fixed evaluation systems.
 * Returns the live map — import it and query by name from any system.
 *
 * @example
 * export const Game = defineInputMap({ Jump: Button(Key('Space'), GpButton(GamepadButton.South)) });
 * // In a system: if (Game.pressed('Jump')) jump();
 *
 * @public
 */
export function defineInputMap(actions: Record<string, ActionDef>): InputMap {
    const map = new InputMap(actions);
    addSystemToSchedule(
        Schedule.FixedPreUpdate,
        defineSystem([Res(Input)], (input) => map.evaluate(input), { name: 'InputMapFixedEval' }),
    );
    // PreUpdate: after gamepad poll (First) + always-current event input, before gameplay (Update).
    addSystemToSchedule(
        Schedule.PreUpdate,
        defineSystem([Res(Input)], (input) => map.evaluate(input), { name: 'InputMapEval', runAfter: [SystemLabel.UIInteraction, SystemLabel.VirtualControls] }),
    );
    return map;
}

/**
 * Build a live InputMap from a loaded `.inputmap` asset (data-driven input —
 * fetch / import the JSON, then call this). Registers the evaluation system, same
 * as {@link defineInputMap}. Not frozen: no project we certify releases against
 * loads a map from an asset, so nothing holds this signature up.
 */
export function loadInputMapAsset(asset: InputMapAsset): InputMap {
    return defineInputMap(asset.actions);
}
