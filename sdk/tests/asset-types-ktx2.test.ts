// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { getAssetTypeEntry, getAddressableType, getEditorType, getAssetMimeType, isKnownAssetExtension } from '../src/assetTypes';

describe('.ktx2 asset type registration', () => {
    it('is a known, binary texture asset', () => {
        expect(isKnownAssetExtension('ktx2')).toBe(true);
        const entry = getAssetTypeEntry('player.ktx2');
        expect(entry?.contentType).toBe('binary');
        expect(entry?.editorType).toBe('texture');
        expect(entry?.addressableType).toBe('texture');
        // large compressed textures stay out of the WeChat main package
        expect(entry?.wechatPackInclude).toBe(false);
    });

    it('resolves texture types and the KTX2 mime', () => {
        expect(getEditorType('a/b/player.ktx2')).toBe('texture');
        expect(getAddressableType('player.ktx2')).toBe('texture');
        expect(getAssetMimeType('ktx2')).toBe('image/ktx2');
    });
});
