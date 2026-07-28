// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Concurrent writes to the project manifest.
 *
 * Every setter here is a read-modify-write of one JSON file. Unserialized, two
 * edits in flight both read the pre-edit state and the second write lands on top
 * of the first — losing it, or, when the reads and writes interleave, leaving a
 * file that no longer parses. That is not hypothetical: typing across the fields
 * of one settings row produced a corrupt `.esproject`, and neither tsc nor any
 * existing test noticed, because both defects live in the timing.
 *
 * The fs mock below deliberately yields between read and write. Without the
 * serializing door in ProjectStore these assertions fail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProjectStore } from '@/project/ProjectStore';

vi.mock('@/components/Toasts', () => ({ Toasts: { push: vi.fn() } }));

/**
 * A file whose read and write are separated by a real await, like IPC is.
 *
 * The write is atomic here, because the real one is: `writeFile` opens with 'w'
 * and truncates. The corruption seen in practice — a `.esproject` ending in a
 * stray `]}` — came from two of those overlapping, where one truncates while the
 * other is mid-write. Reproducing that interleave byte-for-byte would be a test
 * of Node's fs rather than of this store; what IS this store's to guarantee, and
 * what these assert, is that patches never overlap in the first place.
 */
function fakeManifestFs(initial: Record<string, unknown>) {
  let text = JSON.stringify(initial, null, 2) + '\n';
  const writes: string[] = [];
  return {
    writes,
    get parsed(): Record<string, unknown> {
      return JSON.parse(text) as Record<string, unknown>;
    },
    get text(): string {
      return text;
    },
    read: vi.fn(async () => {
      await Promise.resolve();
      return text;
    }),
    write: vi.fn(async (_p: string, next: string) => {
      await Promise.resolve();
      text = next;
      writes.push(next);
    }),
  };
}

let fs: ReturnType<typeof fakeManifestFs>;

beforeEach(() => {
  fs = fakeManifestFs({ formatVersion: '1', name: 'p', designResolution: { width: 1920, height: 1080 } });
  (globalThis as unknown as { window: unknown }).window = {
    estella: { fs: { read: fs.read, write: fs.write } },
  };
  // The setters no-op without an open project; inject the minimum they read.
  // Reaching past `private` is the price of testing a singleton's write path —
  // the alternative is mocking the whole open flow to assert on timing.
  (ProjectStore as never as { store: { setState: (s: unknown) => void } }).store.setState({
    project: {
      root: '/p', name: 'p', layout: {}, workspace: {}, currentScene: null,
      designResolution: { width: 1920, height: 1080 },
    },
  });
});

describe('concurrent manifest writes', () => {
  it('keeps the file parseable when writes overlap', async () => {
    await Promise.all([
      ProjectStore.setScreenPresets([{ id: 'a', label: 'A', width: 100, height: 200 }]),
      ProjectStore.setDisplay({ width: 800 }),
      ProjectStore.setDisplay({ height: 600 }),
    ]);
    expect(() => JSON.parse(fs.text)).not.toThrow();
  });

  it('loses no update — each patch sees what the previous one wrote', async () => {
    await Promise.all([
      ProjectStore.setScreenPresets([{ id: 'a', label: 'A', width: 100, height: 200 }]),
      ProjectStore.setDisplay({ width: 800 }),
    ]);

    const m = fs.parsed;
    // Both landed. Unserialized, whichever wrote second would have clobbered the
    // other's field, because both read the same pre-edit file.
    expect(m.screenPresets).toEqual([{ id: 'a', label: 'A', width: 100, height: 200 }]);
    expect(m.designResolution).toMatchObject({ width: 800 });
  });

  it('applies same-field patches in call order', async () => {
    await Promise.all([
      ProjectStore.setDisplay({ width: 111 }),
      ProjectStore.setDisplay({ width: 222 }),
      ProjectStore.setDisplay({ width: 333 }),
    ]);
    expect((fs.parsed.designResolution as { width: number }).width).toBe(333);
    expect(fs.writes).toHaveLength(3);
  });

  it('preserves fields the editor does not model', async () => {
    fs = fakeManifestFs({ formatVersion: '1', name: 'p', customStudioField: { keep: true } });
    (globalThis as unknown as { window: { estella: { fs: unknown } } }).window.estella.fs =
      { read: fs.read, write: fs.write };

    await Promise.all([
      ProjectStore.setDisplay({ width: 640 }),
      ProjectStore.setScreenPresets([{ id: 'b', label: 'B', width: 10, height: 20 }]),
    ]);
    expect(fs.parsed.customStudioField).toEqual({ keep: true });
  });

  it('does not let one failed write stall the queue', async () => {
    // A transient IPC failure must not wedge every later edit — the chain has to
    // keep draining, or one hiccup silently freezes the settings dialog.
    fs.write.mockRejectedValueOnce(new Error('EBUSY'));

    await ProjectStore.setDisplay({ width: 700 });
    await ProjectStore.setDisplay({ width: 900 });

    expect((fs.parsed.designResolution as { width: number }).width).toBe(900);
  });

  it('drops screenPresets from the file when the list is emptied', async () => {
    await ProjectStore.setScreenPresets([{ id: 'a', label: 'A', width: 1, height: 2 }]);
    expect(fs.parsed.screenPresets).toBeDefined();

    await ProjectStore.setScreenPresets([]);
    // Absent, not an empty array: the manifest should not record "no opinion".
    expect('screenPresets' in fs.parsed).toBe(false);
  });
});

/**
 * These reads are used as zustand selectors, which compare with Object.is. A
 * getter that builds a fresh value per call therefore never settles: the
 * component re-renders, reads again, gets another new reference, forever. That
 * took the whole editor window blank once, and tsc had nothing to say about it —
 * the defect is in identity, not in types.
 */
describe('reads used as selectors return stable identities', () => {
  it('answers "no screen presets" with one array, not a new one per call', () => {
    (ProjectStore as never as { store: { setState: (s: unknown) => void } }).store.setState({
      project: { root: '/p', name: 'p', layout: {}, workspace: {}, currentScene: null },
    });
    expect(ProjectStore.screenPresets()).toBe(ProjectStore.screenPresets());
  });

  it('hands back the very array the project declared', async () => {
    const presets = [{ id: 'a', label: 'A', width: 1, height: 2 }];
    await ProjectStore.setScreenPresets(presets);
    // Same reference across reads, so a selector on it settles after one render.
    expect(ProjectStore.screenPresets()).toBe(ProjectStore.screenPresets());
    expect(ProjectStore.screenPresets()).toEqual(presets);
  });

  it('keeps the snapshot stable while nothing changes', () => {
    // useSyncExternalStore tears down with "getSnapshot should be cached" the
    // moment this stops holding.
    expect(ProjectStore.getSnapshot()).toBe(ProjectStore.getSnapshot());
  });
});
