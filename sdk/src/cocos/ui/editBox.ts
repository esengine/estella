// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/editBox.ts
 * @brief   `EditBox`: a view on the engine's `TextInput`, as `Label` is a view on `Text`.
 *
 * The engine's field does everything an edit box does — it takes focus on a press, holds the value and the selection on the platform's own
 * text surface (a hidden textarea on the web, the soft keyboard and its IME on a device), draws the text, the hint, the caret and the
 * selection, and scrolls to keep the caret in view. An imported scene's edit box is that field on the node that was the box, with the
 * style its two labels carried; nothing here holds a second copy of any of it. What a script reaches through `textLabel` and
 * `placeholderLabel` — a colour, a size, a string — is the field's own style, handed back as a label-shaped object.
 */
import { Component } from '../component';
import { Node } from '../node';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { TextInput, TextInputFilter, type TextInputData } from '../../ui/text/text-input';
import { TextAlign } from '../../ui/core/text';
import { FocusManager, Focusable, type FocusManagerState } from '../../ui/input/focusable';
import { UIEventType } from '../../ui/core/events';
import { EntityEvents, type EntityEventQueue } from '../../ecs/entityEvents';
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { SystemLabel } from '../../ecs/systemLabels';
import { Color } from '../math';
import { registerBuiltinComponent } from '../builtins';
import { toCocosColor, toEngineColor, viewAdapter } from './view';

const InputMode = Object.freeze({ ANY: 0, EMAIL: 1, NUMERIC: 2, PHONE_NUMBER: 3, URL: 4, DECIMAL: 5, SINGLE_LINE: 6 });
const InputFlag = Object.freeze({ PASSWORD: 0, SENSITIVE: 1, INITIAL_CAPS_WORD: 2, INITIAL_CAPS_SENTENCE: 3, INITIAL_CAPS_ALL_CHARACTERS: 4, DEFAULT: 5 });
const KeyboardReturnType = Object.freeze({ DEFAULT: 0, DONE: 1, SEND: 2, SEARCH: 3, GO: 4, NEXT: 5 });
const EventType = Object.freeze({
    EDITING_DID_BEGAN: 'editing-did-began', EDITING_DID_ENDED: 'editing-did-ended', TEXT_CHANGED: 'text-changed', EDITING_RETURN: 'editing-return',
});

/** The filter and the line mode the engine's field has for a Cocos input mode. */
function fieldMode(mode: number): { inputFilter: TextInputFilter; multiline: boolean } {
    switch (mode) {
        case InputMode.NUMERIC: return { inputFilter: TextInputFilter.Digits, multiline: false };
        case InputMode.DECIMAL: return { inputFilter: TextInputFilter.Decimal, multiline: false };
        case InputMode.PHONE_NUMBER: return { inputFilter: TextInputFilter.Phone, multiline: false };
        case InputMode.EMAIL:
        case InputMode.URL:
        case InputMode.SINGLE_LINE: return { inputFilter: TextInputFilter.None, multiline: false };
        default: return { inputFilter: TextInputFilter.None, multiline: true };
    }
}

/** The Cocos input mode a field's settings say, as far as they can: the filter decides, then the line mode. */
function modeOf(data: TextInputData): number {
    if (data.inputFilter === TextInputFilter.Digits) return InputMode.NUMERIC;
    if (data.inputFilter === TextInputFilter.Decimal) return InputMode.DECIMAL;
    if (data.inputFilter === TextInputFilter.Phone) return InputMode.PHONE_NUMBER;
    return data.multiline ? InputMode.ANY : InputMode.SINGLE_LINE;
}

/**
 * What a script holds as an edit box's `textLabel` or `placeholderLabel`: the style of the field's text or of its hint, with a label's
 * names. There is no node behind it — the engine draws the field's text itself — so the properties read and write the field.
 */
class FieldLabel {
    constructor(private readonly box: EditBox, private readonly hint: boolean) {}

    get node(): Node { return this.box.node; }
    get enabled(): boolean { return true; }
    set enabled(_v: boolean) {}

    get string(): string { return this.hint ? this.box.placeholder : this.box.string; }
    set string(v: string) { if (this.hint) this.box.placeholder = v; else this.box.string = v; }

    get color(): Color { const d = this.box._data(); return toCocosColor(this.hint ? d.placeholderColor : d.color); }
    set color(v: Color) { this.box._patch(this.hint ? { placeholderColor: toEngineColor(v) } : { color: toEngineColor(v) }); }

    get fontSize(): number { return this.box._data().fontSize; }
    set fontSize(v: number) { this.box._patch({ fontSize: v }); }
    get actualFontSize(): number { return this.fontSize; }
    get fontFamily(): string { return this.box._data().fontFamily; }
    set fontFamily(v: string) { this.box._patch({ fontFamily: v }); }

    /** The field lays its lines out at a fixed ratio of the size; a script that reads the pixel height gets that one back. */
    lineHeight = 0;
    horizontalAlign = 0;
    verticalAlign = 1;
    overflow = 0;
    enableWrapText = false;
    isBold = false;
    isItalic = false;
    isUnderline = false;
    useSystemFont = true;
    cacheMode = 0;
    updateRenderData(_force = false): void {}
    markForUpdateRenderData(_enable = true): void {}
}

