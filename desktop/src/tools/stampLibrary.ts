// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    stampLibrary.ts
 * @brief   The tilemap painter's saved-stamp library (pure half): parse/serialize
 *          the per-project localStorage blob (fail-quiet — a corrupt blob yields
 *          an empty library, never a crash), add with auto-naming + dedupe, and
 *          remove. Stamps carry raw cells (gids + flip flags), so they are only
 *          meaningful within the project whose tilesets minted those gids —
 *          hence per-project persistence, keyed by project root.
 */
import type { TileStamp } from 'esengine';

export interface SavedStamp {
  name: string;
  stamp: TileStamp;
}

/** The localStorage key for a project's stamp library. */
export function stampLibraryKey(projectRoot: string): string {
  return `estella.tileStamps:${projectRoot}`;
}

function isValidStamp(s: unknown): s is TileStamp {
  if (!s || typeof s !== 'object') return false;
  const t = s as TileStamp;
  return (
    Number.isInteger(t.w) && t.w > 0 &&
    Number.isInteger(t.h) && t.h > 0 &&
    Array.isArray(t.cells) && t.cells.length === t.w * t.h &&
    t.cells.every((c) => typeof c === 'number')
  );
}

/** Parse a stored library blob; invalid entries (or garbage input) drop silently. */
export function parseStampLibrary(json: string | null): SavedStamp[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is SavedStamp =>
        !!e && typeof e === 'object' &&
        typeof (e as SavedStamp).name === 'string' &&
        isValidStamp((e as SavedStamp).stamp),
    );
  } catch {
    return [];
  }
}

export function serializeStampLibrary(list: SavedStamp[]): string {
  return JSON.stringify(list);
}

const sameStamp = (a: TileStamp, b: TileStamp): boolean =>
  a.w === b.w && a.h === b.h && a.cells.every((c, i) => c === b.cells[i]);

/**
 * Add `stamp` under the lowest free auto-name (S1, S2, …). Adding a stamp that
 * is already in the library (same size + cells) returns the list unchanged.
 */
export function addStamp(list: SavedStamp[], stamp: TileStamp): SavedStamp[] {
  if (list.some((e) => sameStamp(e.stamp, stamp))) return list;
  const used = new Set(list.map((e) => e.name));
  let n = 1;
  while (used.has(`S${n}`)) n++;
  return [...list, { name: `S${n}`, stamp: { w: stamp.w, h: stamp.h, cells: [...stamp.cells] } }];
}

export function removeStampAt(list: SavedStamp[], index: number): SavedStamp[] {
  return list.filter((_, i) => i !== index);
}
