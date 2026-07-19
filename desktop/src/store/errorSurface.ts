// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    errorSurface.ts
 * @brief   Route otherwise-silent renderer faults somewhere visible.
 *
 * LogStore only patches `console.*`, so a rejected promise or an uncaught error
 * surfaces nowhere. This registers the window handlers that push them into the
 * Output Log and raise a rate-limited error toast — rate-limited so one promise
 * that rejects every frame can't spam the toast stack.
 */
import { LogStore } from './LogStore';
import { Toasts } from './Toasts';
import { t } from '@/i18n';

/** Emits at most once per key per window; a repeating fault stays quiet until the
 *  window elapses. */
export class ErrorRateLimiter {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly windowMs = 5000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.windowMs) return false;
    this.last.set(key, t);
    if (this.last.size > 64) {
      for (const [k, v] of this.last) if (t - v >= this.windowMs) this.last.delete(k);
    }
    return true;
  }
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.stack || reason.message;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Register the global 'unhandledrejection' + 'error' handlers on `target`. Each
 * fault is logged in full to the Output Log and — deduped by the limiter — raises
 * a short error toast. Returns a disposer.
 */
export function installGlobalErrorHandlers(
  target: Window = window,
  limiter: ErrorRateLimiter = new ErrorRateLimiter(),
): () => void {
  const surface = (source: 'unhandledrejection' | 'error', message: string) => {
    LogStore.push('error', source, message);
    if (limiter.allow(message)) {
      Toasts.push(t('err.uncaught', { message: message.split('\n')[0].slice(0, 200) }), 'error');
    }
  };
  const onRejection = (e: PromiseRejectionEvent) => surface('unhandledrejection', reasonMessage(e.reason));
  const onError = (e: ErrorEvent) => {
    // Resource-load errors (a failed <img>/<script>) carry no Error and no useful
    // message and aren't renderer faults — ignore them.
    if (!e.error && !e.message) return;
    surface('error', e.error instanceof Error ? e.error.stack || e.error.message : e.message);
  };
  target.addEventListener('unhandledrejection', onRejection as EventListener);
  target.addEventListener('error', onError as EventListener);
  return () => {
    target.removeEventListener('unhandledrejection', onRejection as EventListener);
    target.removeEventListener('error', onError as EventListener);
  };
}
