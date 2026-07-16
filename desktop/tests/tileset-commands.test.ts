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

  it('paintCollision carries the brush modifiers (one-way / sensor / material)', () => {
    TilesetCommands.paintCollision([5], true, { oneWay: { nx: 0, ny: 1 }, sensor: true, friction: 0.1 });
    expect(tiles()[5].collision).toEqual({ type: 'box', oneWay: { nx: 0, ny: 1 }, sensor: true, friction: 0.1 });
  });

  it('a plain box carries no modifier keys', () => {
    TilesetCommands.paintCollision([5], true, {});
    expect(tiles()[5].collision).toEqual({ type: 'box' });
  });

  it('setTileCircle stores a circle (with modifiers) and clears on r ≤ 0', () => {
    TilesetCommands.setTileCircle(5, 8, 8, 6, { oneWay: { nx: 0, ny: 1 } });
    expect(tiles()[5].collision).toEqual({ type: 'circle', cx: 8, cy: 8, r: 6, oneWay: { nx: 0, ny: 1 } });
    TilesetCommands.setTileCircle(5, 0, 0, 0);
    expect(tiles()[5]).toBeUndefined(); // pruned
  });

  it('setTilePolygon carries modifiers on the polygon shape', () => {
    TilesetCommands.setTilePolygon(5, [[0, 16], [16, 16], [16, 0]], { sensor: true });
    expect(tiles()[5].collision).toEqual({ type: 'polygon', points: [[0, 16], [16, 16], [16, 0]], sensor: true });
  });
});

describe('TilesetCommands — stamps + properties', () => {
  beforeEach(() => {
    EditorHistory.clear();
    TilesetDocument.open(freshTileset(), 'a.estileset');
  });

  it('stampPolygons stamps one polygon across many tiles as one undo step', () => {
    const ramp: [number, number][] = [[0, 16], [16, 16], [16, 0]];
    TilesetCommands.stampPolygons([2, 3, 4], ramp, { oneWay: { nx: 0, ny: 1 } });
    expect(tiles()[3].collision).toEqual({ type: 'polygon', points: ramp, oneWay: { nx: 0, ny: 1 } });
    // Points are copied, not aliased, across tiles.
    expect((tiles()[2].collision as { points: unknown }).points).not.toBe((tiles()[3].collision as { points: unknown }).points);
    EditorHistory.undo();
    expect(Object.keys(tiles())).toEqual([]);
  });

  it('stampCircles paints fitted discs and clears them (on=false) as one step each', () => {
    TilesetCommands.stampCircles([1, 2], true, 8, 8, 8);
    expect(tiles()[1].collision).toEqual({ type: 'circle', cx: 8, cy: 8, r: 8 });
    TilesetCommands.stampCircles([1, 2], false, 8, 8, 8);
    expect(Object.keys(tiles())).toEqual([]);
    EditorHistory.undo();
    expect(tiles()[2].collision).toEqual({ type: 'circle', cx: 8, cy: 8, r: 8 });
  });

  it('setTileProperties round-trips, drops blank keys, and clears on empty', () => {
    TilesetCommands.setTileProperties(7, { kind: 'spike', '  ': 'ignored' });
    expect(tiles()[7].properties).toEqual({ kind: 'spike' });
    TilesetCommands.setTileProperties(7, {});
    expect(tiles()[7]).toBeUndefined();
    EditorHistory.undo();
    expect(tiles()[7].properties).toEqual({ kind: 'spike' });
  });
});
