// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    TILESET_FORMAT_VERSION,
    parseTileset,
    serializeTileset,
    createTileset,
    collidableTileIds,
    type TilesetAsset,
} from '../src/tilemap/tilesetAsset';

describe('tilesetAsset (.estileset format)', () => {
    describe('createTileset', () => {
        it('makes a fresh tileset with defaults and no tiles', () => {
            const ts = createTileset('@uuid:abc', 16, 16, 8);
            expect(ts).toEqual({
                version: TILESET_FORMAT_VERSION,
                texture: '@uuid:abc',
                tileWidth: 16, tileHeight: 16, columns: 8,
                margin: 0, spacing: 0, tiles: {},
            });
        });
    });

    describe('parseTileset', () => {
        it('fills sane defaults from an empty object', () => {
            const ts = parseTileset({});
            expect(ts.version).toBe(TILESET_FORMAT_VERSION);
            expect(ts.texture).toBe('');
            expect(ts.tileWidth).toBe(16);
            expect(ts.columns).toBe(1);
            expect(ts.tiles).toEqual({});
        });

        it('keeps a box collision and normalizes a legacy truthy collision to a box', () => {
            const ts = parseTileset({
                texture: '@uuid:x', tileWidth: 32, tileHeight: 32, columns: 4,
                tiles: { 5: { collision: { type: 'box' } }, 7: { collision: true } },
            });
            expect(ts.tiles[5].collision).toEqual({ type: 'box' });
            expect(ts.tiles[7].collision).toEqual({ type: 'box' });
        });

        it('keeps a valid polygon and drops a degenerate (<3 point) one', () => {
            const ts = parseTileset({
                tiles: {
                    9: { collision: { type: 'polygon', points: [[0, 0], [16, 0], [16, 8]] } },
                    10: { collision: { type: 'polygon', points: [[0, 0], [1, 1]] } },
                },
            });
            expect(ts.tiles[9].collision).toEqual({ type: 'polygon', points: [[0, 0], [16, 0], [16, 8]] });
            expect(ts.tiles[10]).toBeUndefined(); // degenerate polygon → no collision → empty tile dropped
        });

        it('drops empty tile entries and non-positive ids', () => {
            const ts = parseTileset({
                tiles: { 0: { collision: { type: 'box' } }, 3: {}, 4: { properties: { a: 'b' } } },
            });
            expect(ts.tiles[0]).toBeUndefined(); // id 0 = empty, never carries metadata
            expect(ts.tiles[3]).toBeUndefined(); // no metadata → dropped
            expect(ts.tiles[4]).toEqual({ properties: { a: 'b' } });
        });

        it('normalizes animation frames and coerces property values to strings', () => {
            const ts = parseTileset({
                tiles: {
                    2: {
                        animation: [{ tile: 2, durationMs: 100 }, { tile: 3 }, { foo: 1 }],
                        properties: { hp: 5 },
                    },
                },
            });
            expect(ts.tiles[2].animation).toEqual([
                { tile: 2, durationMs: 100 },
                { tile: 3, durationMs: 100 },
            ]);
            expect(ts.tiles[2].properties).toEqual({ hp: '5' });
        });
    });

    describe('round-trip', () => {
        it('parse(serialize(x)) is identity over a rich tileset', () => {
            const original: TilesetAsset = {
                version: '1', texture: '@uuid:t', tileWidth: 16, tileHeight: 16,
                columns: 8, margin: 1, spacing: 2, tileCount: 64,
                tiles: {
                    5: { collision: { type: 'box' } },
                    12: { collision: { type: 'polygon', points: [[0, 0], [16, 0], [16, 16]] }, properties: { kind: 'slope' } },
                    20: { animation: [{ tile: 20, durationMs: 80 }, { tile: 21, durationMs: 80 }] },
                },
            };
            expect(parseTileset(serializeTileset(original))).toEqual(original);
        });
    });

    describe('collidableTileIds', () => {
        it('returns sorted ids of box and polygon tiles, excluding non-collision', () => {
            const ts = parseTileset({
                tiles: {
                    20: { collision: { type: 'box' } },
                    5: { collision: { type: 'polygon', points: [[0, 0], [1, 0], [1, 1]] } },
                    8: { properties: { a: 'b' } }, // not collidable
                },
            });
            expect(collidableTileIds(ts)).toEqual([5, 20]);
        });
    });
});
