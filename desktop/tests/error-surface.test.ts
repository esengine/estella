// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Global error surface: the rate limiter's dedupe window, and that the
 *        window handlers route a rejected promise / uncaught error into the
 *        Output Log every time while raising at most one toast per window.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorRateLimiter, installGlobalErrorHandlers } from '@/store/errorSurface';
import { LogStore } from '@/store/LogStore';
import { Toasts } from '@/store/Toasts';

describe('ErrorRateLimiter', () => {
  it('allows once, then suppresses repeats until the window elapses', () => {
    let now = 0;
    const limiter = new ErrorRateLimiter(5000, () => now);
    expect(limiter.allow('a')).toBe(true);
    expect(limiter.allow('a')).toBe(false);
    expect(limiter.allow('b')).toBe(true); // a different key is independent
    now = 5000;
    expect(limiter.allow('a')).toBe(true); // window elapsed
  });
});

describe('installGlobalErrorHandlers', () => {
  const listeners = new Map<string, EventListener>();
  const target = {
    addEventListener: (type: string, fn: EventListener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as Window;

  let dispose: () => void;
  let now: number;

  beforeEach(() => {
    now = 0;
    LogStore.clear();
    dispose = installGlobalErrorHandlers(target, new ErrorRateLimiter(5000, () => now));
  });
  afterEach(() => {
    dispose();
    for (const t of Toasts.getSnapshot()) Toasts.dismiss(t.id);
    LogStore.clear();
  });

  it('routes an unhandled rejection into the Output Log and one toast', () => {
    listeners.get('unhandledrejection')!({ reason: 'boom' } as unknown as Event);
    expect(LogStore.getSnapshot().some((e) => e.level === 'error' && e.message.includes('boom'))).toBe(true);
    expect(Toasts.getSnapshot()).toHaveLength(1);
  });

  it('logs every repeat but suppresses the duplicate toast within the window', () => {
    const fire = () => listeners.get('unhandledrejection')!({ reason: 'boom' } as unknown as Event);
    fire();
    fire();
    fire();
    expect(LogStore.getSnapshot().filter((e) => e.message.includes('boom'))).toHaveLength(3);
    expect(Toasts.getSnapshot()).toHaveLength(1); // deduped

    now = 6000; // past the window
    fire();
    expect(Toasts.getSnapshot()).toHaveLength(2);
  });

  it('routes an uncaught error but ignores a resource-load error (no message)', () => {
    listeners.get('error')!({ message: 'render blew up', error: new Error('render blew up') } as unknown as Event);
    expect(LogStore.getSnapshot().some((e) => e.message.includes('render blew up'))).toBe(true);

    const before = LogStore.getSnapshot().length;
    listeners.get('error')!({ message: '', error: null } as unknown as Event); // resource error
    expect(LogStore.getSnapshot().length).toBe(before);
  });
});
