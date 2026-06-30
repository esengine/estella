// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    ManifestModel,
    normalizeBundleMode,
    type AddressableManifest,
} from '../src/asset/AddressableManifest';

function manifest(): AddressableManifest {
    return {
        version: '2.0',
        groups: {
            main: {
                bundleMode: 'local',
                labels: [],
                assets: {
                    'a.png': { path: 'a.png', type: 'texture', size: 1, labels: ['ui'] },
                    'b.mat': { path: 'b.mat', type: 'material', size: 2, labels: ['ui', 'fx'] },
                },
            },
            level1: {
                bundleMode: 'lazy',
                labels: [],
                assets: {
                    'c.png': { path: 'c.png', address: '@c', type: 'texture', size: 3, labels: ['fx'] },
                },
            },
            cdn: {
                bundleMode: 'remote',
                labels: [],
                assets: {},
            },
        },
    };
}

describe('normalizeBundleMode', () => {
    it('passes through known modes', () => {
        expect(normalizeBundleMode('local')).toBe('local');
        expect(normalizeBundleMode('lazy')).toBe('lazy');
        expect(normalizeBundleMode('remote')).toBe('remote');
    });

    it('maps unknown / missing to local (safe default)', () => {
        expect(normalizeBundleMode('garbage')).toBe('local');
        expect(normalizeBundleMode('')).toBe('local');
        expect(normalizeBundleMode(undefined)).toBe('local');
        expect(normalizeBundleMode(null)).toBe('local');
    });
});

describe('ManifestModel', () => {
    const model = () => ManifestModel.fromJson(manifest());

    it('lists group names in manifest order', () => {
        expect(model().groupNames()).toEqual(['main', 'level1', 'cdn']);
    });

    it('returns typed bundle modes (unknown group → local)', () => {
        const m = model();
        expect(m.bundleMode('main')).toBe('local');
        expect(m.bundleMode('level1')).toBe('lazy');
        expect(m.bundleMode('cdn')).toBe('remote');
        expect(m.bundleMode('does-not-exist')).toBe('local');
    });

    it('filters groups by mode', () => {
        expect(model().groupsByMode('lazy')).toEqual(['level1']);
        expect(model().groupsByMode('local')).toEqual(['main']);
        expect(model().groupsByMode('remote')).toEqual(['cdn']);
    });

    it('lists assets and paths in a group', () => {
        expect(model().assetPathsInGroup('main')).toEqual(['a.png', 'b.mat']);
        expect(model().assetsInGroup('level1')).toHaveLength(1);
        expect(model().assetsInGroup('missing')).toEqual([]);
    });

    it('collects all assets across groups', () => {
        expect(model().allAssets()).toHaveLength(3);
    });

    it('finds assets by label, deduped, across groups', () => {
        const ui = model().assetsByLabel('ui').map(a => a.path);
        expect(ui).toEqual(['a.png', 'b.mat']);
        const fx = model().assetsByLabel('fx').map(a => a.path);
        expect(fx).toEqual(['b.mat', 'c.png']);
    });

    it('finds an asset by path or address', () => {
        expect(model().findAsset('a.png')?.path).toBe('a.png');
        expect(model().findAsset('@c')?.path).toBe('c.png');
        expect(model().findAsset('nope')).toBeNull();
    });

    it('empty() has no groups', () => {
        expect(ManifestModel.empty().groupNames()).toEqual([]);
        expect(ManifestModel.empty().allAssets()).toEqual([]);
    });
});
