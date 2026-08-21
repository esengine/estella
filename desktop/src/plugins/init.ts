// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  init.ts
 * @brief Ties the plugin host to the editor's lifecycle: load a project's plugins
 *        when it opens, unload them when it closes, and reload one when its source
 *        changes on disk.
 *
 * Project scoping matters — plugins live WITH the project, so switching projects
 * must not leave the previous one's contributions registered. Keeping that rule
 * here (rather than inside PluginHost) leaves the host a pure lifecycle machine
 * that tests can drive without a project.
 */
import { ProjectStore } from '@/project/ProjectStore';
import { PROJECT_PLUGIN_REL, PLUGIN_TYPES_FILE } from '../../../pipeline/src/project/pluginPaths';
import { PluginHost } from './PluginHost';
// The public type surface, as TEXT. types.ts is types-only and import-free
// precisely so it doubles as the `.d.ts` plugin authors compile against — shipping
// the same file the editor itself is typed by means the two can never disagree,
// and there is no package to publish or copy to go stale.
import editorApiTypes from '../../../editor-api/index.ts?raw';

let currentRoot: string | null = null;
let inited = false;

/**
 * Write the plugin API typings into the project so an author's editor resolves
 * `@estella/editor-api` (their tsconfig points `paths` at this file — see the
 * sample plugin). Rewritten on every project open, so the typings always match the
 * running editor rather than whatever version last touched the folder.
 */
async function syncPluginTypes(): Promise<void> {
  try {
    await window.estella.fs.write(PLUGIN_TYPES_FILE, editorApiTypes);
  } catch {
    // A project with no plugins folder yet, or a read-only checkout — authors get
    // typings the moment the folder exists, and nothing here is load-bearing.
  }
}

/**
 * Watch the open project and keep the plugin set in step with it. Call once at
 * startup, before the first project opens.
 */
export function initPlugins(): void {
  if (inited) return;
  inited = true;
  ProjectStore.subscribe(() => {
    const root = ProjectStore.getSnapshot()?.root ?? null;
    if (root === currentRoot) return;
    currentRoot = root;
    // Unload unconditionally on any switch: the outgoing project's plugins must
    // not survive into the incoming one, even if it has plugins of its own.
    void PluginHost.unloadAll().then(async () => {
      if (!root) return;
      await syncPluginTypes();
      await PluginHost.refresh();
    });
  });
}

/** Whether a changed project path is editor-plugin source (never asset content). */
export function isPluginPath(relPath: string): boolean {
  return pluginDirNameOf(relPath) !== null;
}

/** Plugin folder a changed project path belongs to, or null. */
function pluginDirNameOf(relPath: string): string | null {
  const p = relPath.replace(/\\/g, '/');
  const prefix = `${PROJECT_PLUGIN_REL}/`;
  if (!p.startsWith(prefix)) return null;
  const name = p.slice(prefix.length).split('/')[0];
  // A dot-prefixed entry is an editor-managed sidecar (the generated types), and
  // rewriting it must not trigger a reload — that would be an endless loop.
  return name && !name.startsWith('.') ? name : null;
}

/**
 * React to disk changes under the project's plugin folder (called by fsWatch, the
 * editor's single watcher subscriber). Any touched plugin folder is reloaded, which
 * recompiles from source — the loop that makes writing a plugin bearable.
 *
 * Note a folder NAME need not match the plugin id, so this reloads by re-scanning
 * rather than by guessing the id from the path.
 */
export function pluginPathsChanged(paths: readonly string[]): void {
  const touched = new Set<string>();
  for (const p of paths) {
    const dir = pluginDirNameOf(p);
    if (dir) touched.add(dir);
  }
  if (touched.size === 0) return;
  // One refresh covers every case uniformly — a new plugin folder, a deleted one,
  // and an edit to a running one (forced to reload). Cheap: discovery is a shallow
  // directory read, and only the touched plugins recompile.
  void PluginHost.refresh({ forceDirs: [...touched] });
}
