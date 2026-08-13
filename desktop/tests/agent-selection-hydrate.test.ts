// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The model pick a window starts on.
 *
 * It is read once, while the store is being constructed, out of a `try` that is
 * there for a browser refusing storage. Anything else thrown in that read —
 * including a `const` touched before its declaration ran — comes back as "no
 * pick saved", and the composer silently offers the default instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FLASH = { providerId: 'deepseek', model: 'deepseek-v4-flash' };

/** A window that already has a pick saved, as a returning one does. */
function windowWith(entries: Record<string, string>): void {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('the pick a returning window starts on', () => {
  it('is the one that was saved', async () => {
    windowWith({ 'estella.agent.selection': JSON.stringify(FLASH) });
    const { useAgent } = await import('@/store/AgentStore');
    expect(useAgent.getState().selection).toEqual(FLASH);
  });

  it('is nothing when nothing was saved', async () => {
    windowWith({});
    const { useAgent } = await import('@/store/AgentStore');
    expect(useAgent.getState().selection).toBeNull();
  });

  it('is nothing, rather than a crash, when the saved value is torn', async () => {
    windowWith({ 'estella.agent.selection': '{not json' });
    const { useAgent } = await import('@/store/AgentStore');
    expect(useAgent.getState().selection).toBeNull();
  });

  it('is nothing where the browser refuses storage at all', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('access denied'); },
    });
    const { useAgent } = await import('@/store/AgentStore');
    expect(useAgent.getState().selection).toBeNull();
  });
});
