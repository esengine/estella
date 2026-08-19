// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  One write, whichever world is showing.
 *
 * The point of the op layer is that a caller cannot accidentally write to the
 * wrong world, and cannot silently write to none. Both halves are claims here:
 * where each op landed, and that a ref the running world has no entity for is
 * refused rather than quietly dropped into the document.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/engine/SceneCommands', () => ({
  SceneCommands: {
    setField: vi.fn(),
    setFieldValue: vi.fn(),
    setEntityVisible: vi.fn(),
    setEntityWorldPos: vi.fn(),
  },
  toModelValue: (_cur: unknown, _type: unknown, _key: string, value: unknown) => value,
}));
vi.mock('@/engine/PlayRealm', () => ({
  PlayRealm: { setField: vi.fn(), setVisible: vi.fn(), dragTo: vi.fn(), transformBy: vi.fn(), snapshot: vi.fn() },
}));

import { EntityOps } from '@/engine/entityOps';
import { quatToEuler } from '@/engine/schema';
import { SceneCommands } from '@/engine/SceneCommands';
import { PlayRealm } from '@/engine/PlayRealm';
import { PlayInspect } from '@/engine/PlayInspect';
import { useEditorStore } from '@/store/editorStore';
import { authoredRef, spawnedRef } from '@/engine/entityRef';
import { SceneQuery } from '@/engine/SceneQuery';

/** Play, with the realm holding runtime 900 for document row 3 and nothing else. */
function playingWith(pairs: Array<{ live: number; src?: number }>) {
  useEditorStore.setState({ isPlaying: true });
  vi.spyOn(PlayInspect, 'liveIdOf').mockImplementation((ref) => {
    if (ref == null) return null;
    if (ref.world === 'spawned') return pairs.some((p) => p.live === ref.live) ? ref.live : null;
    return pairs.find((p) => p.src === ref.src)?.live ?? null;
  });
  vi.spyOn(PlayInspect, 'componentData').mockReturnValue({});
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useEditorStore.setState({ isPlaying: false });
});

describe('while editing', () => {
  it('sends a field write to the document, by source id', () => {
    expect(EntityOps.setField(authoredRef(3), 'Transform', 'position', 'vec3', [1, 2, 0])).toBe('document');
    expect(SceneCommands.setField).toHaveBeenCalledWith(3, 'Transform', 'position', 'vec3', [1, 2, 0]);
    expect(PlayRealm.setField).not.toHaveBeenCalled();
  });

  it('moves through the document command, in world units', () => {
    expect(EntityOps.moveToPoint(authoredRef(3), { world: { x: 10, y: 20 } })).toBe('document');
    expect(SceneCommands.setEntityWorldPos).toHaveBeenCalledWith(3, 10, 20);
  });

  it('refuses a ref the document has no entity for', () => {
    // A spawned ref outside play has nothing behind it in either world; writing
    // its realm id into the document would edit whatever row shares the number.
    expect(EntityOps.setField(spawnedRef(900), 'Transform', 'position', 'vec3', [1, 2, 0])).toBeNull();
    expect(SceneCommands.setField).not.toHaveBeenCalled();
  });
});

