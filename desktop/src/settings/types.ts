// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  types.ts — settings schema. A setting is a declarative descriptor; the
 *        registry holds them, the store holds their values, and SettingsDialog
 *        renders from them. New setting = new descriptor; the UI needs no change.
 *
 * Two ways a setting reaches runtime:
 *  - `bind`   — delegate get/set to an existing store (e.g. editorStore.showGrid),
 *               so the setting and the live control share ONE source (no dupe).
 *  - `effect` — for store-owned settings, push the value to runtime on set + on
 *               hydrate (CSS variable, engine resource, …). Persisted by the store.
 */

/** Where a setting lives / persists. editor → per-user (localStorage). */
export type SettingScope = 'editor' | 'project';

/** Nav grouping in the dialog's left rail. */
export type SettingCategory = 'editor' | 'project' | 'plugin';

export interface SettingsSection {
  id: string;
  label: string;
  category: SettingCategory;
  order?: number;
}

interface BaseSetting<T> {
  /** Dot-namespaced, stable id, e.g. 'appearance.accent'. */
  id: string;
  scope: SettingScope;
  /** Section id (a nav item) this row appears under. */
  section: string;
  /** Group header within the section content. */
  group?: string;
  label: string;
  description?: string;
  default: T;
  /** Two-way delegation to a live store; when present the store owns the value. */
  bind?: { get: () => T; set: (value: T) => void };
  /** One-way push to runtime for store-owned settings (on set + on hydrate). */
  effect?: (value: T) => void;
}

export interface BooleanSetting extends BaseSetting<boolean> {
  type: 'boolean';
}

export interface NumberSetting extends BaseSetting<number> {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  /** Render a slider alongside the numeric field. */
  slider?: boolean;
  /** Suffix shown in the numeric field (e.g. '%', 's'). */
  suffix?: string;
}

export interface EnumSetting extends BaseSetting<string> {
  type: 'enum';
  options: { value: string; label: string }[];
  /** Render as a segmented control instead of a dropdown. */
  segmented?: boolean;
}

/** A single-line free-text setting (e.g. a WeChat appid, a desktop product name). */
export interface StringSetting extends BaseSetting<string> {
  type: 'string';
  placeholder?: string;
}

export interface ColorSetting extends BaseSetting<string> {
  type: 'color';
  /** Preset swatches (hex). */
  swatches: string[];
}

/** Read-only display of a command's keybinding (editing is a later feature). */
export interface KeybindingSetting extends BaseSetting<string> {
  type: 'keybinding';
  commandId: string;
}

/** A fixed-length list of text slots (e.g. named collision/sorting layers). */
export interface StringListSetting extends BaseSetting<string[]> {
  type: 'stringList';
  /** Number of editable slots. */
  count: number;
  /** Placeholder for an empty slot, by index. */
  placeholder?: (i: number) => string;
}

/**
 * A symmetric NxN boolean matrix stored as `count` row bitmasks — the collision
 * matrix (which layer collides with which). value[i] bit j set ⇒ row i ↔ col j on.
 * Only rows whose {@link labels} entry is non-empty (plus row 0) are shown.
 */
export interface MatrixSetting extends BaseSetting<number[]> {
  type: 'matrix';
  count: number;
  /** Row/column labels (e.g. the named collision layers), read at render time. */
  labels: () => string[];
}

export type Setting =
  | BooleanSetting
  | NumberSetting
  | EnumSetting
  | StringSetting
  | ColorSetting
  | KeybindingSetting
  | StringListSetting
  | MatrixSetting;

export type SettingValue = boolean | number | string | string[] | number[];
