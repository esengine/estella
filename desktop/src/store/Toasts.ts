/**
 * @file    Toasts.ts
 * @brief   Transient action feedback (save / build / errors). A tiny external
 *          store (same subscribe/getSnapshot shape as EngineHost / ProjectStore)
 *          so any module — React component or plain class — can post a toast.
 */
import { createStore } from 'zustand/vanilla';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

class ToastsImpl {
  private readonly store = createStore<{ list: Toast[] }>(() => ({ list: [] }));
  private seq = 0;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): Toast[] => this.store.getState().list;

  /** Post a toast; it auto-dismisses after `ttl` ms (0 = sticky until clicked). */
  push(message: string, kind: ToastKind = 'info', ttl = 3200): number {
    const id = ++this.seq;
    this.store.setState((s) => ({ list: [...s.list, { id, kind, message }] }));
    if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
    return id;
  }
  dismiss(id: number): void {
    const cur = this.store.getState().list;
    const next = cur.filter((t) => t.id !== id);
    if (next.length !== cur.length) this.store.setState({ list: next });
  }
}

export const Toasts = new ToastsImpl();
