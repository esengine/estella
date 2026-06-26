// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetFilter.ts
 * @brief Pure search/filter/sort for the Content Browser — query-token parsing
 *        (`type:`/`t:` type tokens + free text), the type-chip filter, and the sort
 *        order. Kept engine/DOM-free so it unit-tests; the panel just feeds it the
 *        current folder's entries and renders the result.
 */
import type { DirEntry } from './format';

export type AssetSort = 'name' | 'type';

export interface ParsedQuery {
  /** Free-text terms joined by spaces (name substring match). */
  text: string;
  /** Type tokens from `type:x` / `t:x` (matched as a prefix of the asset type). */
  types: string[];
}

/** Split a raw search string into free text + `type:`/`t:` type tokens. */
export function parseAssetQuery(raw: string): ParsedQuery {
  const types: string[] = [];
  const text: string[] = [];
  for (const tok of raw.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const m = /^(?:type|t):(.+)$/.exec(tok);
    if (m) types.push(m[1]);
    else text.push(tok);
  }
  return { text: text.join(' '), types };
}

const matchesType = (actual: string, constraint: string): boolean =>
  actual === constraint || actual.startsWith(constraint);

/**
 * Filter `entries` by the parsed query + active type chips, then sort (folders
 * first, then by name or type). A type constraint (token or chip) is about files,
 * so it hides folders; free text still matches folder names (navigation).
 */
export function filterAndSortAssets(
  entries: readonly DirEntry[],
  parsed: ParsedQuery,
  chipTypes: ReadonlySet<string>,
  sort: AssetSort,
  typeOf: (name: string) => string,
): DirEntry[] {
  const constraints = [...new Set([...chipTypes, ...parsed.types])];
  const hasType = constraints.length > 0;

  const list = entries.filter((e) => {
    if (parsed.text && !e.name.toLowerCase().includes(parsed.text)) return false;
    if (e.isDir) return !hasType;
    return !hasType || constraints.some((c) => matchesType(typeOf(e.name), c));
  });

  return [...list].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // folders first
    if (sort === 'type' && !a.isDir && !b.isDir) {
      const t = typeOf(a.name).localeCompare(typeOf(b.name));
      if (t !== 0) return t;
    }
    return a.name.localeCompare(b.name);
  });
}
