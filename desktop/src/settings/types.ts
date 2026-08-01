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
  /**
   * Row layout. `inline` (default) puts the control in the fixed right-hand
   * column beside the label; `block` stacks it under the label at full width,
   * for controls a 230px column cannot hold — a table, a list that grows.
   * Orthogonal to `type`, so a wide control does not need its own row plumbing.
   */
  layout?: 'inline' | 'block';
  /** Two-way delegation to a live store; when present the store owns the value. */
  bind?: { get: () => T; set: (value: T) => void };
  /** One-way push to runtime for store-owned settings (on set + on hydrate). */
  effect?: (value: T) => void;
  /**
   * A live line under the description reporting what the setting's backing is
   * ACTUALLY doing — "listening on 127.0.0.1:51234", "no encoder found". For
   * settings whose effect can fail or resolve asynchronously, where the checkbox
   * alone says what was asked for and not what happened.
   *
   * `read` must return an equal string for an unchanged state (the row reads it
   * through useSyncExternalStore, which compares with Object.is — a plain string
   * satisfies that, an object rebuilt per call would loop). `subscribe` re-renders
   * the row when the backing changes; omit it for a value that only moves when
   * some other setting does.
   */
  status?: { read: () => string | null; subscribe?: (fn: () => void) => () => void };
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

/**
 * An absolute path to something on THIS machine, picked from a dialog or typed.
 * Empty means "unset", which every reader is expected to have an answer for —
 * these name a convenience, not a requirement.
 */
export interface PathSetting extends BaseSetting<string> {
  type: 'path';
  placeholder?: string;
  /** Title of the picker dialog. */
  pickTitle?: string;
  /** Offer the code editors found installed, so the row is a choice, not a blank. */
  detect?: boolean;
}

/**
 * A credential the editor holds but can never show. The value goes to main,
 * which seals it with the OS keychain (electron/secrets.ts); nothing reads it
 * back — not this process, not localStorage, not the project — so the only
 * "value" here is the one bit main reports, and it lives there rather than in
 * the settings store. The row is therefore set-or-forget, and `status` is where
 * a machine with no keychain to seal with gets to say so.
 */
export interface SecretSetting extends BaseSetting<boolean> {
  type: 'secret';
  /** Shape of the expected credential, e.g. `sk-ant-…`. */
  placeholder?: string;
}

export interface ColorSetting extends BaseSetting<string> {
  type: 'color';
  /** Preset swatches (hex). */
  swatches: string[];
}

/** A full HSV/alpha color picker (ColorControl), value `#rrggbbaa`. An empty
 *  string means "unset" — the control shows {@link placeholderColor} (e.g. the
 *  inherited base value) and the standard reset affordance clears the override. */
export interface ColorPickerSetting extends BaseSetting<string> {
  type: 'colorpicker';
  /** The effective color shown while unset, read at render time. */
  placeholderColor?: () => string;
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

/** A labeled row of per-slot toggles stored as the enabled slot indices — e.g.
 *  which named sorting layers y-sort. Only slot 0 and named slots are shown. */
export interface FlagListSetting extends BaseSetting<number[]> {
  type: 'flagList';
  count: number;
  /** Slot labels (e.g. the named sorting layers), read at render time. */
  labels: () => string[];
}

/**
 * One editable field of an {@link ObjectListSetting} row.
 *
 * `key` may be a dot path (`safe.top`), so a row's nested shape does not have to
 * be flattened into the stored format just to be editable.
 */
export interface ObjectListColumn {
  key: string;
  label: string;
  type: 'text' | 'number';
  /** Grid track for this column (CSS), e.g. '1fr' or '68px'. Defaults to 1fr. */
  width?: string;
  placeholder?: string;
  min?: number;
}

/**
 * A list of structured rows the user can add to, edit and remove — unlike
 * {@link StringListSetting} and {@link MatrixSetting}, whose length is fixed by
 * the schema. The first user is the project's screen presets; the shape is
 * general because "a table of things this project declares" is not.
 *
 * Rows are plain objects keyed by {@link columns}. `rowError` is checked per
 * row and shown inline rather than blocking the edit — a half-typed row is a
 * normal state, and refusing the keystroke is how a form becomes unusable.
 */
export interface ObjectListSetting extends BaseSetting<Record<string, unknown>[]> {
  type: 'objectList';
  columns: ObjectListColumn[];
  /**
   * Fields shown only when a row is expanded. For what most rows leave alone —
   * putting them in the main table would widen every row to serve the few that
   * need them, and a table wide enough to need scrolling is worse than a click.
   */
  detailColumns?: ObjectListColumn[];
  /** Heading for the expanded area, and the expander's tooltip. */
  detailLabel?: string;
  /** Values a freshly added row starts with. */
  newRow: () => Record<string, unknown>;
  /** Per-row validation → message, or null when the row is fine. */
  rowError?: (row: Record<string, unknown>, all: Record<string, unknown>[]) => string | null;
  addLabel: string;
  /** Shown in place of the table when the list is empty. */
  emptyHint?: string;
}

export type Setting =
  | BooleanSetting
  | NumberSetting
  | EnumSetting
  | StringSetting
  | PathSetting
  | SecretSetting
  | ColorSetting
  | ColorPickerSetting
  | KeybindingSetting
  | StringListSetting
  | MatrixSetting
  | FlagListSetting
  | ObjectListSetting;

export type SettingValue = boolean | number | string | string[] | number[] | Record<string, unknown>[];
