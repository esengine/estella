// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  SceneCommands.paintTiles (REARCH_TILEMAP T3a) — model-authoritative tile
 *        painting: edits apply live to the C++ tilemap AND commit the chunk blob into
 *        the model, so undo/redo restore both. TilemapAPI is spied (the C++ chunk store
 *        needs an initialized GL layer, out of scope for a node unit test); the model +
 *        undo plumbing is real.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TilemapAPI } from 'esengine';
import type { SceneData } from 'esengine';
import { SceneModelImpl } from '@/engine/SceneModel';
import { EditorHistoryImpl } from '@/engine/EditorHistory';
import { SceneCommandsImpl } from '@/engine/SceneCommands';

function tilemapScene(): SceneData {
  return {
    version: '1.0',
    name: 't',
    entities: [
      {
        id: 1,
        name: 'Map',
        parent: null,
        children: [],
        components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
          { type: 'TilemapLayer', data: { cellSize: { x: 16, y: 16 }, tileset: 0 } },
        ],
      },
    ],
  } as unknown as SceneData;
}

const chunksOf = (model: SceneModelImpl): unknown =>
  (model.entityBySource(1)!.components.find((c) => c.type === 'TilemapLayer')!.data as Record<string, unknown>).chunks;

describe('SceneCommands.paintTiles', () => {
  let model: SceneModelImpl;
  let history: EditorHistoryImpl;
  let cmds: SceneCommandsImpl;

  beforeEach(() => {
    model = new SceneModelImpl();
    history = new EditorHistoryImpl();
    cmds = new SceneCommandsImpl(model, history);
    model.adopt(tilemapScene(), new Map([[1, 100]])); // source 1 → runtime 100
  });
  afterEach(() => vi.restoreAllMocks());

  it('applies edits live to C++ and commits the chunk blob to the model, undoably', () => {
    const setTile = vi.spyOn(TilemapAPI, 'setTile').mockImplementation(() => {});
    const importChunks = vi.spyOn(TilemapAPI, 'importChunks').mockReturnValue(true);
    vi.spyOn(TilemapAPI, 'exportChunks').mockReturnValueOnce('BEFORE').mockReturnValueOnce('AFTER');

    cmds.paintTiles(1, [{ x: 2, y: 3, tileId: 5 }, { x: 2, y: 4, tileId: 5 }]);

    expect(setTile).toHaveBeenNthCalledWith(1, 100, 2, 3, 5);
    expect(setTile).toHaveBeenNthCalledWith(2, 100, 2, 4, 5);
    expect(chunksOf(model)).toBe('AFTER');

    history.undo();
    expect(importChunks).toHaveBeenLastCalledWith(100, 'BEFORE');
    expect(chunksOf(model)).toBe('BEFORE');

    history.redo();
    expect(importChunks).toHaveBeenLastCalledWith(100, 'AFTER');
    expect(chunksOf(model)).toBe('AFTER');
  });

  it('is a no-op when the entity has no runtime binding', () => {
    const setTile = vi.spyOn(TilemapAPI, 'setTile');
    const m2 = new SceneModelImpl();
    const c2 = new SceneCommandsImpl(m2, new EditorHistoryImpl());
    m2.adopt(tilemapScene(), new Map()); // no runtime
    c2.paintTiles(1, [{ x: 0, y: 0, tileId: 1 }]);
    expect(setTile).not.toHaveBeenCalled();
  });

  it('records no undo step when the blob is unchanged', () => {
    vi.spyOn(TilemapAPI, 'setTile').mockImplementation(() => {});
    vi.spyOn(TilemapAPI, 'exportChunks').mockReturnValue('SAME'); // before === after
    cmds.paintTiles(1, [{ x: 0, y: 0, tileId: 1 }]);
    expect(history.canUndo()).toBe(false);
  });

  it('begin/live/end paints a stroke live and commits one undo step', () => {
    const setTile = vi.spyOn(TilemapAPI, 'setTile').mockImplementation(() => {});
    const importChunks = vi.spyOn(TilemapAPI, 'importChunks').mockReturnValue(true);
    vi.spyOn(TilemapAPI, 'exportChunks')
      .mockReturnValueOnce('B0') // begin snapshot
      .mockReturnValueOnce('B1'); // end → commit after-snapshot
    cmds.beginTilePaint(1);
    cmds.paintTileLive(1, 0, 0, 7);
    cmds.paintTileLive(1, 1, 0, 7);
    cmds.endTilePaint();
    expect(setTile).toHaveBeenCalledTimes(2);
    expect(chunksOf(model)).toBe('B1');
    history.undo();
    expect(importChunks).toHaveBeenLastCalledWith(100, 'B0');
    expect(chunksOf(model)).toBe('B0');
  });
});
