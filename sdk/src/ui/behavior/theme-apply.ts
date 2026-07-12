// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/behavior/theme-apply.ts
 * @brief   Live re-theming: re-resolve every {@link ThemeStyle}-tagged entity's
 *          role bindings against the active theme.
 *
 * This is what makes {@link switchTheme} restyle already-constructed widgets, not
 * just future ones — the piece a colors-baked-at-construction model otherwise
 * can't express. Lives here (not in `theme/`) because it touches `StateVisuals`
 * (this layer) plus `UIVisual`/`Text` (core); `theme/` is cross-cutting and may
 * not import up into behaviors.
 */
import type { World } from '../../world';
import { ThemeStyle, type ThemeStyleData } from '../theme/theme-style';
import { setTheme, themeColors, type ThemeTokens } from '../theme/tokens';
import { UIVisual, type UIVisualData } from '../core/ui-visual';
import { Text, type TextData } from '../core/text';
import { StateVisuals, type StateVisualsData } from './state-visuals';

/**
 * Re-resolve every {@link ThemeStyle} entity's role bindings and write the active
 * theme's colors into its `UIVisual`/`Text`/`StateVisuals`. The existing **alpha
 * is preserved** — only the hue re-themes — so a dimmed `disabled` state keeps its
 * transparency, and a caller's translucency survives a swap.
 */
export function applyThemeToWorld(world: World): void {
    const colors = themeColors();
    for (const e of world.getEntitiesWithComponents([ThemeStyle])) {
        const s = world.get(e, ThemeStyle) as ThemeStyleData;

        if (s.visual && world.has(e, UIVisual)) {
            const v = world.get(e, UIVisual) as UIVisualData;
            const c = colors[s.visual];
            world.insert(e, UIVisual, { ...v, color: { r: c.r, g: c.g, b: c.b, a: v.color.a } });
        }
        if (s.text && world.has(e, Text)) {
            const t = world.get(e, Text) as TextData;
            const c = colors[s.text];
            world.insert(e, Text, { ...t, color: { r: c.r, g: c.g, b: c.b, a: t.color.a } });
        }
        if (s.states && world.has(e, StateVisuals)) {
            const sv = world.get(e, StateVisuals) as StateVisualsData;
            const states = sv.states.map((st) => {
                const role = s.states![st.name];
                if (!role) return st;
                const c = colors[role];
                return { ...st, r: c.r, g: c.g, b: c.b }; // keep st.a
            });
            world.insert(e, StateVisuals, { ...sv, states });
        }
    }
}

/** Set the active theme AND live-restyle every already-constructed themed widget. */
export function switchTheme(world: World, tokens: ThemeTokens): void {
    setTheme(tokens);
    applyThemeToWorld(world);
}
