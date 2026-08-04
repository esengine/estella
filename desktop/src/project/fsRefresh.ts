// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The "something on disk changed" signal.
 *
 * Deliberately its own module with NO imports: everything that wants to re-read
 * after a disk change subscribes here — panels, the asset store, caches keyed by
 * file content. It lived inside fsWatch, which meant a panel that only wanted
 * the signal pulled in the watcher, the project store and the plugin host with
 * it, and made the store↔watcher edge a dependency cycle.
 *
 * The signal says only THAT something changed, never what: a subscriber
 * re-reads whatever it holds. `get()` is the version counter, for a subscriber
 * that memoizes across renders.
 */

const listeners = new Set<() => void>();
let version = 0;

/** A re-read signal shared by every mounted `useDir` (no prop/context threading). */
export const fsRefresh = {
  bump: (): void => {
    version++;
    for (const l of listeners) l();
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: (): number => version,
};
