// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui-build-text-fields.test.ts
 * @brief   buildText / spawnUIEntity carry every Text field the init names.
 *
 *          buildText used to list Text's fields by hand, and the list fell behind
 *          the component: letterSpacing and underline were accepted by TextInit,
 *          shown in the inspector, and silently dropped (issue #127). It now goes
 *          through Text.create, so a field added to Text cannot be left out.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/ecs/world';
import { ensureBuiltinComponentsRegistered } from '../src/ecs/component';
import { createMockModule } from './mocks/wasm';
import { Text, TextAlign, TextVerticalAlign, buildText, spawnUIEntity, type TextData } from '../src/ui';

describe('buildText', () => {
    it('keeps letterSpacing through spawnUIEntity (issue #127)', () => {
        ensureBuiltinComponentsRegistered();
        const module = createMockModule();
        const world = new World();
        world.connectCpp(module.getRegistry(), module);
        const e = spawnUIEntity({ world, text: { content: 'PERFECT MOMENT', fontSize: 40, letterSpacing: 8 } });
        const t = world.get(e, Text) as TextData;
        expect(t.letterSpacing).toBe(8);
        expect(t.fontSize).toBe(40);
    });

    it('produces every field of Text, and takes each one from the init', () => {
        const fields = Object.keys(Text._default as object).sort();
        expect(Object.keys(buildText()).sort()).toEqual(fields);
        // A value unlike the default for every field: none may come back as the default.
        const def = Text._default as unknown as Record<string, unknown>;
        const init: Record<string, unknown> = {};
        for (const k of fields) {
            const v = def[k];
            if (typeof v === 'number') init[k] = v + 3;
            else if (typeof v === 'boolean') init[k] = !v;
            else if (typeof v === 'string') init[k] = `${v}x`;
            else init[k] = Object.fromEntries(Object.keys(v as object).map((c) => [c, 0.25]));
        }
        expect(buildText(init as Partial<TextData>)).toEqual(init);
    });

    it('keeps the composed label defaults: centred, one line, 14px', () => {
        const t = buildText();
        expect(t.fontSize).toBe(14);
        expect(t.align).toBe(TextAlign.Center);
        expect(t.verticalAlign).toBe(TextVerticalAlign.Middle);
        expect(t.wordWrap).toBe(false);
        expect(t.letterSpacing).toBe(0);
        expect(t.underline).toBe(false);
    });

    it('copies nested records instead of holding the caller\'s object', () => {
        const color = { r: 1, g: 0, b: 0, a: 1 };
        const t = buildText({ color });
        expect(t.color).toEqual(color);
        expect(t.color).not.toBe(color);
        expect(buildText().color).not.toBe(buildText().color);
    });

    it('treats an undefined field as not given', () => {
        expect(buildText({ fontSize: undefined, letterSpacing: undefined }).fontSize).toBe(14);
    });
});
