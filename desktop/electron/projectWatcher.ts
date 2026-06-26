// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project filesystem watcher (REARCH_ASSETS A2 — live asset sync).
 *
 * Watches the open project root and pushes a debounced, coalesced change event to
 * the renderer so the asset registry + Content Browser stay in sync with on-disk
 * reality — including edits made OUTSIDE the editor (Finder, git, build output,
 * the cook step). This is the editor's first main→renderer PUSH channel; the rest
 * of the bridge is request/response.
 *
 * Uses native recursive `fs.watch` (no dependency). Recursive watching is native
 * on macOS + Windows; on Linux `fs.watch` is non-recursive, so it degrades to the
 * top level there — a chokidar swap behind this same IPC contract is the
 * cross-platform upgrade if/when Linux dev matters.
 */
import { watch, type FSWatcher } from 'node:fs';
import type { WebContents } from 'electron';

// Our own cache writes (assets.json / schemas.json / scripts.mjs under
// `.esengine`) MUST be ignored — refreshing on them would loop. Plus the usual
// heavy/irrelevant noise dirs.
const IGNORED = ['.esengine', 'node_modules', '.git', 'dist', 'build'];

/** True if a project-relative path is watcher noise (an ignored dir or its tree). */
export function isIgnoredPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  return IGNORED.some((d) => norm === d || norm.startsWith(`${d}/`));
}

const DEBOUNCE_MS = 180;

let watcher: FSWatcher | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending = new Set<string>();

/** Stop watching (project switch / window close). */
export function stopProjectWatch(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = new Set();
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

/**
 * Watch `root` and push `project:fsChanged` to `wc` (debounced + coalesced) on
 * any change outside the ignored set. Replaces any existing watch. Failure to
 * watch is non-fatal — the editor's own mutations still refresh optimistically.
 */
export function startProjectWatch(root: string, wc: WebContents): void {
  stopProjectWatch();
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return; // no path → can't filter safely (would risk the cache loop)
      const rel = filename.toString().replace(/\\/g, '/');
      if (isIgnoredPath(rel)) return;
      pending.add(rel);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const paths = [...pending];
        pending = new Set();
        timer = null;
        if (!wc.isDestroyed()) wc.send('project:fsChanged', { paths });
      }, DEBOUNCE_MS);
    });
  } catch (err) {
    console.warn('[watcher] could not watch project root', err);
  }
}
