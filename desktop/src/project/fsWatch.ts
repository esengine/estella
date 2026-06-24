// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { PlayRealm } from '../engine/PlayRealm';

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
    PlayRealm.reload();
  } catch (e) {
    console.warn('[fsWatch] project script rebuild threw', e);
  }
}

/** Subscribe to the main-process project watcher (call once at startup). */
export function initFsWatch(): void {
  if (inited || !window.estella?.fs?.onChange) return;
  inited = true;
  window.estella.fs.onChange((paths) => {
    // Coalesce back-to-back bursts; one scan + one bump per quiet window.
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void ProjectStore.refreshAssets();
      fsRefresh.bump();
    }, 60);

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
