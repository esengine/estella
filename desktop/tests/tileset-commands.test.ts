// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import type { TilesetAsset } from 'esengine';
import { TilesetDocument } from '@/tileset/TilesetDocument';
import { TilesetCommands } from '@/tileset/TilesetCommands';
import { EditorHistory } from '@/engine/EditorHistory';

function freshTileset(): TilesetAsset {
  return {
    version: '1', texture: '@uuid:t', tileWidth: 16, tileHeight: 16,
    columns: 4, margin: 0, spacing: 0, tiles: {},
  };
}

const tiles = () => TilesetDocument.asset!.tiles;

describe('TilesetCommands', () => {
  beforeEach(() => {
    EditorHistory.clear();
    TilesetDocument.open(freshTileset(), 'a.estileset');
  });

  it('paintCollision adds box collision and is undoable', () => {
    TilesetCommands.paintCollision([5], true);
    expect(tiles()[5].collision).toEqual({ type: 'box' });
    EditorHistory.undo();
    expect(tiles()[5]).toBeUndefined();
  });

  it('paints a whole stroke as one undo step', () => {
    TilesetCommands.paintCollision([5, 6, 7], true);
    expect(Object.keys(tiles())).toEqual(['5', '6', '7']);
    EditorHistory.undo();
    expect(Object.keys(tiles())).toEqual([]); // one step undid all three
  });

  it('removing collision prunes an otherwise-empty tile but keeps tiles with other metadata', () => {
    TilesetCommands.paintCollision([5, 6], true);
    // Give tile 6 a non-collision property so it must survive collision removal.
    TilesetDocument.replaceAsset({
      ...TilesetDocument.asset!,
      tiles: { ...tiles(), 6: { collision: { type: 'box' }, properties: { kind: 'wall' } } },
    });
    TilesetCommands.paintCollision([5, 6], false);
    expect(tiles()[5]).toBeUndefined();                       // pruned (no metadata left)
    expect(tiles()[6]).toEqual({ properties: { kind: 'wall' } }); // kept (still has properties)
  });

  it('setGrid edits geometry and is undoable', () => {
    TilesetCommands.setGrid({ tileWidth: 32, columns: 8 });
    expect(TilesetDocument.asset!.tileWidth).toBe(32);
    expect(TilesetDocument.asset!.columns).toBe(8);
    EditorHistory.undo();
    expect(TilesetDocument.asset!.tileWidth).toBe(16);
  });
});
