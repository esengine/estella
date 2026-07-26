// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Single authority on what counts as browsable project content, shared by
 *        every enumerator (readDir, subtree search, asset scan, fs watcher) so they
 *        can't disagree. `.meta` sidecars and dot entries are pipeline/plumbing, not
 *        content. Pure (no I/O) → unit-testable.
 */
import { PROJECT_PLUGIN_REL } from '../src/plugins/paths';

/** Sidecar suffix carrying an asset's uuid/type/importer (see assetDb). */
export const META_EXT = '.meta';

/** Non-dot dirs that are never content (code deps / build output); dot dirs
 *  (`.esengine`, `.git`, …) are excluded by the dot rule. */
const NON_CONTENT_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'build']);

export const isContentDir = (name: string): boolean =>
  !name.startsWith('.') && !NON_CONTENT_DIRS.has(name);

export const isContentFile = (name: string): boolean =>
  !name.startsWith('.') && !name.endsWith(META_EXT);

/** True when any path segment leaves content space.
 *  `.meta` files themselves stay content — an external edit must re-scan. */
export function isNonContentPath(rel: string): boolean {
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => seg.startsWith('.') || NON_CONTENT_DIRS.has(seg));
}

/**
 * Editor-plugin SOURCE, which the watcher must report even though it lives under a
 * dot dir. Plugin sources are not browsable content (they must stay out of the
 * Content Browser and the asset scan), but they are the input to plugin hot reload —
 * two different questions, so two predicates rather than one loosened rule.
 *
 * Dot-prefixed entries INSIDE the plugin dir stay excluded: `.types` is written by
 * the editor itself, and watching it would loop.
 */
export function isPluginSourcePath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (!p.startsWith(`${PROJECT_PLUGIN_REL}/`)) return false;
  const rest = p.slice(PROJECT_PLUGIN_REL.length + 1);
  return rest.length > 0 && !rest.startsWith('.');
}

/** What the project watcher reports: content, plus plugin sources. */
export function isWatchedPath(rel: string): boolean {
  return isPluginSourcePath(rel) || !isNonContentPath(rel);
}
