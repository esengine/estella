// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Single authority on what counts as browsable project content, shared by
 *        every enumerator (readDir, subtree search, asset scan, fs watcher) so they
 *        can't disagree. `.meta` sidecars and dot entries are pipeline/plumbing, not
 *        content. Pure (no I/O) → unit-testable.
 */
import { PROJECT_PLUGIN_REL } from '../project/pluginPaths';

/** Sidecar suffix carrying an asset's uuid/type/importer (see assetDb). */
export const META_EXT = '.meta';

/** Non-dot dirs that are never content (code deps / build output); dot dirs
 *  (`.esengine`, `.git`, …) are excluded by the dot rule. */
const NON_CONTENT_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'build']);

/**
 * Where an export lands: `dist-web`, `dist-android`, `dist-wechat`, one per
 * platform and more of them over time.
 *
 * A build's OUTPUT is not the project's content — but it is full of files that
 * look exactly like content, because it is made of them. Left in, the registry
 * adopts a finished build's assets as if the user had authored them, and the
 * next build ships the previous one's manifest inside itself.
 */
const isBuildOutputDir = (name: string): boolean => name.startsWith('dist-');

export const isContentDir = (name: string): boolean =>
  !name.startsWith('.') && !NON_CONTENT_DIRS.has(name) && !isBuildOutputDir(name);

/**
 * Whether a project-relative path is under a folder its manifest excludes from content (`assetExclude`): art sources, documents, tools. The excluded
 * folder itself counts, so the walkers do not enter it.
 */
export function isExcludedByProject(rel: string, exclude: readonly string[] | undefined): boolean {
  if (!exclude || exclude.length === 0) return false;
  const p = rel.replace(/\\/g, '/');
  return exclude.some((folder) => p === folder || p.startsWith(`${folder}/`));
}

export const isContentFile = (name: string): boolean =>
  !name.startsWith('.') && !name.endsWith(META_EXT);

/** True when any path segment leaves content space.
 *  `.meta` files themselves stay content — an external edit must re-scan. */
export function isNonContentPath(rel: string, exclude?: readonly string[]): boolean {
  if (isExcludedByProject(rel, exclude)) return true;
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => seg.startsWith('.') || NON_CONTENT_DIRS.has(seg) || isBuildOutputDir(seg));
}

/**
 * Editor-plugin SOURCE, which the watcher must report even though it lives under a
 * dot dir. Plugin sources are not browsable content (they must stay out of the
 * Content Browser and the asset scan), but they are the input to plugin hot reload —
 * two different questions, so two predicates rather than one loosened rule.
 *
 * Below the plugin root the usual content exclusions apply: a dependency install
 * or the editor's own generated typings must not trigger a plugin reload.
 */
export function isPluginSourcePath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (!p.startsWith(`${PROJECT_PLUGIN_REL}/`)) return false;
  const rest = p.slice(PROJECT_PLUGIN_REL.length + 1);
  return rest.length > 0 && !isNonContentPath(rest);
}

/** What the project watcher reports: content, plus plugin sources. */
export function isWatchedPath(rel: string): boolean {
  return isPluginSourcePath(rel) || !isNonContentPath(rel);
}
