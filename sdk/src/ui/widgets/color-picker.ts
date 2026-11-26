// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { World } from '../../ecs/world';
import type { Color, Entity } from '../../types';
import { Name } from '../../ecs/component';
import { spawnUIEntity, type UINodeInit } from '../core/compose';
import { px, percent } from '../core/dimension';
import { UIColorPicker } from '../behavior/color-picker';
import { createSlider } from './slider';
import { createTextInput } from './text-input';
import { createButton } from './button';
import { makeWidgetInteractable } from '../input/interactable';
import { UIEventType, type UIEventQueue } from '../core/events';
import { themeColors } from '../theme/tokens';
import { markThemed, ThemeStyle } from '../theme/theme-style';
import { col } from '../../math/color';
import { TextAlign, TextVerticalAlign } from '../core/text';

/** Explicit callbacks bind the same picker to UI, sprites, materials, or project data. @beta */
export interface ColorPickerOptions {
    world: World;
    events: UIEventQueue;
    parent?: Entity;
    node?: UINodeInit;
    color?: Color;
    alphaEnabled?: boolean;
    format?: number;
    history?: readonly Color[];
    historyLimit?: number;
    rememberColors?: boolean;
    onChange?: (color: Color) => void;
    onHistoryChange?: (colors: readonly Color[]) => void;
}
/** No implicit target mutation or global history storage. @beta */
export interface ColorPickerHandle {
    readonly entity: Entity;
    getColor(): Color;
    setColor(color: Color): void;
    dispose(): void;
}

/** The picker composes existing TextInput, Slider and Button controls. @beta */
export function createColorPicker(opts: ColorPickerOptions): ColorPickerHandle {
    const { world, events } = opts, colors = themeColors(world);
    const entity = spawnUIEntity({ world, parent: opts.parent, node: opts.node ?? { width: px(280), height: px(412) }, visual: { color: colors.surfaceElevated } });
    markThemed(world, entity, { visual: 'surfaceElevated' });
    const box = (top: number, height: number): UINodeInit => ({ position: 1, insetLeft: px(14), insetRight: px(14), insetTop: px(top), height: px(height) });
    const sv = spawnUIEntity({ world, parent: entity, node: box(14, 168), visual: { color: colors.primary } });
    makeWidgetInteractable(world, sv); world.insert(sv, Name, { value: 'SaturationValue' });
    const cursor = spawnUIEntity({ world, parent: sv, node: { position: 1, width: px(18), height: px(18), insetLeft: percent(75), insetTop: percent(12), marginLeft: px(-9), marginTop: px(-9) },
        text: { content: '○', fontSize: 16, color: { r: 1, g: 1, b: 1, a: 1 }, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, strokeWidth: 1, align: TextAlign.Center, verticalAlign: TextVerticalAlign.Middle, wordWrap: false } });
    const color = opts.color ?? UIColorPicker._default.color, hsv = col.toHsv(color);
    const hue = createSlider({ world, events, parent: entity, node: box(194, 12), min: 0, max: 360, value: hsv.h, handleWidth: 6 });
    const alpha = createSlider({ world, events, parent: entity, node: box(218, 12), min: 0, max: 1, value: color.a, handleWidth: 6 });
    // Gradient data has its own color meaning; only the surrounding chrome themes.
    world.remove(hue.entity, ThemeStyle); world.remove(alpha.entity, ThemeStyle);
    const alphaRamp = spawnUIEntity({ world, parent: alpha.fillEntity, node: { fill: true }, visual: {} });
    world.insert(hue.entity, Name, { value: 'Hue' }); world.insert(alpha.entity, Name, { value: 'Alpha' });
    const fields: Entity[] = [];
    for (let i = 0; i < 4; i++) {
        const label = spawnUIEntity({ world, parent: entity, node: { position: 1, insetLeft: percent(i * 23 + 5), insetTop: px(246), width: percent(21), height: px(16) }, text: { content: ['H °', 'S %', 'V %', 'A %'][i], fontSize: 11, color: colors.text } });
        markThemed(world, label, { text: 'text' }); world.insert(label, Name, { value: `ColorChannelLabel${i}` });
        const field = createTextInput({ world, events, parent: entity, value: '', node: { position: 1, insetLeft: percent(i * 23 + 5), insetTop: px(264), width: percent(21), height: px(27) }, fontSize: 12 });
        fields.push(field.entity); world.insert(field.entity, Name, { value: `ColorChannel${i}` });
    }
    const hex = createTextInput({ world, events, parent: entity, value: col.toHex(color, true), node: box(303, 28), fontSize: 12 });
    world.insert(hex.entity, Name, { value: 'ColorHex' });
    const remember = createButton({ world, events, parent: entity, node: { position: 1, insetRight: px(14), insetTop: px(343), width: px(104), height: px(24) }, text: { content: '+ Remember', fontSize: 11 } });
    const preview = spawnUIEntity({ world, parent: entity, node: { position: 1, insetLeft: px(14), insetTop: px(343), width: px(32), height: px(24) }, visual: { color } });
    const historyRoot = spawnUIEntity({ world, parent: entity, node: box(378, 22) });
    world.insert(entity, UIColorPicker, { ...structuredClone(UIColorPicker._default), color: { ...color },
        alphaEnabled: opts.alphaEnabled ?? true, format: opts.format ?? 0, history: opts.history?.map(value => ({ ...value })) ?? [],
        historyLimit: opts.historyLimit ?? 8, rememberColors: opts.rememberColors ?? true,
        sv, alphaRamp, cursor, hue: hue.entity, alpha: alpha.entity, fields, hex: hex.entity, historyRoot, rememberButton: remember.entity, preview });
    const off = opts.onChange ? events.on(entity, UIEventType.Change, event => opts.onChange!({ ...(event.data as { color: Color }).color })) : undefined;
    const offHistory = opts.onHistoryChange ? events.on(entity, 'history_change', event => opts.onHistoryChange!((event.data as { colors: Color[] }).colors.map(value => ({ ...value })))) : undefined;
    return { entity, getColor: () => ({ ...world.get(entity, UIColorPicker).color }),
        setColor(next) {
            world.update(entity, UIColorPicker, data => {
                data.color = { ...next };
            });
        },
        dispose() { off?.(); offHistory?.(); if (world.valid(entity)) world.despawn(entity); } };
}
