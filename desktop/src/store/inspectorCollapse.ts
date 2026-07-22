// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  inspectorCollapse.ts — persisted collapse state for Details inspector
 *        sections, keyed by component name (or a synthetic section key like
 *        `__controllers`). Shared by every inspector variant so a section a user
 *        folds stays folded across selections AND editor restarts, instead of the
 *        old per-mount useState that reset on every reselect.
 *
 * A section's default state comes from DEFAULT_COLLAPSED (rarely-tuned "chrome"
 * opens folded so a UI widget's inspector isn't a wall of always-open sections);
 * an explicit user toggle overrides that per section and is what gets persisted.
 */
import { create } from 'zustand';

// Sections that open COLLAPSED by default: chrome that pads every UI widget's
// inspector — Focusable (tabIndex/isFocused, rarely touched) and ThemeStyle (a
// zero-field runtime tag). A user's explicit toggle overrides and persists.
const DEFAULT_COLLAPSED = new Set(['Focusable', 'ThemeStyle']);

const LS_KEY = 'estella.inspectorCollapse';

function load(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {}; // corrupt blob → start clean
  }
}
function save(explicit: Record<string, boolean>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(explicit));
  } catch {
    /* quota / private mode — persistence is best-effort */
  }
}

/** Whether a section renders collapsed: the explicit user choice, else the default. */
export function isSectionCollapsed(explicit: Record<string, boolean>, name: string): boolean {
  return explicit[name] ?? DEFAULT_COLLAPSED.has(name);
}

interface InspectorCollapseState {
  /** Explicit user choices, section-key → collapsed?. Absent ⇒ the default policy. */
  explicit: Record<string, boolean>;
  /** Toggle a section's collapse (persists the explicit choice). */
  toggle: (name: string) => void;
}

export const useInspectorCollapse = create<InspectorCollapseState>((set, get) => ({
  explicit: load(),
  toggle: (name) =>
    set(() => {
      const cur = get().explicit;
      const explicit = { ...cur, [name]: !isSectionCollapsed(cur, name) };
      save(explicit);
      return { explicit };
    }),
}));
