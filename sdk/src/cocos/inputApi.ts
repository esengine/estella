// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/inputApi.ts
 * @brief   The global `input`: `input.on(Input.EventType.KEY_DOWN, ...)`, the event classes it delivers, and `KeyCode`.
 *
 * Unlike a touch listener on a node, a listener on `input` hears every event whether or not anything is under the pointer. The
 * frame's pointer, key and wheel state is turned into these events by the input system (input.ts); this file is the vocabulary:
 * the event names, `KeyCode` with the numbers Cocos uses, and the objects a handler receives.
 *
 * `KeyCode` has one entry per physical key, and the engine names keys by their DOM `code` (`'KeyA'`, `'ArrowUp'`), so the table
 * below is the pairing of the two; a key the table lacks is delivered as `KeyCode.NONE`.
 */
import { Emitter } from './emitter';
import { Vec2 } from './math';

const KEYS: Array<[name: string, value: number, code: string]> = [];
const key = (name: string, value: number, code: string): void => { KEYS.push([name, value, code]); };

for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); key(`KEY_${c}`, 65 + i, `Key${c}`); }
for (let i = 0; i < 10; i++) { key(`DIGIT_${i}`, 48 + i, `Digit${i}`); key(`NUM_${i}`, 96 + i, `Numpad${i}`); }
for (let i = 1; i <= 12; i++) key(`F${i}`, 111 + i, `F${i}`);
key('ARROW_LEFT', 37, 'ArrowLeft'); key('ARROW_UP', 38, 'ArrowUp'); key('ARROW_RIGHT', 39, 'ArrowRight'); key('ARROW_DOWN', 40, 'ArrowDown');
key('SPACE', 32, 'Space'); key('ENTER', 13, 'Enter'); key('ESCAPE', 27, 'Escape'); key('TAB', 9, 'Tab'); key('BACKSPACE', 8, 'Backspace');
key('DELETE', 46, 'Delete'); key('INSERT', 45, 'Insert'); key('HOME', 36, 'Home'); key('END', 35, 'End');
key('PAGE_UP', 33, 'PageUp'); key('PAGE_DOWN', 34, 'PageDown'); key('CAPS_LOCK', 20, 'CapsLock');
key('SHIFT_LEFT', 1016, 'ShiftLeft'); key('SHIFT_RIGHT', 2016, 'ShiftRight');
key('CTRL_LEFT', 1017, 'ControlLeft'); key('CTRL_RIGHT', 2017, 'ControlRight');
key('ALT_LEFT', 1018, 'AltLeft'); key('ALT_RIGHT', 2018, 'AltRight');
key('SEMICOLON', 186, 'Semicolon'); key('EQUAL', 187, 'Equal'); key('COMMA', 188, 'Comma'); key('DASH', 189, 'Minus');
key('PERIOD', 190, 'Period'); key('SLASH', 191, 'Slash'); key('BACKQUOTE', 192, 'Backquote'); key('BRACKET_LEFT', 219, 'BracketLeft');
key('BACKSLASH', 220, 'Backslash'); key('BRACKET_RIGHT', 221, 'BracketRight'); key('QUOTE', 222, 'Quote');
key('NUM_ADD', 107, 'NumpadAdd'); key('NUM_SUBTRACT', 109, 'NumpadSubtract'); key('NUM_MULTIPLY', 106, 'NumpadMultiply');
key('NUM_DIVIDE', 111, 'NumpadDivide'); key('NUM_DECIMAL', 110, 'NumpadDecimal'); key('NUM_LOCK', 144, 'NumLock');

export const KeyCode: Readonly<Record<string, number>> = Object.freeze({
    NONE: 0,
    ...Object.fromEntries(KEYS.map(([name, value]) => [name, value])),
});

const CODE_TO_KEYCODE = new Map(KEYS.map(([, value, code]) => [code, value]));

/** The Cocos key code of a DOM key `code`; `KeyCode.NONE` for a key the table lacks. */
export function keyCodeOf(domCode: string): number { return CODE_TO_KEYCODE.get(domCode) ?? 0; }

const EventType = Object.freeze({
    TOUCH_START: 'touch-start',
    TOUCH_MOVE: 'touch-move',
    TOUCH_END: 'touch-end',
    TOUCH_CANCEL: 'touch-cancel',
    MOUSE_DOWN: 'mouse-down',
    MOUSE_MOVE: 'mouse-move',
    MOUSE_UP: 'mouse-up',
    MOUSE_WHEEL: 'mouse-wheel',
    KEY_DOWN: 'keydown',
    KEY_PRESSING: 'key-pressing',
    KEY_UP: 'keyup',
    DEVICEMOTION: 'devicemotion',
    GAMEPAD_INPUT: 'gamepad-input',
    GAMEPAD_CHANGE: 'gamepad-change',
    HANDLE_INPUT: 'handle-input',
    HMD_INPUT: 'hmd-input',
});

export class EventKeyboard {
    stopped = false;
    constructor(public readonly keyCode: number, public readonly type: string) {}
    get isPressed(): boolean { return this.type !== EventType.KEY_UP; }
    stopPropagation(): void { this.stopped = true; }
    stopPropagationImmediate(): void { this.stopped = true; }
}

export class EventMouse {
    static readonly BUTTON_LEFT = 0;
    static readonly BUTTON_MIDDLE = 1;
    static readonly BUTTON_RIGHT = 2;
    stopped = false;
    private readonly location_: Vec2;
    private prev_: Vec2;
    private scrollX_ = 0;
    private scrollY_ = 0;
    private button_ = 0;

    constructor(public readonly type: string, x = 0, y = 0, prev?: Vec2) {
        this.location_ = new Vec2(x, y);
        this.prev_ = prev ?? new Vec2(x, y);
    }

    /** @internal */ _button(b: number): this { this.button_ = b; return this; }
    /** @internal */ _scroll(x: number, y: number): this { this.scrollX_ = x; this.scrollY_ = y; return this; }

    getButton(): number { return this.button_; }
    getLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.location_.x, this.location_.y); }
    getLocationX(): number { return this.location_.x; }
    getLocationY(): number { return this.location_.y; }
    getUILocation(out: Vec2 = new Vec2()): Vec2 { return this.getLocation(out); }
    getUILocationX(): number { return this.location_.x; }
    getUILocationY(): number { return this.location_.y; }
    getPreviousLocation(out: Vec2 = new Vec2()): Vec2 { return out.set(this.prev_.x, this.prev_.y); }
    getDelta(out: Vec2 = new Vec2()): Vec2 { return out.set(this.location_.x - this.prev_.x, this.location_.y - this.prev_.y); }
    getDeltaX(): number { return this.location_.x - this.prev_.x; }
    getDeltaY(): number { return this.location_.y - this.prev_.y; }
    getScrollX(): number { return this.scrollX_; }
    getScrollY(): number { return this.scrollY_; }
    stopPropagation(): void { this.stopped = true; }
    stopPropagationImmediate(): void { this.stopped = true; }
}

class InputTarget extends Emitter {
    static readonly EventType = EventType;
    readonly EventType = EventType;
    /** Whether the device sends orientation / motion; there is no sensor feed behind it. */
    setAccelerometerEnabled(_enabled: boolean): void { /* no sensor source */ }
    setAccelerometerInterval(_interval: number): void { /* no sensor source */ }
}

/** The `Input` class scripts name for its `EventType`, and the instance `input`. */
export const Input = InputTarget;
export const input = new InputTarget();
