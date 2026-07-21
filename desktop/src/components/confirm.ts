// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    confirm.ts
 * @brief   Imperative confirm — `confirm(opts)` resolves true/false when the
 *          user answers the themed ConfirmDialog that <ConfirmHost> (mounted
 *          once in the shell) renders for it. The store is plain (same
 *          subscribe/getSnapshot shape as Toasts) so non-React modules —
 *          ProjectStore, command handlers — can await a confirmation without
 *          reaching for window.confirm (blocking, unthemed, no keyboard
 *          contract). Concurrent requests queue; dialogs show one at a time.
 */
import { createStore } from 'zustand/vanilla';
import type { ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  /** Plain text, or rich content (e.g. an itemized diff preview). */
  body: ReactNode;
  confirmLabel?: string;
  /** Destructive action — the confirm button wears the error fill. */
  danger?: boolean;
}

export interface PendingConfirm extends ConfirmOptions {
  id: number;
}

class ConfirmServiceImpl {
  private readonly store = createStore<{ queue: PendingConfirm[] }>(() => ({ queue: [] }));
  private readonly resolvers = new Map<number, (ok: boolean) => void>();
  private seq = 0;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): PendingConfirm[] => this.store.getState().queue;

  request(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      this.resolvers.set(id, resolve);
      this.store.setState((s) => ({ queue: [...s.queue, { ...opts, id }] }));
    });
  }

  /** Answer a pending request (the host calls this from the dialog buttons). */
  settle(id: number, ok: boolean): void {
    const resolve = this.resolvers.get(id);
    if (!resolve) return;
    this.resolvers.delete(id);
    this.store.setState((s) => ({ queue: s.queue.filter((c) => c.id !== id) }));
    resolve(ok);
  }
}

export const ConfirmService = new ConfirmServiceImpl();

/** Ask the user; resolves when they answer (false on cancel/Escape). */
export const confirm = (opts: ConfirmOptions): Promise<boolean> => ConfirmService.request(opts);