describe('while playing', () => {
  it('sends the same field write to the realm, by runtime id', () => {
    playingWith([{ live: 900, src: 3 }]);
    expect(EntityOps.setField(authoredRef(3), 'Sprite', 'color', 'color', [1, 0, 0, 1])).toBe('live');
    expect(PlayRealm.setField).toHaveBeenCalledWith(900, 'Sprite', 'color', [1, 0, 0, 1]);
    expect(SceneCommands.setField).not.toHaveBeenCalled();
  });

  it('never reaches the document — that is what makes a play edit temporary', () => {
    playingWith([{ live: 900, src: 3 }]);
    EntityOps.setVisible(authoredRef(3), false);
    EntityOps.moveToPoint(authoredRef(3), { canvas: { x: 0.5, y: 0.25 } }, 'x');
    expect(PlayRealm.setVisible).toHaveBeenCalledWith(900, false);
    expect(PlayRealm.dragTo).toHaveBeenCalledWith(900, 0.5, 0.25, 'x', undefined);
    expect(SceneCommands.setEntityVisible).not.toHaveBeenCalled();
    expect(SceneCommands.setEntityWorldPos).not.toHaveBeenCalled();
  });

  it('hands the grid to the side that can resolve it', () => {
    // A grid step is world units; the canvas point is not. Snapping in the editor
    // would need the game's camera, which is exactly what it does not have.
    playingWith([{ live: 900, src: 3 }]);
    EntityOps.moveToPoint(authoredRef(3), { canvas: { x: 0.5, y: 0.25 }, snap: 32 });
    expect(PlayRealm.dragTo).toHaveBeenCalledWith(900, 0.5, 0.25, undefined, 32);
  });

  it('refuses a write to something the running world destroyed', () => {
    playingWith([]); // row 3 was never spawned, or is already gone
    expect(EntityOps.setField(authoredRef(3), 'Sprite', 'color', 'color', [1, 0, 0, 1])).toBeNull();
    expect(PlayRealm.setField).not.toHaveBeenCalled();
    expect(SceneCommands.setField).not.toHaveBeenCalled();
  });

  it('writes to a spawned entity the document knows nothing about', () => {
    playingWith([{ live: 901 }]);
    expect(EntityOps.setVisible(spawnedRef(901), false)).toBe('live');
    expect(PlayRealm.setVisible).toHaveBeenCalledWith(901, false);
  });

  it('reports the world a write would land in without performing one', () => {
    playingWith([{ live: 900, src: 3 }]);
    expect(EntityOps.worldFor(authoredRef(3))).toBe('live');
    expect(EntityOps.worldFor(authoredRef(4))).toBeNull();
    expect(EntityOps.worldFor(null)).toBeNull();
    expect(PlayRealm.setField).not.toHaveBeenCalled();
  });
});

describe('turning and resizing', () => {
  it('composes onto what the document already has', () => {
    // The field reads as three degrees (X, Y, Z), so a quarter turn adds to the Z.
    vi.spyOn(SceneQuery, 'getFieldValue').mockReturnValue([0, 0, 90] as never);
    expect(EntityOps.turnBy(authoredRef(3), Math.PI / 2)).toBe('document');
    const [, , , value] = vi.mocked(SceneCommands.setFieldValue).mock.calls[0];
    // Quarter + quarter = half: z 1, w 0.
    expect((value as { z: number }).z).toBeCloseTo(1);
    expect((value as { w: number }).w).toBeCloseTo(0);
  });

  it('keeps a 3D pose while turning about Z', () => {
    // A model imported with a tilt must survive a nudge — the turn is about Z,
    // not a fresh rotation built from a Z angle alone.
    vi.spyOn(SceneQuery, 'getFieldValue').mockReturnValue([30, -45, 10] as never);
    EntityOps.turnBy(authoredRef(3), Math.PI / 4);
    const [, , , value] = vi.mocked(SceneCommands.setFieldValue).mock.calls[0];
    const back = quatToEuler(value as { x: number; y: number; z: number; w: number });
    expect(back[0]).toBeCloseTo(30, 2);
    expect(back[1]).toBeCloseTo(-45, 2);
    expect(back[2]).toBeCloseTo(55, 2);
  });

  it('multiplies a resize rather than replacing it', () => {
    vi.spyOn(SceneQuery, 'getFieldValue').mockReturnValue({ x: 2, y: 3, z: 1 } as never);
    EntityOps.resizeBy(authoredRef(3), { x: 2, y: 0.5 });
    const [, , , value] = vi.mocked(SceneCommands.setFieldValue).mock.calls[0];
    expect(value).toEqual({ x: 4, y: 1.5, z: 1 });
  });

  it('sends a relative delta to the realm, never a projected point', () => {
    playingWith([{ live: 900, src: 3 }]);
    EntityOps.turnBy(authoredRef(3), 0.25);
    EntityOps.resizeBy(authoredRef(3), { x: 1.1, y: 1.1 });
    // A delta needs no camera, which is why these two ops have no canvas point.
    expect(PlayRealm.transformBy).toHaveBeenCalledWith(900, { rotateBy: 0.25 });
    expect(PlayRealm.transformBy).toHaveBeenCalledWith(900, { scaleBy: { x: 1.1, y: 1.1 } });
  });

  it('does nothing at all for a zero delta', () => {
    playingWith([{ live: 900, src: 3 }]);
    EntityOps.turnBy(authoredRef(3), 0);
    EntityOps.resizeBy(authoredRef(3), { x: 1, y: 1 });
    expect(PlayRealm.transformBy).not.toHaveBeenCalled();
  });
});
