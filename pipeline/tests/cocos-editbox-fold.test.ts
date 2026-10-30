// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos edit box becomes the engine's text field with the style its two labels had, and the labels are not written.
 */
import { describe, expect, it } from 'vitest';
import { foldEditBoxes, type FoldEntity } from '../src/import/cocos/editBoxFold';

interface E extends FoldEntity { id: string }

const rect = (w: number, h: number, px = 0.5, py = 0.5) => ({ type: 'ContentRect', data: { size: { x: w, y: h }, pivot: { x: px, y: py } } });
const at = (x: number, y = 0) => ({ type: 'Transform', data: { position: { x, y, z: 0 } } });
const color = (r: number, g: number, b: number) => ({ r, g, b, a: 1 });

function field(over: Record<string, unknown> = {}): E[] {
    return [
        {
            id: 'box', children: ['text', 'hint', 'other'],
            components: [
                at(0), rect(400, 80),
                { type: 'Cocos.EditBox', data: { string_: '7930', maxLength: 20, inputMode: 6, inputFlag: 5, returnType: 0, tabIndex: 0, textLabel: 'text', placeholderLabel: 'hint', ...over } },
            ],
        },
        { id: 'text', children: ['caretInside'], components: [at(-180), rect(380, 80, 0, 0.5), { type: 'Text', data: { content: '', fontSize: 36, color: color(1, 1, 1), align: 0, fontFamily: 'Arial', renderMode: 0 } }] },
        { id: 'caretInside', children: [], components: [at(0), rect(2, 30)] },
        { id: 'hint', children: [], components: [at(-180), rect(380, 80, 0, 0.5), { type: 'Text', data: { content: '输入账号', fontSize: 36, color: color(0.5, 0.5, 0.5), align: 0 } }] },
        { id: 'other', children: [], components: [at(100), rect(40, 40)] },
    ];
}

describe('folding an edit box into the engine field', () => {
    it('becomes a TextInput with the style of its labels, and the labels are not kept', () => {
        const out = foldEditBoxes(field(), (e) => e.id);
        expect(out.map((e) => e.id)).toEqual(['box', 'other']);
        const box = out[0]!;
        expect(box.children).toEqual(['other']);
        const input = box.components.find((c) => c.type === 'TextInput')!;
        expect(box.components.some((c) => c.type === 'Cocos.EditBox')).toBe(false);
        expect(input.data).toMatchObject({
            value: '7930', placeholder: '输入账号', maxLength: 20, multiline: false, password: false, inputFilter: 0,
            fontSize: 36, fontFamily: 'Arial', textAlign: 0,
            color: color(1, 1, 1), placeholderColor: color(0.5, 0.5, 0.5),
        });
        // the text starts 20 units inside the box's left edge: that is the field's padding
        expect(input.data.padding).toBe(20);
    });

    it('turns the input mode into the field\'s filter and line mode, and the flag into a password', () => {
        const numeric = foldEditBoxes(field({ inputMode: 2 }), (e) => e.id)[0]!.components.find((c) => c.type === 'TextInput')!;
        expect(numeric.data).toMatchObject({ inputFilter: 1, multiline: false });
        const any = foldEditBoxes(field({ inputMode: 0 }), (e) => e.id)[0]!.components.find((c) => c.type === 'TextInput')!;
        expect(any.data).toMatchObject({ inputFilter: 0, multiline: true });
        const secret = foldEditBoxes(field({ inputFlag: 0 }), (e) => e.id)[0]!.components.find((c) => c.type === 'TextInput')!;
        expect(secret.data.password).toBe(true);
        // no limit in Cocos is a negative one; the field's is zero
        const unlimited = foldEditBoxes(field({ maxLength: -1 }), (e) => e.id)[0]!.components.find((c) => c.type === 'TextInput')!;
        expect(unlimited.data.maxLength).toBe(0);
    });

    it('leaves a scene with no edit box exactly as it is', () => {
        const plain: E[] = [{ id: 'a', children: ['b'], components: [at(0)] }, { id: 'b', children: [], components: [at(1)] }];
        expect(foldEditBoxes(plain, (e) => e.id)).toBe(plain);
    });
});
