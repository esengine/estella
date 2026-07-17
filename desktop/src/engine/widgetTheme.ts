// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  widgetTheme.ts — live widget-theme preview in the EDIT world. Re-resolves
 *        every ThemeStyle-tagged widget against the project's effective theme
 *        (base + token overrides), matching what a shipped runtime boots with —
 *        WYSIWYG for Project Settings → UI. Callers pass the project values so
 *        this module stays free of ProjectStore (no import cycle).
 */
import { switchTheme, resolveThemeTokens, type ThemeOverrides } from 'esengine';
import { EngineHost } from './EngineHost';

/** Apply the effective widget theme to the edit world (no-op before engine boot).
 *  Writes the world directly — theme resolution is a projection like scene load,
 *  not an undoable document edit. */
export function applyWidgetTheme(theme: 'dark' | 'light', overrides?: ThemeOverrides): void {
  const world = EngineHost.mutableWorld();
  if (world) switchTheme(world, resolveThemeTokens(theme, overrides));
}
