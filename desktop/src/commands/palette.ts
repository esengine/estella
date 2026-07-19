// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  palette.ts
 * @brief Pure command-palette logic: the registry → display-item projection and
 *        the fuzzy filter/rank. Kept out of the React component so ranking and
 *        enablement rules are unit-testable.
 */
import type { Command } from './types';

/** A palette row: what the list renders and what Enter executes. */
export interface PaletteItem {
  id: string;
  label: string;
  category?: string;
  /** Effective keybinding chord (overrides resolved), for the hint column. */
  keybinding?: string;
  /** Disabled commands stay listed but grey and inert (VS Code convention). */
  enabled: boolean;
}

/** The searchable text of an item — category-qualified, like VS Code. */
export function paletteText(item: { label: string; category?: string }): string {
  return item.category ? `${item.category}: ${item.label}` : item.label;
}

/**
 * Fuzzy subsequence score of `query` against `text`; null = no match. Bonuses
 * favor consecutive runs and word starts, so 'sq' ranks 'Scene Quality' over
 * 'settings…quit'. Case-insensitive; an empty query matches everything at 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let searchFrom = 0;
  let prevHit = -2;
  for (const ch of q) {
    if (ch === ' ') continue; // spaces separate terms, they don't need matching
    const hit = t.indexOf(ch, searchFrom);
    if (hit === -1) return null;
    score += 1;
    if (hit === prevHit + 1) score += 3;
    if (hit === 0 || /[\s./:+-]/.test(t[hit - 1])) score += 2;
    prevHit = hit;
    searchFrom = hit + 1;
  }
  return score;
}

/**
 * Filter + rank items for a query. Empty query preserves registration order
 * (commands group naturally by category); otherwise best score first, ties
 * broken by label so the order is stable.
 */
export function filterPalette<T extends { label: string; category?: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim();
  if (!q) return [...items];
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(q, paletteText(item));
    if (score != null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.map((s) => s.item);
}

/** Project registry commands into palette items (enablement resolved NOW —
 *  the palette is a snapshot of what is runnable at open time). */
export function paletteItems(
  all: readonly Command[],
  keybindingFor: (id: string) => string | string[] | undefined,
): PaletteItem[] {
  return all.map((c) => {
    const kb = keybindingFor(c.id);
    return {
      id: c.id,
      label: c.label,
      category: c.category,
      keybinding: Array.isArray(kb) ? kb[0] : kb,
      enabled: c.isEnabled?.() ?? true,
    };
  });
}
