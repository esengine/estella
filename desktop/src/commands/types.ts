// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    types.ts
 * @brief   The Command descriptor — the single declarative unit behind every
 *          editor action. Menus, the toolbar, keyboard shortcuts, and (later) a
 *          command palette all render/run from these, so an action is defined
 *          and gated in exactly one place.
 */

/** A keybinding chord (e.g. 'mod+s', 'mod+shift+z', 'delete', 'q'). `mod` = ⌘ on
 *  macOS, Ctrl elsewhere. A command may bind several chords (e.g. redo). */
export type Keybinding = string | string[];

export interface Command {
  /** Stable dotted id, e.g. 'edit.undo', 'entity.delete'. */
  id: string;
  /** Human label, shown in menus / palette. */
  label: string;
  /** Grouping for the (future) command palette + menu sections. */
  category?: string;
  /** Chord(s) that trigger this command globally. */
  keybinding?: Keybinding;
  /** Perform the action. */
  run: () => void;
  /** Enablement predicate (default: always enabled). Gates menus, the toolbar,
   *  and keyboard dispatch alike — one source of truth. */
  isEnabled?: () => boolean;
  /** For toggle commands: current on/off state (drives the menu checkmark). */
  isChecked?: () => boolean;
}
