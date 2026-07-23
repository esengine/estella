// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    resolveAssetGroup,
    activeRemoteRoot,
    modeToDelivery,
    type AssetGroupsConfig,
} from '../src/asset/assetGroups';

describe('modeToDelivery', () => {
    it('maps subpackage → lazy, others to themselves', () => {
        expect(modeToDelivery('subpackage')).toBe('lazy');
        expect(modeToDelivery('remote')).toBe('remote');
        expect(modeToDelivery('local')).toBe('local');
    });
});

describe('resolveAssetGroup — explicit config decouples delivery from folder name', () => {
    const config: AssetGroupsConfig = {
        version: '1.0',
        groups: {
            dlc: { folder: 'assets/dlc', mode: 'remote' },
            level2: { folder: 'assets/level2', mode: 'subpackage' },
            hd: { folder: 'assets/dlc/hd', mode: 'subpackage' }, // nested, longer prefix
        },
    };

    it('assigns an ordinarily-named folder to a remote group', () => {
        expect(resolveAssetGroup('assets/dlc/boss.png', config)).toEqual({ name: 'dlc', delivery: 'remote' });
    });

    it('maps a subpackage-mode group to lazy delivery', () => {
        expect(resolveAssetGroup('assets/level2/map.png', config)).toEqual({ name: 'level2', delivery: 'lazy' });
    });

    it('longest folder prefix wins for nested groups', () => {
        expect(resolveAssetGroup('assets/dlc/hd/boss@2x.png', config)).toEqual({ name: 'hd', delivery: 'lazy' });
        expect(resolveAssetGroup('assets/dlc/boss.png', config)).toEqual({ name: 'dlc', delivery: 'remote' });
    });

    it('unconfigured paths fall through to main/local', () => {
        expect(resolveAssetGroup('assets/hero.png', config)).toEqual({ name: 'main', delivery: 'local' });
    });

    it('normalizes backslashes and a trailing folder slash', () => {
        const cfg: AssetGroupsConfig = { version: '1.0', groups: { g: { folder: 'assets/g/', mode: 'remote' } } };
        expect(resolveAssetGroup('assets\\g\\a.png', cfg)).toEqual({ name: 'g', delivery: 'remote' });
    });
});

describe('resolveAssetGroup — legacy folder-name convention (fallback / back-compat)', () => {
    it('still honors subpackages/<name>/ and remote/<name>/ with no config', () => {
        expect(resolveAssetGroup('subpackages/level1/a.png', null)).toEqual({ name: 'level1', delivery: 'lazy' });
        expect(resolveAssetGroup('remote/cdn/a.png', null)).toEqual({ name: 'cdn', delivery: 'remote' });
        expect(resolveAssetGroup('assets/a.png', null)).toEqual({ name: 'main', delivery: 'local' });
    });

    it('explicit config takes priority over the folder-name convention', () => {
        const cfg: AssetGroupsConfig = { version: '1.0', groups: { pack: { folder: 'remote/cdn', mode: 'subpackage' } } };
        // The path is under remote/cdn/, but the config re-declares it a subpackage.
        expect(resolveAssetGroup('remote/cdn/a.png', cfg)).toEqual({ name: 'pack', delivery: 'lazy' });
    });
});

describe('activeRemoteRoot', () => {
    const config: AssetGroupsConfig = {
        version: '1.0',
        activeProfile: 'dev',
        profiles: {
            dev: { remoteRoot: 'http://localhost:8080/' },
            prod: { remoteRoot: 'https://cdn.mygame.com' },
        },
    };

    it('returns the active profile CDN root, trailing slash trimmed', () => {
        expect(activeRemoteRoot(config)).toBe('http://localhost:8080');
    });

    it('follows activeProfile when switched', () => {
        expect(activeRemoteRoot({ ...config, activeProfile: 'prod' })).toBe('https://cdn.mygame.com');
    });

    it('undefined when no active profile / no root / no config', () => {
        expect(activeRemoteRoot(null)).toBeUndefined();
        expect(activeRemoteRoot({ version: '1.0' })).toBeUndefined();
        expect(activeRemoteRoot({ version: '1.0', activeProfile: 'x', profiles: { x: {} } })).toBeUndefined();
        expect(activeRemoteRoot({ version: '1.0', activeProfile: 'missing', profiles: { dev: { remoteRoot: 'u' } } })).toBeUndefined();
    });
});
