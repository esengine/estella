// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project Settings > Rendering > Skinning: the bones one draw carries for every platform and per platform (a
 *        platform's own value over its group's), the influence limit, and what persists.
 */
import { describe, it, expect } from 'vitest';
import { maxBonesFor, parseSkinningConfig } from '../src/project/skinning';
import { parseManifest } from '../src/project/format';

describe('skinning settings', () => {
    it('defaults to 256 bones a draw everywhere and persists nothing', () => {
        expect(parseSkinningConfig({ maxBonesPerSection: 256 })).toEqual({});
        expect(maxBonesFor(undefined, 'android')).toBe(256);
    });

    it('a platform takes its own budget, else its group, else every platform', () => {
        const config = parseSkinningConfig({ maxBonesPerSection: 200, platformMaxBones: { mobile: 75, ios: 120, desktop: 256 } });
        expect(maxBonesFor(config)).toBe(200);
        expect(maxBonesFor(config, 'web')).toBe(200);
        expect(maxBonesFor(config, 'android')).toBe(75);
        expect(maxBonesFor(config, 'wechat')).toBe(75);
        expect(maxBonesFor(config, 'ios')).toBe(120);
        expect(maxBonesFor(config, 'desktop')).toBe(256);
    });

    it('clamps a budget to what one draw can carry and to what one triangle needs', () => {
        const config = parseSkinningConfig({ maxBonesPerSection: 65536, platformMaxBones: { android: 4 } });
        expect(maxBonesFor(config)).toBe(256);
        expect(maxBonesFor(config, 'android')).toBe(12);
    });

    it('keeps an influence limit of 1 to 3 and the weight precision, through the manifest', () => {
        const manifest = parseManifest({ name: 'p', features: { rendering: { skinning: { boneInfluenceLimit: 2, highPrecisionWeights: true } } } });
        expect(manifest.features?.rendering?.skinning).toEqual({ boneInfluenceLimit: 2, highPrecisionWeights: true });
        expect(parseSkinningConfig({ boneInfluenceLimit: 4 })).toEqual({});
    });
});
