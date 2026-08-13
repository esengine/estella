// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Keeping what a play session changed.
 *
 * The whole idea rests on one distinction: what a PERSON changed, versus what
 * the game did. A diff of the world cannot draw it — a bobbing sprite's y moves
 * every frame and nobody asked for it — so the journal records the addresses the
 * op layer was asked to write, and reads their values back at Stop.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/engine/SceneCommands', () => ({
  SceneCommands: {
    setField: vi.fn(),
    setFieldValue: vi.fn(),
    setEntityVisible: vi.fn(),
    setEntityXY: vi.fn(),
    transact: vi.fn((_label: string, fn: () => void) => fn()),
  },
  toModelValue: (_cur: unknown, _t: unknown, _k: string, v: unknown) => v,
}));
vi.mock('@/engine/PlayRealm', () => ({
  PlayRealm: { setField: vi.fn(), setVisible: vi.fn(), dragTo: vi.fn(), snapshot: vi.fn() },
}));

import { PlayEdits } from '@/engine/playEdits';
import { EntityOps } from '@/engine/entityOps';
import { SceneCommands } from '@/engine/SceneCommands';
import { PlayRealm } from '@/engine/PlayRealm';
import { PlayInspect } from '@/engine/PlayInspect';
import { SceneModel } from '@/engine/SceneModel';
import { useEditorStore } from '@/store/editorStore';
import { authoredRef, spawnedRef } from '@/engine/entityRef';

const snapshotMock = vi.mocked(PlayRealm.snapshot);

/** Play, with the realm holding runtime 900 for document row 3. */
function playing() {
  useEditorStore.setState({ isPlaying: true });
  vi.spyOn(PlayInspect, 'liveIdOf').mockImplementation((ref) =>
    ref == null ? null : ref.world === 'authored' ? (ref.src === 3 ? 900 : null) : ref.live);
  vi.spyOn(PlayInspect, 'componentData').mockReturnValue({});
  vi.spyOn(SceneModel, 'entityBySource').mockReturnValue({ name: 'Player' } as never);
}

/** The realm's answer: entity 900 sits at x 42, and is hidden. */
function realmHolds(position: { x: number; y: number }, hidden = false) {
  snapshotMock.mockImplementation((sel, opts) =>
    Promise.resolve({
      tree: opts?.tree === false ? null : ({ entities: [{ id: 900, name: 'Player', parent: null, components: [], hidden }] } as never),
      selected: sel == null ? null : ({ id: sel, components: [{ type: 'Transform', data: { position } }] } as never),
      overlay: null,
    }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  PlayEdits.clear();
  useEditorStore.setState({ isPlaying: false });
});

describe('the journal', () => {
  it('records nothing for an edit made while not playing', () => {
    EntityOps.setField(authoredRef(3), 'Sprite', 'color', 'color', [1, 0, 0, 1]);
    expect(PlayEdits.count()).toBe(0);
  });

  it('records one address per field, however many times it is written', () => {
    playing();
    for (let i = 0; i < 5; i++) {
      EntityOps.moveToPoint(authoredRef(3), { canvas: { x: i / 10, y: 0.5 } });
    }
    // A drag is hundreds of writes and one intent.
    expect(PlayEdits.count()).toBe(1);
  });

  it('separates a field write, a move and a visibility toggle', () => {
    playing();
    EntityOps.setField(authoredRef(3), 'Sprite', 'color', 'color', [1, 0, 0, 1]);
    EntityOps.moveToPoint(authoredRef(3), { canvas: { x: 0.5, y: 0.5 } });
    EntityOps.setVisible(authoredRef(3), false);
    expect(PlayEdits.count()).toBe(3);
  });

  it('keeps nothing on its own — a write that was refused is not an edit', () => {
    playing();
    // Row 4 has no live entity, so the op is refused; it must not be journalled.
    expect(EntityOps.setField(authoredRef(4), 'Sprite', 'color', 'color', [1, 0, 0, 1])).toBeNull();
    expect(PlayEdits.count()).toBe(0);
  });
});

describe('the harvest', () => {
  it('reads the value the running world holds NOW, not the one written', async () => {
    playing();
    realmHolds({ x: 42, y: 7 });
    // The drag asked for a canvas point; what gets kept is where the entity
    // actually ended up, which is the only value anyone was looking at.
    EntityOps.moveToPoint(authoredRef(3), { canvas: { x: 0.9, y: 0.1 } });

    const { edits, spawned } = await PlayEdits.harvest();
    expect(spawned).toBe(0);
    expect(edits).toHaveLength(1);
    expect(edits[0].src).toBe(3);
    expect(edits[0].label).toBe('Player · Transform.position');
    expect(edits[0].shown).toBe('x 42, y 7');

    edits[0].apply();
    expect(SceneCommands.setFieldValue).toHaveBeenCalledWith(3, 'Transform', 'position', { x: 42, y: 7 });
  });

  it('cannot keep an edit to something the game spawned, and says so', async () => {
    playing();
    realmHolds({ x: 1, y: 1 });
    EntityOps.setVisible(spawnedRef(901), false);

    const { edits, spawned } = await PlayEdits.harvest();
    // No document row exists to write it to — counted, not silently dropped.
    expect(edits).toHaveLength(0);
    expect(spawned).toBe(1);
  });

  it('carries a visibility toggle back as the show/hide command', async () => {
    playing();
    realmHolds({ x: 0, y: 0 }, true);
    EntityOps.setVisible(authoredRef(3), false);

    const { edits } = await PlayEdits.harvest();
    expect(edits).toHaveLength(1);
    edits[0].apply();
    expect(SceneCommands.setEntityVisible).toHaveBeenCalledWith(3, false);
  });

  it('applies everything as one undo step', async () => {
    playing();
    realmHolds({ x: 5, y: 5 });
    EntityOps.moveToPoint(authoredRef(3), { canvas: { x: 0.5, y: 0.5 } });
    EntityOps.setVisible(authoredRef(3), false);

    const { edits } = await PlayEdits.harvest();
    PlayEdits.applyAll(edits, 'Keep play changes');
    expect(SceneCommands.transact).toHaveBeenCalledTimes(1);
    expect(SceneCommands.setFieldValue).toHaveBeenCalled();
    expect(SceneCommands.setEntityVisible).toHaveBeenCalled();
  });

  it('has nothing to harvest when nothing was touched', async () => {
    playing();
    const { edits, spawned } = await PlayEdits.harvest();
    expect(edits).toHaveLength(0);
    expect(spawned).toBe(0);
    expect(snapshotMock).not.toHaveBeenCalled(); // no realm round-trip for nothing
  });
});
