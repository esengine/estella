// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    newScript.ts
 * @brief   Imperative "New Script" request — `newScript(dir)` resolves with the
 *          created module's project-relative path (or null if cancelled) once the
 *          user answers the dialog <NewScriptHost> renders for it.
 *
 *          Same shape as confirm.ts, and for the same reason: the caller is the
 *          NEW_ASSET_TYPES registry, a plain module with no React of its own, and
 *          a create entry that has to await a name cannot reach a component's
 *          state. Concurrent requests queue; one dialog shows at a time.
 */
import { createStore } from 'zustand/vanilla';

export interface PendingNewScript {
  id: number;
  /** The Content Browser folder the request came from (a hint — the scaffold
   *  redirects it into the project's source root when it lies outside). */
  dir: string;
}

class NewScriptServiceImpl {
  private readonly store = createStore<{ queue: PendingNewScript[] }>(() => ({ queue: [] }));
  private readonly resolvers = new Map<number, (path: string | null) => void>();
  private seq = 0;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PendingNewScript[] => this.store.getState().queue;

  request(dir: string): Promise<string | null> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.resolvers.set(id, resolve);
      this.store.setState((s) => ({ queue: [...s.queue, { id, dir }] }));
    });
  }

  /** Answer a pending request (the host calls this when the dialog closes). */
  settle(id: number, path: string | null): void {
    const resolve = this.resolvers.get(id);
    if (!resolve) return;
    this.resolvers.delete(id);
    this.store.setState((s) => ({ queue: s.queue.filter((r) => r.id !== id) }));
    resolve(path);
  }
}

export const NewScriptService = new NewScriptServiceImpl();

/** Ask for a new script in `dir`; resolves with its path, or null on cancel. */
export const newScript = (dir: string): Promise<string | null> => NewScriptService.request(dir);
