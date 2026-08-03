// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Toasts.ts
 * @brief   Transient action feedback (save / build / errors). A tiny external
 *          store (same subscribe/getSnapshot shape as EngineHost / ProjectStore)
 *          so any module — React component or plain class — can post a toast.
 */
import { createStore } from 'zustand/vanilla';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /**
   * How far along the work behind this toast is: 0–100, or `'indeterminate'` for
   * "started, no measurable progress yet". A number that has not moved and a bar
   * that says nothing yet read very differently — a download stuck at "0%" looks
   * broken, while the same moment shown as indeterminate looks like connecting.
   */
  progress?: number | 'indeterminate';
  /** Hide the close button: work the user cannot get back to if they lose it. */
  pinned?: boolean;
}

class ToastsImpl {
  private readonly store = createStore<{ list: Toast[] }>(() => ({ list: [] }));
  private seq = 0;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): Toast[] => this.store.getState().list;

  /** Post a toast; it auto-dismisses after `ttl` ms (0 = sticky until clicked). */
  push(
    message: string,
    kind: ToastKind = 'info',
    ttl = 3200,
    action?: ToastAction,
    extra?: Pick<Toast, 'progress' | 'pinned'>,
  ): number {
    const id = ++this.seq;
    this.store.setState((s) => ({ list: [...s.list, { id, kind, message, action, ...extra }] }));
    if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
    return id;
  }
  /** Is this toast still on screen? For work that has to re-post if it was closed. */
  has(id: number): boolean {
    return this.store.getState().list.some((t) => t.id === id);
  }
  /**
   * Rewrite a live toast in place. For a task that reports as it runs — a download's
   * percentage — where a toast per tick would be a column of stale numbers. No-op
   * once the toast is gone, so a late report cannot resurrect it.
   */
  revise(id: number, patch: Partial<Omit<Toast, 'id'>>): void {
    const cur = this.store.getState().list;
    if (!cur.some((t) => t.id === id)) return;
    this.store.setState({ list: cur.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }
  dismiss(id: number): void {
    const cur = this.store.getState().list;
    const next = cur.filter((t) => t.id !== id);
    if (next.length !== cur.length) this.store.setState({ list: next });
  }
}

export const Toasts = new ToastsImpl();
