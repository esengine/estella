/**
 * @file    Toasts.ts
 * @brief   Transient action feedback (save / build / errors). A tiny external
 *          store (same subscribe/getSnapshot shape as EngineHost / ProjectStore)
 *          so any module — React component or plain class — can post a toast.
 */
export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

class ToastsImpl {
  private list: Toast[] = [];
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): Toast[] => this.list;

  /** Post a toast; it auto-dismisses after `ttl` ms (0 = sticky until clicked). */
  push(message: string, kind: ToastKind = 'info', ttl = 3200): number {
    const id = ++this.seq;
    this.list = [...this.list, { id, kind, message }];
    this.emit();
    if (ttl > 0) setTimeout(() => this.dismiss(id), ttl);
    return id;
  }
  dismiss(id: number): void {
    const next = this.list.filter((t) => t.id !== id);
    if (next.length !== this.list.length) {
      this.list = next;
      this.emit();
    }
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const Toasts = new ToastsImpl();
