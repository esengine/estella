// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    getAssetTypeEntry, getEditorType, isKnownAssetExtension,
    getCustomExtensions, isCustomExtension,
} from '../src/assetTypes';

describe('.estileset asset type registration', () => {
    it('is a known JSON tileset asset', () => {
        expect(isKnownAssetExtension('estileset')).toBe(true);
        const entry = getAssetTypeEntry('terrain.estileset');
        expect(entry?.contentType).toBe('json');
        expect(entry?.editorType).toBe('tileset');
    });

    it('resolves its editor type', () => {
        expect(getEditorType('a/b/terrain.estileset')).toBe('tileset');
    });

    it('is on the WeChat pack whitelist (fs-read at runtime by TilesetAssetLoader)', () => {
        // A packaged mini-game reads the .estileset via readFileSync; an
        // extension not on the pack whitelist is denied there.
        expect(getCustomExtensions()).toContain('.estileset');
        expect(isCustomExtension('terrain.estileset')).toBe(true);
    });
});
