// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Phase 2 of unified collision: per-tile circle / one-way / sensor / material on the
 * `.estileset`, and the resolve-time split between the plain-box merge set and the
 * per-tile rich-shape bucket. Legacy files must round-trip byte-for-byte.
 */
import { describe, it, expect } from 'vitest';
import { parseTileset, serializeTileset, type TilesetAsset } from '../src/tilemap/tilesetAsset';
import { resolveTilesetModel, type ResolvedTileset } from '../src/tilemap/tilesetResolve';

/** Round-trip a single tile's raw collision through parse+serialize. */
function roundTripCollision(rawCollision: unknown): unknown {
    const parsed = parseTileset({ texture: 't', tileWidth: 16, tileHeight: 16, columns: 4, tiles: { 1: { collision: rawCollision } } });
    const out = serializeTileset(parsed) as { tiles: Record<string, { collision?: unknown }> };
    return out.tiles['1']?.collision;
}

describe('tile collision schema — back-compat', () => {
    it('legacy {type:box} round-trips byte-identically (no new keys)', () => {
        expect(roundTripCollision({ type: 'box' })).toEqual({ type: 'box' });
    });
    it('legacy boolean true → {type:box}', () => {
        expect(roundTripCollision(true)).toEqual({ type: 'box' });
    });
    it('polygon round-trips with only its points (no modifier keys)', () => {
        const poly = { type: 'polygon', points: [[0, 16], [16, 16], [16, 0]] };
        expect(roundTripCollision(poly)).toEqual(poly);
    });
    it('a bare box never gains one-way/sensor/material keys', () => {
        const rt = roundTripCollision({ type: 'box' }) as Record<string, unknown>;
        expect(Object.keys(rt)).toEqual(['type']);
    });
});

describe('tile collision schema — new shapes + modifiers', () => {
    it('circle parses with centre + radius', () => {
        expect(roundTripCollision({ type: 'circle', cx: 8, cy: 8, r: 6 }))
            .toEqual({ type: 'circle', cx: 8, cy: 8, r: 6 });
    });
    it('circle without a positive radius falls back to a box', () => {
        expect(roundTripCollision({ type: 'circle', cx: 8, cy: 8, r: 0 })).toEqual({ type: 'box' });
    });
    it('oneWay:true becomes the solid-top unit normal', () => {
        expect(roundTripCollision({ type: 'box', oneWay: true }))
            .toEqual({ type: 'box', oneWay: { nx: 0, ny: 1 } });
    });
    it('oneWay {nx,ny} is normalized to a unit vector', () => {
        const rt = roundTripCollision({ type: 'box', oneWay: { nx: 3, ny: 4 } }) as { oneWay: { nx: number; ny: number } };
        expect(rt.oneWay.nx).toBeCloseTo(0.6, 6);
        expect(rt.oneWay.ny).toBeCloseTo(0.8, 6);
    });
    it('sensor + material overrides carry through', () => {
        expect(roundTripCollision({ type: 'box', sensor: true, friction: 0.1, restitution: 0.9, density: 2 }))
            .toEqual({ type: 'box', sensor: true, friction: 0.1, restitution: 0.9, density: 2 });
    });
    it('a polygon can carry modifiers too', () => {
        const rt = roundTripCollision({ type: 'polygon', points: [[0, 16], [16, 16], [16, 0]], oneWay: true }) as Record<string, unknown>;
        expect(rt).toEqual({ type: 'polygon', points: [[0, 16], [16, 16], [16, 0]], oneWay: { nx: 0, ny: 1 } });
    });
});

describe('resolveTilesetModel — merge fast-path vs per-tile bucket', () => {
    const asset: TilesetAsset = parseTileset({
        texture: 't', tileWidth: 16, tileHeight: 16, columns: 4, tileCount: 4,
        tiles: {
            1: { collision: { type: 'box' } },                                   // plain box → merge
            2: { collision: { type: 'box', oneWay: true } },                     // box + modifier → per-tile
            3: { collision: { type: 'circle', cx: 8, cy: 8, r: 8 } },            // circle → per-tile
            4: { collision: { type: 'polygon', points: [[0, 16], [16, 16], [16, 0]] } }, // polygon → per-tile
        },
    });

    it('only the plain box lands in the greedy-merge set', () => {
        const model = resolveTilesetModel([{ asset, textureHandle: 1 }]);
        expect(model.collidableTileIds).toEqual([1]);
        expect([...model.tileShapes.keys()].sort()).toEqual([2, 3, 4]);
    });

    it('modifier-bearing box, circle, and polygon are resolved into normalized shapes', () => {
        const model = resolveTilesetModel([{ asset, textureHandle: 1 }]);
        expect(model.tileShapes.get(2)!.shape.type).toBe('box');
        expect(model.tileShapes.get(2)!.oneWay).toEqual({ nx: 0, ny: 1 });
        const circle = model.tileShapes.get(3)!.shape as { type: 'circle'; cx: number; cy: number; r: number };
        expect(circle).toEqual({ type: 'circle', cx: 0.5, cy: 0.5, r: 0.5 }); // 8/16, 8/16, 8/16
        const poly = model.tileShapes.get(4)!.shape as { type: 'polygon'; points: [number, number][] };
        expect(poly.points).toEqual([[0, 1], [1, 1], [1, 0]]); // normalized by tileW/H
    });

    it('re-keys shapes into the global id space across tilesets', () => {
        const model = resolveTilesetModel([
            { asset, textureHandle: 1 },
            { asset, textureHandle: 2 },
        ]);
        // Second tileset starts at firstId 5 (first spans 4 tiles), so its tiles are 5..8.
        expect(model.collidableTileIds).toEqual([1, 5]);
        expect([...model.tileShapes.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4, 6, 7, 8]);
    });
});
