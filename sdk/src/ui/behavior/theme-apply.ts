// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/theme-apply.ts
 * @brief   Live re-theming: re-resolve every {@link ThemeStyle}-tagged entity's
 *          role bindings against the active theme.
 *
 * This is what makes {@link switchTheme} restyle already-constructed widgets, not
 * just future ones — the piece a colors-baked-at-construction model otherwise
 * can't express. Lives here (not in `theme/`) because it touches the widgets'
 * `$interaction` colour gears (behavior state) plus `UIVisual`/`Text` (core);
 * `theme/` is cross-cutting and may not import up into behaviors.
 */
import type { World } from '../../ecs/world';
import { registerSceneComponentInitializer } from '../../scene/worldHooks';
import type { Color, Entity } from '../../types';
import { ThemeStyle, type ColorRole } from '../theme/theme-style';
import { setWorldTheme, themeColors, type ThemeColors, type ThemeTokens } from '../theme/tokens';
import { UIVisual, type UIVisualData } from '../core/ui-visual';
import { Text, type TextData } from '../core/text';
import { INTERACTION_CONTROLLER } from '../controller/ui-controller';
import { UIGear, type GearBinding } from '../controller/ui-gear';
import { TextInput, type TextInputData } from '../text/text-input';

/**
 * Re-resolve every {@link ThemeStyle} entity's role bindings and write the active
 * theme's colors into its `UIVisual`/`Text`/`$interaction` colour gear pages. The
 * existing **alpha is preserved** — only the hue re-themes — so a dimmed
 * `disabled` state keeps its transparency, and a caller's translucency survives
 * a swap.
 */
export function applyThemeToWorld(world: World): void {
    const colors = themeColors(world);
    for (const entity of world.getEntitiesWithComponents([ThemeStyle])) applyEntityTheme(world, entity, colors);
}

function themedColor(colors: ThemeColors, role: ColorRole | undefined, current: Color, native = false): Color {
    const target = role && colors[role];
    if (!target) return current;
    const { r, g, b } = target;
    if (current.r === r && current.g === g && current.b === b) return current;
    // UIVisual comes back from the native registry with float32 channels.
    if (native && current.r === Math.fround(r) && current.g === Math.fround(g) && current.b === Math.fround(b)) return current;
    return { r, g, b, a: current.a };
}

function applyEntityTheme(world: World, e: Entity, colors = themeColors(world)): void {
    const s = world.get(e, ThemeStyle);
    if (s.visual && world.has(e, UIVisual)) {
        const v = world.get(e, UIVisual) as UIVisualData;
        const color = themedColor(colors, s.visual, v.color, true);
        if (color !== v.color) world.insert(e, UIVisual, { ...v, color });
    }
    if (s.text && world.has(e, Text)) {
        const t = world.get(e, Text) as TextData;
        const color = themedColor(colors, s.text, t.color);
        if (color !== t.color) world.insert(e, Text, { ...t, color });
    }
    if (s.input && world.has(e, TextInput)) {
        const ti = world.get(e, TextInput) as TextInputData;
        const backgroundColor = themedColor(colors, s.input.background, ti.backgroundColor);
        const color = themedColor(colors, s.input.text, ti.color);
        const placeholderColor = themedColor(colors, s.input.placeholder, ti.placeholderColor);
        if (backgroundColor !== ti.backgroundColor || color !== ti.color || placeholderColor !== ti.placeholderColor) {
            world.insert(e, TextInput, { ...ti, backgroundColor, color, placeholderColor });
        }
    }
    const states = s.states;
    if (states && world.has(e, UIGear)) {
        const gear = world.get(e, UIGear);
        let bindings: GearBinding[] | undefined;
        for (const [index, binding] of gear.bindings.entries()) {
            if (binding.controller !== INTERACTION_CONTROLLER
                || binding.component !== 'UIVisual' || binding.property !== 'color') continue;
            let pages: GearBinding['pages'] | undefined;
            for (const [page, role] of Object.entries(states)) {
                const current = binding.pages[page];
                if (!current || typeof current !== 'object' || !('a' in current)) continue;
                const color = themedColor(colors, role, current);
                if (color === current) continue;
                pages ??= { ...binding.pages };
                pages[page] = color;
            }
            if (pages) {
                bindings ??= gear.bindings.slice();
                bindings[index] = { ...binding, pages };
            }
        }
        if (bindings) world.insert(e, UIGear, { ...gear, bindings });
    }
}

/** Install once per world so a later prefab, streamed cell or scene is themed as it loads. */
export function installWidgetTheme(world: World): void {
    registerSceneComponentInitializer(world, ThemeStyle, applyEntityTheme);
}

/** Set the active theme AND live-restyle every already-constructed themed widget. */
export function switchTheme(world: World, tokens: ThemeTokens): void {
    setWorldTheme(world, tokens);
    installWidgetTheme(world);
    applyThemeToWorld(world);
}
