// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// DragonBones tells its two halves apart by name, not by extension: `_ske.json`
// beside `_tex.json`. So the type table had to learn suffixes, and a suffix has to
// beat an extension — otherwise the day something claims `.json`, every skeleton
// in every project silently becomes that instead.
import { describe, it, expect } from 'vitest';
import { assetTypeOf, ASSET_TYPES, assetTypeRegistry } from '@/project/assetTypes';

describe('assetTypeOf — suffixes', () => {
    it('reads both halves of a DragonBones asset as one type', () => {
        // One type, as Spine's .skel and .atlas are one: which file plays which
        // role is the component's business, not the content browser's.
        expect(assetTypeOf('DragonBoy_ske.json')).toBe('dragonbones');
        expect(assetTypeOf('DragonBoy_tex.json')).toBe('dragonbones');
        expect(assetTypeOf('DragonBoy.dbbin')).toBe('dragonbones');
    });

    it('is case-insensitive, because a file name on two of three platforms is', () => {
        expect(assetTypeOf('Mecha_SKE.JSON')).toBe('dragonbones');
    });

    it('leaves an ordinary json alone', () => {
        expect(assetTypeOf('package.json')).toBe('file');
        expect(assetTypeOf('skeleton.json')).toBe('file');
    });

    it('does not mistake a name that merely contains the suffix', () => {
        // The claim is on the END of the name; `_ske.json.bak` is a backup.
        expect(assetTypeOf('DragonBoy_ske.json.bak')).toBe('file');
    });

    it('leaves every other type resolving exactly as before', () => {
        expect(assetTypeOf('hero.png')).toBe('texture');
        expect(assetTypeOf('level.esscene')).toBe('scene');
        expect(assetTypeOf('hero.skel')).toBe('spine');
        expect(assetTypeOf('hero.atlas')).toBe('spine');
        expect(assetTypeOf('main.ts')).toBe('script');
    });

    it('lets a contributed type claim a suffix too', () => {
        const disposable = assetTypeRegistry.register('test-owner', {
            id: 'testcfg',
            suffixes: ['.config.yaml'],
            badge: 'CFG',
            icon: ASSET_TYPES.file.icon,
            tint: '#888888',
        });
        expect(assetTypeOf('build.config.yaml')).toBe('testcfg');
        disposable.dispose();
        expect(assetTypeOf('build.config.yaml')).toBe('file');
    });
});
