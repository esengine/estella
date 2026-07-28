// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Color, Entity } from '../../types';
import type { World } from '../../ecs/world';

import { px } from '../core/dimension';
import { type UIEventQueue } from '../core/events';
import { TextInput, type TextInputData } from '../text/text-input';
import { TextRenderMode } from '../core/text';

import { spawnUIEntity, type UINodeInit } from '../core/compose';
import { makeWidgetInteractable } from '../input/interactable';
import { themeColors, themeType } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';

export interface TextInputOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    /** CSS-box layout. Default: 220×32. */
    node?: UINodeInit;

    value?: string;
    placeholder?: string;
    fontFamily?: string;
    /** Default: the theme's label size. */
    fontSize?: number;
    /** 0 = unlimited. */
    maxLength?: number;
    password?: boolean;
    multiline?: boolean;
    readOnly?: boolean;
    /** Inner horizontal padding in px. Default 6. */
    padding?: number;
    /** Glyph pipeline for the field text. Default Auto (bitmap unscaled, SDF scaled). */
    renderMode?: TextRenderMode;

    /** Text / background / placeholder color overrides (theme roles otherwise). */
    color?: Color;
    backgroundColor?: Color;
    placeholderColor?: Color;

    disabled?: boolean;
    tabIndex?: number;

    /** Fires on every edit. */
    onChange?: (value: string, entity: Entity) => void;
    /** Fires on Enter (single-line). */
    onSubmit?: (value: string, entity: Entity) => void;
}

export interface TextInputHandle {
    readonly entity: Entity;
    getValue(): string;
    setValue(value: string): void;
    dispose(): void;
}

/**
 * Single-call editable text field over the {@link TextInput} component and its
 * SDF input plugin (focus, caret, IME gate, clipboard, password masking).
 * Colors default to theme roles and re-resolve on `switchTheme`.
 */
export function createTextInput(opts: TextInputOptions): TextInputHandle {
    const { world, events } = opts;
    const c = themeColors();

    const entity = spawnUIEntity({
        world,
        parent: opts.parent,
        node: opts.node ?? { width: px(220), height: px(32) },
    });
    // Text fields are always focusable — that is what they are for.
    makeWidgetInteractable(world, entity, { disabled: opts.disabled, tabIndex: opts.tabIndex });

    world.insert(entity, TextInput, {
        value: opts.value ?? '',
        placeholder: opts.placeholder ?? '',
        placeholderColor: opts.placeholderColor ?? { ...c.text, a: c.text.a * 0.5 },
        fontFamily: opts.fontFamily ?? 'Arial',
        fontSize: opts.fontSize ?? themeType().label,
        color: opts.color ?? { ...c.text },
        backgroundColor: opts.backgroundColor ?? { ...c.control },
        padding: opts.padding ?? 6,
        maxLength: opts.maxLength ?? 0,
        multiline: opts.multiline ?? false,
        password: opts.password ?? false,
        readOnly: opts.readOnly ?? false,
        focused: false,
        cursorPos: (opts.value ?? '').length,
        dirty: true,
        renderMode: opts.renderMode ?? TextRenderMode.Auto,
    });
    markThemed(world, entity, {
        input: {
            background: opts.backgroundColor === undefined ? 'control' : undefined,
            text: opts.color === undefined ? 'text' : undefined,
            placeholder: opts.placeholderColor === undefined ? 'text' : undefined,
        },
    });

    const offChange = opts.onChange
        ? events.on(entity, 'change', () => {
              opts.onChange!((world.get(entity, TextInput) as TextInputData).value, entity);
          })
        : undefined;
    const offSubmit = opts.onSubmit
        ? events.on(entity, 'submit', () => {
              opts.onSubmit!((world.get(entity, TextInput) as TextInputData).value, entity);
          })
        : undefined;

    return {
        entity,
        getValue: () => (world.get(entity, TextInput) as TextInputData).value,
        setValue: (value: string) => {
            const ti = world.get(entity, TextInput) as TextInputData;
            if (ti.value === value) return;
            ti.value = value;
            ti.cursorPos = Math.min(ti.cursorPos, value.length);
            ti.dirty = true;
            world.insert(entity, TextInput, ti);
        },
        dispose: () => {
            offChange?.();
            offSubmit?.();
            if (world.valid(entity)) world.despawn(entity);
        },
    };
}
