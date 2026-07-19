// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Live filesystem ↔ editor-asset sync (renderer side).
 *
 * `fsRefresh` is a bump signal every `useDir` subscribes to (re-read directories).
 * `initFsWatch` subscribes ONCE to the main-process watcher so changes on disk —
 * including edits made OUTSIDE the editor (Finder, git, build output, cooking) —
 * refresh the asset registry + Content Browser, not just the editor's own ops.
 */
import { ProjectStore } from './ProjectStore';
import { PlayRealm, PlayRealms } from '../engine/PlayRealm';

const listeners = new Set<() => void>();
let version = 0;

/** A re-read signal shared by every mounted `useDir` (no prop/context threading). */
export const fsRefresh = {
  bump: () => {
    version++;
    for (const l of listeners) l();
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: () => version,
};

let inited = false;
let debounce: ReturnType<typeof setTimeout> | null = null;
let schemaDebounce: ReturnType<typeof setTimeout> | null = null;
let scriptsDebounce: ReturnType<typeof setTimeout> | null = null;
let sceneDebounce: ReturnType<typeof setTimeout> | null = null;
// Coalesce the changed paths across the debounce window (not just the last
// burst): the incremental registry update needs EVERY changed path, or a change
// two bursts back would be silently dropped. An empty burst (watcher overflow —
// filename unknown) forces a full rescan for the window.
let pendingPaths = new Set<string>();
let sawOverflow = false;

// A project source module under src/ — a change here can alter a project
// component's field schema, so the inspector must re-extract (esbuild, ~100ms).
const isSourceModule = (p: string): boolean => /(^|[\\/])src[\\/].*\.(t|j)sx?$/.test(p);

// A gameplay-logic edit while Play is live → rebuild the project bundle and
// hot-reload the running realm in place (keeps wasm/GL/assets; ~100ms). A build
// error keeps the realm on the last-good bundle rather than reloading a broken one.
async function rebuildScriptsAndReloadPlay(): Promise<void> {
  const buildScripts = window.estella?.project?.buildScripts;
  if (!buildScripts) return;
  try {
    const res = await buildScripts();
    if (!res.ok) {
      console.warn('[fsWatch] project script rebuild failed; keeping running realm', res.errors);
      return;
    }
    PlayRealms.reload();
  } catch (e) {
    console.warn('[fsWatch] project script rebuild threw', e);
  }
}

/** Subscribe to the main-process project watcher (call once at startup). */
export function initFsWatch(): void {
  if (inited || !window.estella?.fs?.onChange) return;
  inited = true;
  window.estella.fs.onChange((paths) => {
    // Coalesce back-to-back bursts; one incremental update + one bump per quiet
    // window. Accumulate the precise paths so none is lost across bursts.
    if (paths.length === 0) sawOverflow = true;
    else for (const p of paths) pendingPaths.add(p);
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      const batch = sawOverflow ? [] : [...pendingPaths];
      pendingPaths = new Set();
      sawOverflow = false;
      void ProjectStore.applyDiskChanges(batch).then(() => {
        // With the registry fresh, drop stale caches for the changed files and
        // reload + re-project whatever the open scene still references — an
        // externally rewritten texture/tilemap must not keep rendering old bytes
        // (or fragments of whichever texture inherited its evicted handle).
        ProjectStore.hotSyncChangedPaths(batch);
      });
      fsRefresh.bump();
    }, 60);

    // The open scene changed on disk (external edit, git, build output) → reload it.
    if (ProjectStore.isOpenScenePath(paths)) {
      if (sceneDebounce) clearTimeout(sceneDebounce);
      sceneDebounce = setTimeout(() => void ProjectStore.reloadOpenSceneFromDisk(), 120);
    }

    // A component-source edit → re-extract schemas so the inspector reflects the
    // new fields live (separate, longer window: extraction bundles with esbuild).
    if (paths.some(isSourceModule)) {
      if (schemaDebounce) clearTimeout(schemaDebounce);
      schemaDebounce = setTimeout(() => void ProjectStore.refreshUserSchemas(), 250);

      // Live gameplay-logic hot-reload — only while playing, so editing without
      // Play is unaffected. Separate window: a bundle rebuild + in-place reload.
      if (PlayRealm.getSnapshot().playing) {
        if (scriptsDebounce) clearTimeout(scriptsDebounce);
        scriptsDebounce = setTimeout(() => void rebuildScriptsAndReloadPlay(), 250);
      }
    }
  });
}

/** Drop pending debounced work + accumulated paths. Call on project switch so a
 *  burst captured for the old project can't flush against the new one. */
export function resetFsWatch(): void {
  for (const t of [debounce, schemaDebounce, scriptsDebounce, sceneDebounce]) {
    if (t) clearTimeout(t);
  }
  debounce = schemaDebounce = scriptsDebounce = sceneDebounce = null;
  pendingPaths = new Set();
  sawOverflow = false;
}
