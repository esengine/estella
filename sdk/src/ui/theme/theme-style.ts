// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/theme/theme-style.ts
 * @brief   ThemeStyle — a runtime-only tag that records which semantic color
 *          {@link ThemeColors} role each of an entity's themeable properties uses.
 *
 * It is the missing link for live re-theming: widgets bake a theme's colors into
 * `UIVisual`/`Text`/their `$interaction` colour gears at construction, so without recording the
 * *role* there is no way to re-resolve them when the theme changes. A widget tags
 * the entities it themes (via {@link markThemed}); `applyThemeToWorld` re-resolves
 * the tags against the active theme. Role tags are authoring data and persist
 * into prefabs/scenes — an editor-placed widget must re-theme like a
 * code-constructed one.
 */
import { defineComponent } from '../../ecs/component';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import type { ThemeColors } from './tokens';

/** A semantic color role (a key of {@link ThemeColors}). */
export type ColorRole = keyof ThemeColors;

export interface ThemeStyleData {
    /** Role that drives this entity's `UIVisual.color`. */
    visual?: ColorRole;
    /** Role that drives this entity's `Text.color`. */
    text?: ColorRole;
    /** Page-name → role, for each `$interaction` colour-gear page. */
    states?: Record<string, ColorRole>;
    /** Roles that drive a `TextInput`'s background / text / placeholder colors
     *  (the input plugin owns its UIVisual, so those fields are the source). */
    input?: { background?: ColorRole; text?: ColorRole; placeholder?: ColorRole };
}

// The default DECLARES the fields (even though all are optional): `insert`
// validates data against the schema's keys, so an empty default would reject
// every role a widget tags (e.g. a dialog's `{ visual: 'backdrop' }`).
export const ThemeStyle = defineComponent<ThemeStyleData>(
    'ThemeStyle',
    { visual: undefined, text: undefined, states: {}, input: undefined },
);

/** Tag `entity` so the active theme's colors re-resolve onto it (see
 *  `applyThemeToWorld`). */
export function markThemed(world: World, entity: Entity, style: ThemeStyleData): void {
    world.insert(entity, ThemeStyle, style);
}
