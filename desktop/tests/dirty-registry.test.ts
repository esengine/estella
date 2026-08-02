// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  DirtyRegistry — the aggregate unsaved-changes surface: registration,
 *        aggregation, quit-save (saveAll saves only the dirty documents), and
 *        the discard guard consulting it (incl. the Ctrl+O project.open gate).
 *        Pure TS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DirtyRegistry, type DirtyDocument } from '@/document/DirtyRegistry';
import { confirmDiscard } from '@/project/discardGuard';
import { ConfirmService } from '@/components/confirm';
import { ProjectStore } from '@/project/ProjectStore';
import { commands } from '@/commands';

const doc = (id: string, dirty: boolean, save = vi.fn(async () => {})): DirtyDocument & { save: ReturnType<typeof vi.fn> } => {
  let d = dirty;
  return {
    id,
    isDirty: () => d,
    save: save.mockImplementation(async () => {
      d = false;
    }),
  };
};

beforeEach(() => DirtyRegistry.clearAll());
afterEach(() => {
  DirtyRegistry.clearAll();
  vi.restoreAllMocks();
});

describe('DirtyRegistry', () => {
  it('aggregates dirty over all registered documents', () => {
    expect(DirtyRegistry.isDirty()).toBe(false);
    DirtyRegistry.register(doc('a', false));
    expect(DirtyRegistry.isDirty()).toBe(false);
    const un = DirtyRegistry.register(doc('b', true));
    expect(DirtyRegistry.isDirty()).toBe(true);
    un();
    expect(DirtyRegistry.isDirty()).toBe(false);
  });

  it('saveAll saves only the dirty documents', async () => {
    const clean = doc('clean', false);
    const dirty = doc('dirty', true);
    DirtyRegistry.register(clean);
    DirtyRegistry.register(dirty);
    await DirtyRegistry.saveAll();
    expect(clean.save).not.toHaveBeenCalled();
    expect(dirty.save).toHaveBeenCalledTimes(1);
    expect(DirtyRegistry.isDirty()).toBe(false);
  });

  it('re-registering an id replaces the previous entry', () => {
    DirtyRegistry.register(doc('x', true));
    DirtyRegistry.register(doc('x', false));
    expect(DirtyRegistry.isDirty()).toBe(false);
  });

  it("a replaced entry's stale unregister does not remove the newer one", () => {
    const un = DirtyRegistry.register(doc('x', false));
    DirtyRegistry.register(doc('x', true));
    un(); // stale — must not delete the second registration
    expect(DirtyRegistry.isDirty()).toBe(true);
  });

  it('notifies subscribers on register/unregister, bump, and a participant feed', () => {
    const fn = vi.fn();
    const unsub = DirtyRegistry.subscribe(fn);
    let feed: (() => void) | null = null;
    const un = DirtyRegistry.register({
      id: 'a',
      isDirty: () => false,
      save: async () => {},
      subscribe: (f) => {
        feed = f;
        return () => { feed = null; };
      },
    });
    expect(fn).toHaveBeenCalledTimes(1); // register
    feed!();
    expect(fn).toHaveBeenCalledTimes(2); // participant change feed
    DirtyRegistry.bump();
    expect(fn).toHaveBeenCalledTimes(3);
    un();
    expect(fn).toHaveBeenCalledTimes(4); // unregister
    expect(feed).toBeNull(); // participant feed released
    unsub();
  });
});

describe('confirmDiscard over the registry', () => {
  it('resolves true without prompting when nothing is dirty', async () => {
    await expect(confirmDiscard()).resolves.toBe(true);
    expect(ConfirmService.getSnapshot()).toHaveLength(0);
  });

  it('prompts when any document is dirty and honors the answer', async () => {
    DirtyRegistry.register(doc('a', true));
    const p = confirmDiscard();
    const pending = ConfirmService.getSnapshot();
    expect(pending).toHaveLength(1);
    ConfirmService.settle(pending[0].id, false);
    await expect(p).resolves.toBe(false);
  });
});

describe('project.open guard (Ctrl+O)', () => {
  it('does not open while dirty until the user confirms the discard', async () => {
    const open = vi.spyOn(ProjectStore, 'openViaDialog').mockResolvedValue(false);
    DirtyRegistry.register(doc('a', true));

    const run = commands.get('project.open')!.run() as unknown as Promise<void>;
    await Promise.resolve(); // let confirmDiscard queue the dialog
    const pending = ConfirmService.getSnapshot();
    expect(pending).toHaveLength(1);
    expect(open).not.toHaveBeenCalled(); // gated behind the prompt

    ConfirmService.settle(pending[0].id, false); // Cancel
    await run;
    expect(open).not.toHaveBeenCalled();
  });

  it('opens when clean (no prompt) and after a confirmed discard', async () => {
    const open = vi.spyOn(ProjectStore, 'openViaDialog').mockResolvedValue(false);

    await commands.get('project.open')!.run();
    expect(open).toHaveBeenCalledTimes(1); // clean → straight through

    DirtyRegistry.register(doc('a', true));
    const run = commands.get('project.open')!.run() as unknown as Promise<void>;
    await Promise.resolve();
    ConfirmService.settle(ConfirmService.getSnapshot()[0].id, true); // Discard
    await run;
    expect(open).toHaveBeenCalledTimes(2);
  });
});
