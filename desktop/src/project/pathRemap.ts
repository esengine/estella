// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pathRemap.ts
 * @brief Pure path arithmetic for asset rename/move: what a dependent path
 *        becomes after `from` → `to`. Kept dependency-free so both the document
 *        layer and project stores can share it without cycles.
 */

/**
 * The new project-relative path for `path` after the asset at `from` moved to
 * `to` — an exact match (file rename) or a prefix match (a containing folder
 * moved). Null when `path` is unaffected.
 */
export function remapAssetPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return null;
}
