// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/editBox.ts
 * @brief   `EditBox`: a text field whose box and labels are nodes of the scene, typed into through the platform's own text editor.
 *
 * The engine's `TextInput` composes its own flex-laid-out children, and an imported scene is world-space nodes: an EditBox here is the box a
 * scene already drew, a `Label` that shows what was typed and one that shows the hint. A click on the box takes focus on the OS editing surface
 * (a hidden textarea on the web, the soft keyboard and its IME on a device), whose value the labels follow. A host with no such surface shows the
 * box and does not type, as the engine's own fields do.
 */
import { Component } from '../component';
import { Node } from '../node';
import { declareClass } from '../host';
import type { EventTouch } from '../input';
import { Label } from './label';
import { UITransform } from './uiTransform';
import { EventHandler, joinHandlers } from './button';
import { platformCreateTextEditor } from '../../platform';
import type { PlatformTextEditor } from '../../platform/types';

type Handlers = Array<{ component: string; handler: string; customEventData: string }>;

const InputMode = Object.freeze({ ANY: 0, EMAIL: 1, NUMERIC: 2, PHONE_NUMBER: 3, URL: 4, DECIMAL: 5, SINGLE_LINE: 6 });
const InputFlag = Object.freeze({ PASSWORD: 0, SENSITIVE: 1, INITIAL_CAPS_WORD: 2, INITIAL_CAPS_SENTENCE: 3, INITIAL_CAPS_ALL_CHARACTERS: 4, DEFAULT: 5 });
const KeyboardReturnType = Object.freeze({ DEFAULT: 0, DONE: 1, SEND: 2, SEARCH: 3, GO: 4, NEXT: 5 });
const EventType = Object.freeze({
    EDITING_DID_BEGAN: 'editing-did-began', EDITING_DID_ENDED: 'editing-did-ended', TEXT_CHANGED: 'text-changed', EDITING_RETURN: 'editing-return',
});

