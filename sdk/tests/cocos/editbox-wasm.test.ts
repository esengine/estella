// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EditBox is a view on the engine's TextInput: a press takes the platform's text editor, what is typed lands in the field, and the
 *        field's rules (mode, length, password, hint) hold. The field draws its own text and hint, so what is read back is the field's.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { Children, Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { Text } from '../../src/ui/core/text';
import { TextInput } from '../../src/ui/text/text-input';
import { Color, EditBox, Node, UITransform } from '../../src/cocos';
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

// the field measures its text through a glyph atlas; a fixed advance stands in for the platform's rasterizer, which a test has none of
vi.mock('../../src/ui/text/text-renderer', () => ({
    SdfTextRenderer: class {
        atlas = { renderSize: 64, pixelSizeFor: () => 64, getGlyph: () => ({ advance: 16 }) };
        dispose(): void {}
    },
}));

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

    async function field(configure: (e: EditBox) => void = () => {}): Promise<{ node: Node; edit: EditBox }> {
        P = pointerApp(module, { x: 0, y: 0 }, { fields: true });
        const node = box('input', 200, 200, 160, 40);
        const edit = node.addComponent<EditBox>('EditBox')!;
        edit.placeholder = 'type here';
        configure(edit);
        await P.frame(2);
        return { node, edit };
    }

    /** What the field is showing now: its text part, which holds the hint while the value is empty. */
    function shown(node: Node): string {
        const parts = P!.app.world.get(node._entity, Children).entities;
        return P!.app.world.get(parts[1]!, Text).content;
    }

    it('is the engine field on its node: added if there is none, the same view each time', async () => {
        const { node, edit } = await field();
        expect(P!.app.world.has(node._entity, TextInput)).toBe(true);
        expect(node.getComponent(EditBox)).toBe(edit);
        expect(node.getComponent('cc.EditBox')).toBe(edit);
    });

    it("takes the text editor on a press, and tells the field's listeners", async () => {
        const { node, edit } = await field();
        const seen: string[] = [];
        node.on(EditBox.EventType.EDITING_DID_BEGAN, () => seen.push('began'));
        await P!.tap(200, 200);
        await P!.frame(1);
        expect(editor!.focused).toBe(true);
        expect(edit.isFocused()).toBe(true);
        expect(seen).toEqual(['began']);
    });

    it('shows the hint while empty, and what is typed after, with the field text-changed event', async () => {
        const { node, edit } = await field();
        const changed: string[] = [];
        node.on(EditBox.EventType.TEXT_CHANGED, (e: EditBox) => changed.push(e.string));
        expect(shown(node)).toBe('type here');
        await P!.tap(200, 200);
        editor!.type('hello');
        await P!.frame(2);
        expect(edit.string).toBe('hello');
        expect(shown(node)).toBe('hello');
        editor!.type('');
        await P!.frame(2);
        expect(shown(node)).toBe('type here');
        expect(changed).toEqual(['hello', '']);
    });

    it('holds to the length and the characters its mode takes, writing the fit text back to the surface', async () => {
        const { edit } = await field((e) => { e.maxLength = 4; e.inputMode = EditBox.InputMode.NUMERIC; });
        await P!.tap(200, 200);
        editor!.type('12ab3456');
        await P!.frame(1);
        expect(edit.string).toBe('1234');
        expect(editor!.state.value).toBe('1234');
    });

    it('shows bullets for a password and keeps the real text', async () => {
        const { node, edit } = await field((e) => { e.inputFlag = EditBox.InputFlag.PASSWORD; });
        await P!.tap(200, 200);
        editor!.type('secret');
        await P!.frame(2);
        expect(edit.string).toBe('secret');
        expect(shown(node)).toBe('●●●●●●');
        expect((editor!.options as { password: boolean }).password).toBe(true);
    });

    it('ends on submit with a return event and then an end event, giving the surface back', async () => {
        const { node, edit } = await field();
        const seen: string[] = [];
        node.on(EditBox.EventType.EDITING_RETURN, () => seen.push('return'));
        node.on(EditBox.EventType.EDITING_DID_ENDED, () => seen.push('ended'));
        await P!.tap(200, 200);
        await P!.frame(1);
        editor!.emit({ kind: 'submit' });
        await P!.frame(2);
        expect(seen).toEqual(['return', 'ended']);
        expect(edit.isFocused()).toBe(false);
        expect(editor!.focused).toBe(false);
    });

    it('can be set from a script, and shows it', async () => {
        const { node, edit } = await field();
        edit.string = 'preset';
        await P!.frame(2);
        expect(shown(node)).toBe('preset');
        expect(P!.app.world.get(node._entity, TextInput).value).toBe('preset');
    });

    it("hands a script the field's style as its text and hint labels", async () => {
        const { node, edit } = await field();
        edit.textLabel.color = new Color(255, 0, 0, 255);
        edit.placeholderLabel.color = new Color(0, 255, 0, 255);
        edit.textLabel.fontSize = 28;
        const data = P!.app.world.get(node._entity, TextInput);
        expect(data.color).toMatchObject({ r: 1, g: 0, b: 0 });
        expect(data.placeholderColor).toMatchObject({ r: 0, g: 1, b: 0 });
        expect(data.fontSize).toBe(28);
        expect(edit.placeholderLabel.string).toBe('type here');
    });

    it('does nothing on a host with no text editor', async () => {
        editor = null;
        const { node, edit } = await field();
        const seen: string[] = [];
        node.on(EditBox.EventType.EDITING_DID_BEGAN, () => seen.push('began'));
        await P!.tap(200, 200);
        expect(seen).toEqual([]);
        expect(edit.string).toBe('');
    });
});