export class EditBox extends Component {
    static readonly EventType = EventType;
    static readonly InputMode = InputMode;
    static readonly InputFlag = InputFlag;
    static readonly KeyboardReturnType = KeyboardReturnType;

    /** @internal */
    _data(): TextInputData { return this._world.get(this._entity, TextInput); }
    /** @internal */
    _patch(patch: Partial<TextInputData>): void { this._world.set(this._entity, TextInput, { ...this._data(), ...patch }); }

    returnType: number = KeyboardReturnType.DEFAULT;
    private readonly textLabel_ = new FieldLabel(this, false);
    private readonly placeholderLabel_ = new FieldLabel(this, true);

    get textLabel(): FieldLabel { return this.textLabel_; }
    set textLabel(_v: unknown) {}
    get placeholderLabel(): FieldLabel { return this.placeholderLabel_; }
    set placeholderLabel(_v: unknown) {}

    get string(): string { return this._data().value; }
    set string(value: string) {
        const text = value === null || value === undefined ? '' : String(value);
        // the field's own rules apply to what a script puts in as to what is typed: the caret follows to the end of it
        this._patch({ value: text, cursorPos: text.length });
    }

    /** The hint shown while the field is empty. */
    get placeholder(): string { return this._data().placeholder; }
    set placeholder(value: string) { this._patch({ placeholder: value }); }

    get maxLength(): number { return this._data().maxLength || -1; }
    set maxLength(value: number) { this._patch({ maxLength: value > 0 ? value : 0 }); }

    get inputMode(): number { return modeOf(this._data()); }
    set inputMode(value: number) { this._patch(fieldMode(value)); }

    get inputFlag(): number { return this._data().password ? InputFlag.PASSWORD : InputFlag.DEFAULT; }
    set inputFlag(value: number) { this._patch({ password: value === InputFlag.PASSWORD }); }

    get tabIndex(): number { return this._world.tryGet(this._entity, Focusable)?.tabIndex ?? 0; }
    set tabIndex(value: number) {
        const focusable = this._world.tryGet(this._entity, Focusable);
        if (focusable) this._world.set(this._entity, Focusable, { ...focusable, tabIndex: value });
    }

    get enabled(): boolean { return !this._data().readOnly; }
    set enabled(value: boolean) { this._patch({ readOnly: !value }); }

    isFocused(): boolean { return this._data().focused; }

    /** Take the keyboard, as a press on the box does. */
    focus(): void {
        focusOf.get(this._world)?.focus(this._entity, false);
    }

    /** Give the keyboard back. */
    blur(): void {
        const manager = focusOf.get(this._world);
        if (manager?.focusedEntity === this._entity) manager.blur();
    }
}

/** The focus manager of each world, learned from the frame loop that runs the systems below. */
const focusOf = new WeakMap<World, FocusManagerState>();

const hasField = (world: World, entity: Entity): boolean => world.has(entity, TextInput);
const addField = (world: World, entity: Entity): void => {
    // a text surface that holds one line unless the script says otherwise, as a Cocos box's default mode is any text with a line limit of its own
    world.insert(entity, TextInput, { ...fieldMode(InputMode.ANY), maxLength: 20 });
};

registerBuiltinComponent(EditBox, ['cc.EditBox', 'EditBox'], viewAdapter(EditBox, hasField, addField));

/** What the engine's field says happened, as the events a Cocos edit box emits on its node. */
const ToCocos: Record<string, string> = {
    [UIEventType.Focus]: EventType.EDITING_DID_BEGAN,
    [UIEventType.Blur]: EventType.EDITING_DID_ENDED,
    [UIEventType.Change]: EventType.TEXT_CHANGED,
    [UIEventType.Submit]: EventType.EDITING_RETURN,
};
const subscribed = new WeakMap<object, WeakSet<object>>();

/** Register the system that turns the field's events into the edit box's, for a script that listens on the node. */
export function declareEditBox(): void {
    addSystemToSchedule(Schedule.PreUpdate, defineSystem(
        [Res(EntityEvents), Res(FocusManager), GetWorld()],
        (events, focus, world) => {
            if (focus) focusOf.set(world, focus as FocusManagerState);
            if (!events) return;
            const queue = events as EntityEventQueue;
            let seen = subscribed.get(world);
            if (!seen) subscribed.set(world, (seen = new WeakSet()));
            if (seen.has(queue)) return;
            seen.add(queue);
            for (const [engineType, cocosType] of Object.entries(ToCocos)) {
                queue.on(engineType, (e) => {
                    // an event bubbles to interactable ancestors as copies; the node tree does its own, from the original only
                    if (e.currentTarget !== e.target || !world.valid(e.target) || !world.has(e.target, TextInput)) return;
                    const node = Node.for(world, e.target);
                    node.emit(cocosType, node.getComponent(EditBox));
                });
            }
        },
        { name: 'Cocos:EditBoxEvents', touches: { opaque: true }, runAfter: [SystemLabel.UIInteraction] },
    ));
}
