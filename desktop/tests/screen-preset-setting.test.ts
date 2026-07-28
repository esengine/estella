// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The screen-preset editor, as a settings descriptor.
 *
 * The settings system is declarative — "new setting = new descriptor, the UI
 * needs no change" — so what is worth pinning is the DESCRIPTOR: its columns,
 * the row it seeds, and above all its validation. An id is what a saved device
 * selection resolves through, so a blank or duplicated one has to be caught
 * where the user can still see it, not silently at load.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/project/ProjectStore', () => ({
  ProjectStore: {
    screenPresets: () => [],
    setScreenPresets: vi.fn(),
    designResolution: () => ({ width: 1920, height: 1080 }),
    resolvedOrientation: () => 'landscape',
    setDisplay: vi.fn(),
    setPackaging: vi.fn(),
    setFeatures: vi.fn(),
    features: () => ({}),
    subscribe: () => () => {},
    getSnapshot: () => null,
  },
}));

await import('@/settings/projectSettings');
const { settingsRegistry } = await import('@/settings/registry');

const setting = settingsRegistry.get('project.display.screenPresets') as never as {
  type: string;
  layout?: string;
  columns: { key: string; type: string }[];
  detailColumns?: { key: string; type: string }[];
  newRow: () => Record<string, unknown>;
  rowError: (row: Record<string, unknown>, all: Record<string, unknown>[]) => string | null;
  bind: { set: (v: Record<string, unknown>[]) => void };
};

describe('screen-preset setting descriptor', () => {
  it('is registered as a full-width object list', () => {
    expect(setting).toBeDefined();
    expect(setting.type).toBe('objectList');
    // A four-column table does not fit the dialog's fixed control column.
    expect(setting.layout).toBe('block');
    expect(setting.columns.map((c) => c.key)).toEqual(['id', 'label', 'width', 'height']);
  });

  it('seeds a new row portrait, like the built-ins store theirs', () => {
    // One meaning for the orientation toggle across built-in and project screens:
    // a swap is always the same operation.
    const row = setting.newRow();
    expect(Number(row.height)).toBeGreaterThan(Number(row.width));
  });

  describe('row validation', () => {
    const ok = { id: 'deck', label: 'Steam Deck', width: 800, height: 1280 };

    it('accepts a complete row', () => {
      expect(setting.rowError(ok, [ok])).toBeNull();
    });

    it('requires an id — it is what a saved selection refers to', () => {
      expect(setting.rowError({ ...ok, id: '' }, [{ ...ok, id: '' }])).toBeTruthy();
      expect(setting.rowError({ ...ok, id: '   ' }, [{ ...ok, id: '   ' }])).toBeTruthy();
    });

    it('rejects a duplicate id rather than letting one row shadow another', () => {
      const dup = [ok, { ...ok, label: 'Other' }];
      expect(setting.rowError(ok, dup)).toBeTruthy();
    });

    it('rejects non-positive dimensions', () => {
      expect(setting.rowError({ ...ok, width: 0 }, [ok])).toBeTruthy();
      expect(setting.rowError({ ...ok, height: -5 }, [ok])).toBeTruthy();
    });

    it('reports the problem instead of blocking the keystroke', () => {
      // A half-typed row is a normal state; the message is what tells the user.
      expect(typeof setting.rowError({ ...ok, id: '' }, [])).toBe('string');
    });
  });
});

describe('safe-area insets', () => {
  it('are edited in an expander, addressed by dot path', () => {
    // Four more columns would widen every row to serve the few screens that
    // have a notch, so they live behind the row's expander.
    expect(setting.detailColumns?.map((c) => c.key))
      .toEqual(['safe.top', 'safe.bottom', 'safe.left', 'safe.right']);
    expect(setting.detailColumns?.every((c) => c.type === 'number')).toBe(true);
  });

  it('persist when any edge is set', async () => {
    const { ProjectStore } = await import('@/project/ProjectStore');
    setting.bind.set([{ id: 'a', label: 'A', width: 1170, height: 2532, safe: { top: 59, bottom: 34, left: 0, right: 0 } }]);
    expect(ProjectStore.setScreenPresets).toHaveBeenCalledWith([
      { id: 'a', label: 'A', width: 1170, height: 2532, safe: { top: 59, bottom: 34, left: 0, right: 0 } },
    ]);
  });

  it('are dropped entirely when every edge is zero', async () => {
    const { ProjectStore } = await import('@/project/ProjectStore');
    // "No safe area" and "a safe area of nothing" are the same screen; only one
    // of them belongs in the project file.
    setting.bind.set([{ id: 'a', label: 'A', width: 8, height: 9, safe: { top: 0, bottom: 0, left: 0, right: 0 } }]);
    expect(ProjectStore.setScreenPresets).toHaveBeenLastCalledWith([
      { id: 'a', label: 'A', width: 8, height: 9 },
    ]);
  });

  it('clamp a negative edge rather than shipping it', async () => {
    const { ProjectStore } = await import('@/project/ProjectStore');
    setting.bind.set([{ id: 'a', label: 'A', width: 8, height: 9, safe: { top: -5, bottom: 20, left: 0, right: 0 } }]);
    expect(ProjectStore.setScreenPresets).toHaveBeenLastCalledWith([
      { id: 'a', label: 'A', width: 8, height: 9, safe: { top: 0, bottom: 20, left: 0, right: 0 } },
    ]);
  });
});
