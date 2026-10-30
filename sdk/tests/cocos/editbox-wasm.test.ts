// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditBox: a click takes the platform's text editor, what is typed lands in the labels, and the field's rules (mode, length, hint) hold.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { EditBox, Label, Node, UITransform } from '../../src/cocos';
import type { PlatformTextEditor, TextEditorEvent, TextEditorState } from '../../src/platform/types';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';
import { pointerApp, type PointerApp } from './helpers/pointerApp';

/** A text surface the test types into. */
class FakeEditor implements PlatformTextEditor {
    state: TextEditorState = { value: '', selectionStart: 0, selectionEnd: 0, backward: false };
    options: unknown = null;
    focused = false;
    disposed = false;
    private handlers: Array<(e: TextEditorEvent) => void> = [];
    focus(state: TextEditorState, options: unknown): void { this.state = { ...state }; this.options = options; this.focused = true; }
    blur(): void { this.focused = false; }
    read(): TextEditorState { return { ...this.state }; }
    write(state: TextEditorState): void { this.state = { ...state }; }
    subscribe(h: (e: TextEditorEvent) => void): () => void { this.handlers.push(h); return () => { this.handlers = this.handlers.filter((x) => x !== h); }; }
    dispose(): void { this.disposed = true; }
    type(value: string): void { this.state = { ...this.state, value, selectionStart: value.length, selectionEnd: value.length }; this.emit({ kind: 'change' }); }
    emit(e: TextEditorEvent): void { for (const h of [...this.handlers]) h(e); }
}

let editor: FakeEditor | null;
vi.mock('../../src/platform', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../src/platform')>()),
    platformCreateTextEditor: () => editor,
}));

describe.skipIf(!HAS_WASM)('EditBox', () => {
    let module: ESEngineModule;
    let P: PointerApp | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    beforeEach(() => { editor = new FakeEditor(); });
    afterEach(() => { P?.dispose(); P = undefined; });

    function box(name: string, x: number, y: number, w: number, h: number, parent?: Node): Node {
        const n = new Node(name);
        P!.app.world.insert(n._entity, Transform);
        n.addComponent(UITransform)!.setContentSize(w, h);
        n.setPosition(x, y, 0);
        parent?.addChild(n);
        return n;
    }

    async function field(configure: (e: EditBox) => void = () => {}): Promise<{ node: Node; edit: EditBox; text: Label; hint: Label }> {
        P = pointerApp(module);
        const node = box('input', 200, 200, 160, 40);
        const text = box('text', 0, 0, 150, 30, node).addComponent(Label)!;
        const hint = box('hint', 0, 0, 150, 30, node).addComponent(Label)!;
        hint.string = 'type here';
        const edit = node.addComponent<EditBox>('EditBox')!;
        edit.textLabel = text;
        edit.placeholderLabel = hint;
        configure(edit);
        await P.frame(1);
        return { node, edit, text, hint };
    }

    it('takes the text editor on a click, and tells the field\'s listeners', async () => {
        const { node, edit } = await field();
        const seen: string[] = [];
        node.on(EditBox.EventType.EDITING_DID_BEGAN, () => seen.push('began'));
        await P!.tap(200, 200);
        expect(editor!.focused).toBe(true);
        expect(edit.isFocused()).toBe(true);
        expect(seen).toEqual(['began']);
    });

    it('shows what is typed in its label and hides the hint, and brings the hint back when it is emptied', async () => {
        const { node, edit, text, hint } = await field();
        const changed: string[] = [];
        node.on(EditBox.EventType.TEXT_CHANGED, (e: EditBox) => changed.push(e.string));
        expect(hint.node.active).toBe(true);
        await P!.tap(200, 200);
        editor!.type('hello');
        expect(edit.string).toBe('hello');
        expect(text.string).toBe('hello');
        expect(hint.node.active).toBe(false);
        editor!.type('');
        expect(hint.node.active).toBe(true);
        expect(changed).toEqual(['hello', '']);
    });

    it('holds to the length and the characters its mode takes, writing the fit text back to the surface', async () => {
        const { edit } = await field((e) => { e.maxLength = 4; e.inputMode = EditBox.InputMode.NUMERIC; });
        await P!.tap(200, 200);
        editor!.type('12ab3456');
        expect(edit.string).toBe('1234');
        expect(editor!.state.value).toBe('1234');
    });

    it('shows bullets for a password and keeps the real text', async () => {
        const { edit, text } = await field((e) => { e.inputFlag = EditBox.InputFlag.PASSWORD; });
        await P!.tap(200, 200);
        editor!.type('secret');
        expect(edit.string).toBe('secret');
        expect(text.string).toBe('●●●●●●');
        expect((editor!.options as { password: boolean }).password).toBe(true);
    });

    it('ends on submit with a return event and then an end event, giving the surface back', async () => {
        const { node, edit } = await field();
        const seen: string[] = [];
        node.on(EditBox.EventType.EDITING_RETURN, () => seen.push('return'));
        node.on(EditBox.EventType.EDITING_DID_ENDED, () => seen.push('ended'));
        await P!.tap(200, 200);
        editor!.emit({ kind: 'submit' });
        expect(seen).toEqual(['return', 'ended']);
        expect(edit.isFocused()).toBe(false);
        expect(editor!.focused).toBe(false);
        expect(editor!.disposed).toBe(true);
    });

    it('can be set from a script without an event, and shows the hint when empty', async () => {
        const { edit, text, hint } = await field();
        edit.string = 'preset';
        expect(text.string).toBe('preset');
        expect(hint.node.active).toBe(false);
    });

    it('switches its text label on while it holds text, even when the label was authored off', async () => {
        const { edit, text } = await field();
        text.node.active = false;
        edit.string = 'preset';
        expect(text.node.active).toBe(true);
        edit.string = '';
        expect(text.node.active).toBe(false);
    });

    it('does nothing on a host with no text editor', async () => {
        editor = null;
        const { edit } = await field();
        await P!.tap(200, 200);
        expect(edit.isFocused()).toBe(false);
    });
});
