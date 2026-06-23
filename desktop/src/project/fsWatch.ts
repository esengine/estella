// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Live filesystem ↔ editor-asset sync (REARCH_ASSETS A2, renderer side).
 *
 * `fsRefresh` is a bump signal every `useDir` subscribes to (re-read directories).
 * `initFsWatch` subscribes ONCE to the main-process watcher so changes on disk —
 * including edits made OUTSIDE the editor (Finder, git, build output, cooking) —
 * refresh the asset registry + Content Browser, not just the editor's own ops.
 */
import { ProjectStore } from './ProjectStore';

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

/** Subscribe to the main-process project watcher (call once at startup). */
export function initFsWatch(): void {
  if (inited || !window.estella?.fs?.onChange) return;
  inited = true;
  window.estella.fs.onChange(() => {
    // Coalesce back-to-back bursts; one scan + one bump per quiet window.
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void ProjectStore.refreshAssets();
      fsRefresh.bump();
    }, 60);
  });
}
