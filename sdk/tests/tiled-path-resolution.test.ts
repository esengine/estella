// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// How a Tiled document's refs resolve. Two kinds reach the loader and they must not
// be treated the same:
//
//   document-relative   "../textures/tileset.png"     — what Tiled authors
//   logical project     "assets/textures/tileset.png" — what the COOK rewrites them to
//
// A cooked payload has no directory structure left, so the cook makes the refs
// logical. Joining one against the map's own path doubles the prefix — which stayed
// invisible while cooked maps were only ever loaded by `@uuid` (a base with no
// directory, so the join was a no-op) and appeared the moment a native app loaded
// the same map by its cooked FILE path: every tile went invisible on the device with
// "assets/assets/textures/tileset.png" not found.
import { describe, it, expect } from 'vitest';
import { resolveRelativePath, resolveTiledRef, isLogicalAssetRef } from '../src/tilemap/tiledPath';

describe('isLogicalAssetRef', () => {
    it('recognizes the shape the cook emits', () => {
        expect(isLogicalAssetRef('assets/textures/tileset.png')).toBe(true);
        expect(isLogicalAssetRef('/scenes/level.tmj')).toBe(true);
    });

    it('leaves an authored document-relative ref alone', () => {
        expect(isLogicalAssetRef('../textures/tileset.png')).toBe(false);
        expect(isLogicalAssetRef('./tiles.png')).toBe(false);
        expect(isLogicalAssetRef('tiles.png')).toBe(false);
    });
});

describe('resolveTiledRef', () => {
    it('joins an authored ref against the map that carries it', () => {
        expect(resolveTiledRef('assets/maps/level.tmj', '../textures/tileset.png'))
            .toBe('assets/textures/tileset.png');
    });

    it('passes a cooked logical ref through — whatever the map path looks like', () => {
        // The three ways one map gets addressed: by uuid (playable/web), by its
        // content-addressed cooked file (a native app), and in the editor.
        for (const mapPath of ['@uuid:1111', 'assets/d553da0f64d68b5d.tmj', 'assets/maps/level.tmj']) {
            expect(resolveTiledRef(mapPath, 'assets/textures/tileset.png'))
                .toBe('assets/textures/tileset.png');
        }
    });

    it('is what the uuid path did by accident, now on purpose', () => {
        // The old behaviour, kept for the case it was right about.
        expect(resolveRelativePath('@uuid:1111', 'assets/textures/tileset.png'))
            .toBe('assets/textures/tileset.png');
        // …and the case it got wrong.
        expect(resolveRelativePath('assets/level.tmj', 'assets/textures/tileset.png'))
            .toBe('assets/assets/textures/tileset.png');
        expect(resolveTiledRef('assets/level.tmj', 'assets/textures/tileset.png'))
            .toBe('assets/textures/tileset.png');
    });

    it('keeps a URL base intact', () => {
        expect(resolveTiledRef('estella://project/assets/maps/level.tmj', '../textures/t.png'))
            .toBe('estella://project/assets/textures/t.png');
    });
});
