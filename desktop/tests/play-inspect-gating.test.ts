// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayInspect sampling gates + rates: no realm polling without a
 *        subscribed game-mode consumer; tree samples at the slow structural
 *        rate, selected-entity detail at the fast rate (detail-only samples
 *        skip the realm tree walk); the tree reference stays stable when only
 *        values change. PlayRealm is mocked; timers + performance are faked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SceneData } from 'esengine';

vi.mock('@/engine/PlayRealm', () => ({
  PlayRealm: {
    snapshot: vi.fn(),
    setField: vi.fn(),
  },
}));

import { PlayInspect } from '@/engine/PlayInspect';
import { PlayRealm } from '@/engine/PlayRealm';

const snapshotMock = vi.mocked(PlayRealm.snapshot);

const tree = (ids: number[]): SceneData =>
  ({
    version: '1.0',
    name: 'live',
    entities: ids.map((id) => ({ id, name: `E${id}`, parent: null, children: [], components: [{ type: 'Transform', data: {} }] })),
  }) as unknown as SceneData;

let now = 0;

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  snapshotMock.mockImplementation((sel, opts) =>
    Promise.resolve({
      tree: opts?.tree === false ? null : tree([1, 2]),
      selected: sel != null ? (tree([sel as number]).entities[0] ?? null) : null,
    }),
  );
});

afterEach(() => {
  PlayInspect.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  snapshotMock.mockReset();
});

/** Advance fake time and the mocked performance clock together. */
const advance = async (ms: number): Promise<void> => {
  now += ms;
  await vi.advanceTimersByTimeAsync(ms);
};

describe('PlayInspect gating', () => {
  it('does not poll while nobody subscribes', async () => {
    PlayInspect.start();
    await advance(1000);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('polls once a consumer subscribes and stops when the last one leaves', async () => {
    PlayInspect.start();
    const unsub = PlayInspect.subscribe(() => {});
    await advance(500);
    expect(snapshotMock.mock.calls.length).toBeGreaterThan(0);
    const calls = snapshotMock.mock.calls.length;
    unsub();
    await advance(1000);
    expect(snapshotMock.mock.calls.length).toBeLessThanOrEqual(calls + 1); // at most the in-flight one
  });

  it('samples the tree at the slow rate and skips it in between', async () => {
    PlayInspect.start();
    const unsub = PlayInspect.subscribe(() => {});
    await advance(0);
    expect(snapshotMock).toHaveBeenCalledTimes(1);
    expect(snapshotMock.mock.calls[0][1]).toEqual({ tree: true }); // first sample seeds the tree

    PlayInspect.select(7); // detail polling engages
    await advance(500);
    const withTree = snapshotMock.mock.calls.filter((c) => c[1]?.tree !== false).length;
    const detailOnly = snapshotMock.mock.calls.filter((c) => c[1]?.tree === false).length;
    // ~30Hz detail vs ~7Hz tree over 500ms: detail-only samples dominate.
    expect(detailOnly).toBeGreaterThan(withTree);
    expect(withTree).toBeGreaterThanOrEqual(2); // the tree still refreshes periodically
    unsub();
  });

  it('polls at the slow rate while nothing is selected', async () => {
    PlayInspect.start();
    const unsub = PlayInspect.subscribe(() => {});
    await advance(1500);
    // one sample per TREE_GAP (150ms) ≈ 10 + the seed — nowhere near 60Hz (90+).
    expect(snapshotMock.mock.calls.length).toBeLessThanOrEqual(15);
    unsub();
  });

  it('keeps the tree reference stable when only values change', async () => {
    PlayInspect.start();
    const unsub = PlayInspect.subscribe(() => {});
    await advance(200);
    const first = PlayInspect.getTree();
    expect(first).not.toBeNull();
    await advance(300); // more tree samples arrive, same structure (fresh objects)
    expect(PlayInspect.getTree()).toBe(first);
    unsub();
  });

  it('a structural change replaces the tree', async () => {
    PlayInspect.start();
    const unsub = PlayInspect.subscribe(() => {});
    await advance(200);
    const first = PlayInspect.getTree();
    snapshotMock.mockImplementation((_sel, opts) =>
      Promise.resolve({ tree: opts?.tree === false ? null : tree([1, 2, 3]), selected: null }),
    );
    await advance(300);
    expect(PlayInspect.getTree()).not.toBe(first);
    expect(PlayInspect.getTree()?.entities).toHaveLength(3);
    unsub();
  });

  it('stop() clears the live state', async () => {
    PlayInspect.start();
    const unsub = PlayInspect.subscribe(() => {});
    await advance(200);
    expect(PlayInspect.getTree()).not.toBeNull();
    PlayInspect.stop();
    expect(PlayInspect.getTree()).toBeNull();
    expect(PlayInspect.getSelection()).toBeNull();
    unsub();
  });
});
