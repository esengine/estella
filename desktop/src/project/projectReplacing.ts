// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  "The open project is being replaced" — announced, not phoned around.
 *
 * Opening a project has to invalidate whatever the PREVIOUS one left in flight:
 * a debounced file-watch burst, a warmed play realm. The store used to call each
 * subsystem by name, which made it depend on its own dependents (a cycle) and
 * meant every new subsystem with in-flight state had to be added to that list by
 * whoever remembered.
 *
 * Announced SYNCHRONOUSLY, before the new project's state lands, so a subscriber
 * that drops queued work is guaranteed to run before anything can act on the new
 * project. No imports, for the same reason as fsRefresh: subscribing costs
 * nothing but the signal.
 */

const listeners = new Set<() => void>();

export const projectReplacing = {
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Announced by the project store as it swaps projects. A throwing subscriber
   *  must not strand the others, or the rest of the old project stays live. */
  announce: (): void => {
    for (const l of [...listeners]) {
      try {
        l();
      } catch (e) {
        console.error('[project] a projectReplacing subscriber threw', e);
      }
    }
  },
};
