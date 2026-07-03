// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Single authority on what counts as browsable project CONTENT.
 *
 * Four enumerators walk the project — the Content Browser's readDir, its
 * subtree search, the AssetDatabase scan, and the fs watcher — and must agree
 * on what is visible: `.meta` sidecars are asset-pipeline internals (identity
 * travels with its asset through rename/duplicate/trash, never shown as its
 * own entry), dot entries are editor/VCS plumbing, and code/build output dirs
 * are not content. Any divergence is a user-visible bug (e.g. `.meta` files
 * appearing in the Content Browser). Pure (no I/O) → unit-testable.
 */

/** Sidecar suffix carrying an asset's uuid/type/importer (see assetDb). */
export const META_EXT = '.meta';

/** Non-dot dirs that are never content (code deps / build output); dot dirs
 *  (`.esengine`, `.git`, …) are excluded by the dot rule. */
const NON_CONTENT_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'build']);

export const isContentDir = (name: string): boolean =>
  !name.startsWith('.') && !NON_CONTENT_DIRS.has(name);

export const isContentFile = (name: string): boolean =>
  !name.startsWith('.') && !name.endsWith(META_EXT);

/**
 * True when any segment of a project-relative path leaves content space —
 * the watcher's noise filter. Note `.meta` files themselves ARE watched:
 * an external sidecar edit (git pull) must re-scan the asset registry.
 */
export function isNonContentPath(rel: string): boolean {
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => seg.startsWith('.') || NON_CONTENT_DIRS.has(seg));
}
