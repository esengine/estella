// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The classification the cook reads. Getting it wrong is not a crash: the export
// builds, ships the atlas, and 404s the texture it points at on a device — which
// is why the transitive-deps flag is asserted rather than assumed.
import { describe, it, expect } from 'vitest';
import { getAssetTypeEntry, getEditorType, getAddressableType } from '../src/assetTypes';

describe('DragonBones asset classification', () => {
    it('tells the two halves apart, which the extension cannot', () => {
        expect(getEditorType('hero_ske.json')).toBe('dragonbones-skeleton');
        expect(getEditorType('hero_tex.json')).toBe('dragonbones-atlas');
        expect(getEditorType('hero.dbbin')).toBe('dragonbones-skeleton');
    });

    it('is case-insensitive, and only claims the END of a name', () => {
        expect(getEditorType('Hero_SKE.JSON')).toBe('dragonbones-skeleton');
        // A backup is not a skeleton.
        expect(getEditorType('hero_ske.json.bak')).not.toBe('dragonbones-skeleton');
    });

    it('leaves an ordinary json alone', () => {
        expect(getEditorType('package.json')).not.toBe('dragonbones-skeleton');
        expect(getEditorType('package.json')).not.toBe('dragonbones-atlas');
    });

    it('marks the atlas as carrying transitive deps, and the skeleton as not', () => {
        // The atlas's `imagePath` names a PNG nothing else in the project points
        // at. Without this flag the dependency scan skips the file, the cook culls
        // the image, and the shipped build asks for a texture that is not there.
        expect(getAssetTypeEntry('hero_tex.json')?.hasTransitiveDeps).toBe(true);
        expect(getAssetTypeEntry('hero_ske.json')?.hasTransitiveDeps).toBe(false);
    });

    it('ships both halves inside a WeChat package', () => {
        // Neither is huge, and a skeleton fetched remotely while its atlas is local
        // is the kind of split that only fails on a phone.
        expect(getAssetTypeEntry('hero_ske.json')?.wechatPackInclude).toBe(true);
        expect(getAssetTypeEntry('hero_tex.json')?.wechatPackInclude).toBe(true);
    });

    it('leaves Spine classifying exactly as before', () => {
        expect(getEditorType('hero.atlas')).toBe('spine-atlas');
        expect(getEditorType('hero.skel')).toBe('spine-skeleton');
        expect(getAddressableType('hero.skel')).toBe('spine');
        expect(getEditorType('hero.png')).toBe('texture');
    });
});
