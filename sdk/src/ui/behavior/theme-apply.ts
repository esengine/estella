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
import { setWorldTheme, themeColors, type ThemeTokens } from '../theme/tokens';
import { UIVisual, type UIVisualData } from '../core/ui-visual';
import { Text, type TextData } from '../core/text';
import { INTERACTION_CONTROLLER } from '../controller/ui-controller';
import { UIGear, type UIGearData } from '../controller/ui-gear';
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

function applyEntityTheme(world: World, e: Entity, colors = themeColors(world)): void {
    const s = world.get(e, ThemeStyle);
    const dye = (role: ColorRole | undefined, current: Color): Color => {
        const color = role && colors[role];
        return color ? { r: color.r, g: color.g, b: color.b, a: current.a } : current;
    };

    if (s.visual && world.has(e, UIVisual)) {
        const v = world.get(e, UIVisual) as UIVisualData;
        world.insert(e, UIVisual, { ...v, color: dye(s.visual, v.color) });
    }
    if (s.text && world.has(e, Text)) {
        const t = world.get(e, Text) as TextData;
        world.insert(e, Text, { ...t, color: dye(s.text, t.color) });
    }
    if (s.input && world.has(e, TextInput)) {
        const ti = world.get(e, TextInput) as TextInputData;
        world.insert(e, TextInput, {
            ...ti,
            backgroundColor: dye(s.input.background, ti.backgroundColor),
            color: dye(s.input.text, ti.color),
            placeholderColor: dye(s.input.placeholder, ti.placeholderColor),
        });
    }
    const states = s.states;
    if (states && world.has(e, UIGear)) {
        const g = world.get(e, UIGear) as UIGearData;
        const bindings = g.bindings.map((b) => {
            if (b.controller !== INTERACTION_CONTROLLER
                || b.component !== 'UIVisual' || b.property !== 'color') return b;
            const pages = { ...b.pages };
            for (const [page, role] of Object.entries(states)) {
                const cur = pages[page];
                if (cur && typeof cur === 'object' && 'a' in cur) pages[page] = dye(role, cur as Color);
            }
            return { ...b, pages };
        });
        world.insert(e, UIGear, { ...g, bindings });
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
