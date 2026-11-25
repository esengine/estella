// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { it, expect, vi, afterEach } from 'vitest';
import { createAbort } from '../src/util/abort';
import { log } from '../src/util/logger';

afterEach(() => { vi.unstubAllGlobals(); });

it('uses the platform controller where there is one', () => {
  const handle = createAbort();
  expect(handle).toBeInstanceOf(AbortController);
});

it('finishes native cancellation when a listener throws or removes another listener', () => {
  vi.stubGlobal('AbortController', undefined);
  const handle = createAbort(), reason = new Error('scene retired');
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
  const removed = vi.fn(), heard = { handleEvent: vi.fn() };
  try {
    handle.signal.onabort = () => { throw reason; };
    handle.signal.addEventListener('abort', () => handle.signal.removeEventListener('abort', removed));
    handle.signal.addEventListener('abort', removed);
    handle.signal.addEventListener('abort', heard);
    handle.signal.addEventListener('abort', heard);
    handle.abort(reason);
    handle.abort();
    expect(heard.handleEvent).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    expect(handle.signal.reason).toBe(reason);
    expect(warn).toHaveBeenCalledOnce();
  } finally { warn.mockRestore(); }
});

it('has a handle of its own where the host (QuickJS) has no AbortController', () => {
  vi.stubGlobal('AbortController', undefined);
  const handle = createAbort();
  const heard: string[] = [];
  handle.signal.addEventListener('abort', () => heard.push('listener'));
  handle.signal.onabort = () => heard.push('onabort');
  expect(handle.signal.aborted).toBe(false);
  expect(() => handle.signal.throwIfAborted()).not.toThrow();
  handle.abort();
  handle.abort();
  expect(handle.signal.aborted).toBe(true);
  expect(heard).toEqual(['onabort', 'listener']);
  expect(() => handle.signal.throwIfAborted()).toThrow(/aborted/);
});
