// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Single authority on what counts as browsable project content, shared by
 *        every enumerator (readDir, subtree search, asset scan, fs watcher) so they
 *        can't disagree. `.meta` sidecars and dot entries are pipeline/plumbing, not
 *        content. Pure (no I/O) → unit-testable.
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

/** True when any path segment leaves content space (the watcher's noise filter).
 *  `.meta` files themselves stay watched — an external edit must re-scan. */
export function isNonContentPath(rel: string): boolean {
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => seg.startsWith('.') || NON_CONTENT_DIRS.has(seg));
}