/** The characters a field of this input mode takes. */
function allowed(mode: number, value: string): string {
    switch (mode) {
        case InputMode.NUMERIC: return value.replace(/[^0-9]/g, '');
        case InputMode.DECIMAL: return value.replace(/[^0-9.\-]/g, '');
        case InputMode.PHONE_NUMBER: return value.replace(/[^0-9+*#\-]/g, '');
        case InputMode.EMAIL:
        case InputMode.URL:
        case InputMode.SINGLE_LINE: return value.replace(/[\r\n]/g, '');
        default: return value;
    }
}

const BULLET = '●';

export class EditBox extends Component {
    static readonly EventType = EventType;
    static readonly InputMode = InputMode;
    static readonly InputFlag = InputFlag;
    static readonly KeyboardReturnType = KeyboardReturnType;

    maxLength = 20;
    inputMode: number = InputMode.ANY;
    inputFlag: number = InputFlag.DEFAULT;
    returnType: number = KeyboardReturnType.DEFAULT;
    tabIndex = 0;
    textLabel: Label | null = null;
    placeholderLabel: Label | null = null;

    editingDidBeganTargets: Array<Node | null> = [];
    editingDidBeganHandlers: Handlers = [];
    textChangedTargets: Array<Node | null> = [];
    textChangedHandlers: Handlers = [];
    editingDidEndedTargets: Array<Node | null> = [];
    editingDidEndedHandlers: Handlers = [];
    editingReturnTargets: Array<Node | null> = [];
    editingReturnHandlers: Handlers = [];
    editingDidBegan: EventHandler[] = [];
    textChanged: EventHandler[] = [];
    editingDidEnded: EventHandler[] = [];
    editingReturn: EventHandler[] = [];

    private string_ = '';
    private editor_: PlatformTextEditor | null = null;
    private unsubscribe_: (() => void) | null = null;

    get string(): string { return this.string_; }
    set string(value: string) {
        this.string_ = this.fit_(value);
        this.refresh_();
    }

    /** The hint shown while the field is empty. */
    get placeholder(): string { return this.placeholderLabel?.string ?? ''; }
    set placeholder(value: string) { if (this.placeholderLabel) this.placeholderLabel.string = value; }

    isFocused(): boolean { return this.editor_ !== null; }

    onLoad(): void {
        if (this.editingDidBegan.length === 0) this.editingDidBegan = joinHandlers(this.editingDidBeganTargets, this.editingDidBeganHandlers);
        if (this.textChanged.length === 0) this.textChanged = joinHandlers(this.textChangedTargets, this.textChangedHandlers);
        if (this.editingDidEnded.length === 0) this.editingDidEnded = joinHandlers(this.editingDidEndedTargets, this.editingDidEndedHandlers);
        if (this.editingReturn.length === 0) this.editingReturn = joinHandlers(this.editingReturnTargets, this.editingReturnHandlers);
    }

    onEnable(): void {
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd_, this);
        this.refresh_();
    }

    onDisable(): void {
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd_, this);
        this.blur();
    }

    private onTouchEnd_(event: EventTouch): void {
        const inside = this.node.getComponent(UITransform)?.isHit(event.getUILocation()) ?? true;
        if (inside) this.focus();
        event.stopPropagation();
    }

    /** Take the keyboard, as a click on the box does. */
    focus(): void {
        if (this.editor_ || !this.enabledInHierarchy) return;
        const editor = platformCreateTextEditor();
        if (!editor) return;   // a host with no text surface shows the field and does not type
        this.editor_ = editor;
        const end = this.string_.length;
        editor.focus(
            { value: this.string_, selectionStart: end, selectionEnd: end, backward: false },
            { multiline: this.inputMode === InputMode.ANY, maxLength: this.maxLength > 0 ? this.maxLength : 0, password: this.inputFlag === InputFlag.PASSWORD },
        );
        this.unsubscribe_ = editor.subscribe((event) => {
            if (event.kind === 'change') this.onChange_();
            else if (event.kind === 'submit') { this.fire_(this.editingReturn, EventType.EDITING_RETURN); this.blur(); }
            else if (event.kind === 'cancel' || event.kind === 'blur') this.blur();
        });
        this.refresh_();
        this.fire_(this.editingDidBegan, EventType.EDITING_DID_BEGAN);
    }

    /** Give the keyboard back. */
    blur(): void {
        const editor = this.editor_;
        if (!editor) return;
        this.editor_ = null;
        this.unsubscribe_?.();
        this.unsubscribe_ = null;
        editor.blur();
        editor.dispose();
        this.refresh_();
        this.fire_(this.editingDidEnded, EventType.EDITING_DID_ENDED);
    }

    private onChange_(): void {
        const editor = this.editor_;
        if (!editor) return;
        const state = editor.read();
        const value = this.fit_(state.value);
        if (value !== state.value) editor.write({ ...state, value, selectionStart: Math.min(state.selectionStart, value.length), selectionEnd: Math.min(state.selectionEnd, value.length) });
        if (value === this.string_) return;
        this.string_ = value;
        this.refresh_();
        EventHandler.emitEvents(this.textChanged, value, this);
        this.node.emit(EventType.TEXT_CHANGED, this);
    }

    private fit_(value: string): string {
        const text = allowed(this.inputMode, value);
        return this.maxLength > 0 && text.length > this.maxLength ? text.slice(0, this.maxLength) : text;
    }

    private fire_(handlers: EventHandler[], type: string): void {
        EventHandler.emitEvents(handlers, this);
        this.node.emit(type, this);
    }

    /** What the labels show: the text (as bullets for a password), or the hint while there is none. */
    private refresh_(): void {
        const shown = this.inputFlag === InputFlag.PASSWORD ? BULLET.repeat(this.string_.length) : this.string_;
        if (this.textLabel) this.textLabel.string = shown;
        if (this.placeholderLabel) this.placeholderLabel.node.active = this.string_ === '';
    }
}

export function declareEditBox(): void {
    declareClass(EditBox as never, 'EditBox', [
        { name: 'string_', kind: 'string' },
        { name: 'maxLength', kind: 'number' },
        { name: 'inputMode', kind: 'number' },
        { name: 'inputFlag', kind: 'number' },
        { name: 'returnType', kind: 'number' },
        { name: 'tabIndex', kind: 'number' },
        { name: 'textLabel', kind: 'component', type: Label },
        { name: 'placeholderLabel', kind: 'component', type: Label },
        { name: 'editingDidBeganTargets', kind: 'node', array: true },
        { name: 'editingDidBeganHandlers', kind: 'json' },
        { name: 'textChangedTargets', kind: 'node', array: true },
        { name: 'textChangedHandlers', kind: 'json' },
        { name: 'editingDidEndedTargets', kind: 'node', array: true },
        { name: 'editingDidEndedHandlers', kind: 'json' },
        { name: 'editingReturnTargets', kind: 'node', array: true },
        { name: 'editingReturnHandlers', kind: 'json' },
    ]);
}
