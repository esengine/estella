// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    resolveAssetGroup,
    activeRemoteRoot,
    modeToDelivery,
    folderGroupMode,
    withFolderGroup,
    withActiveRemoteRoot,
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
        expect(resolveAssetGroup('assets/dlc/boss.png', config)).toEqual({ name: 'dlc', delivery: 'remote', alwaysInclude: false });
    });

    it('maps a subpackage-mode group to lazy delivery', () => {
        expect(resolveAssetGroup('assets/level2/map.png', config)).toEqual({ name: 'level2', delivery: 'lazy', alwaysInclude: false });
    });

    it('longest folder prefix wins for nested groups', () => {
        expect(resolveAssetGroup('assets/dlc/hd/boss@2x.png', config)).toEqual({ name: 'hd', delivery: 'lazy', alwaysInclude: false });
        expect(resolveAssetGroup('assets/dlc/boss.png', config)).toEqual({ name: 'dlc', delivery: 'remote', alwaysInclude: false });
    });

    it('unconfigured paths fall through to main/local', () => {
        expect(resolveAssetGroup('assets/hero.png', config)).toEqual({ name: 'main', delivery: 'local', alwaysInclude: false });
    });

    it('normalizes backslashes and a trailing folder slash', () => {
        const cfg: AssetGroupsConfig = { version: '1.0', groups: { g: { folder: 'assets/g/', mode: 'remote' } } };
        expect(resolveAssetGroup('assets\\g\\a.png', cfg)).toEqual({ name: 'g', delivery: 'remote', alwaysInclude: false });
    });
});

describe('resolveAssetGroup — legacy folder-name convention (fallback / back-compat)', () => {
    it('still honors subpackages/<name>/ and remote/<name>/ with no config', () => {
        expect(resolveAssetGroup('subpackages/level1/a.png', null)).toEqual({ name: 'level1', delivery: 'lazy', alwaysInclude: false });
        expect(resolveAssetGroup('remote/cdn/a.png', null)).toEqual({ name: 'cdn', delivery: 'remote', alwaysInclude: false });
        expect(resolveAssetGroup('assets/a.png', null)).toEqual({ name: 'main', delivery: 'local', alwaysInclude: false });
    });

    it('explicit config takes priority over the folder-name convention', () => {
        const cfg: AssetGroupsConfig = { version: '1.0', groups: { pack: { folder: 'remote/cdn', mode: 'subpackage' } } };
        // The path is under remote/cdn/, but the config re-declares it a subpackage.
        expect(resolveAssetGroup('remote/cdn/a.png', cfg)).toEqual({ name: 'pack', delivery: 'lazy', alwaysInclude: false });
    });
});

describe('withFolderGroup / folderGroupMode — the editor authoring mutation', () => {
    it('adds a remote group for an ordinarily-named folder', () => {
        const cfg = withFolderGroup(null, 'assets/cdn', 'remote');
        expect(cfg.groups).toEqual({ cdn: { folder: 'assets/cdn', mode: 'remote' } });
        expect(folderGroupMode(cfg, 'assets/cdn')).toBe('remote');
    });

    it('local removes the folder\'s group', () => {
        const withGroup = withFolderGroup(null, 'assets/cdn', 'subpackage');
        const cleared = withFolderGroup(withGroup, 'assets/cdn', 'local');
        expect(cleared.groups).toEqual({});
        expect(folderGroupMode(cleared, 'assets/cdn')).toBe('local');
    });

    it('re-marking a folder replaces its mode, not duplicates it', () => {
        let cfg = withFolderGroup(null, 'assets/cdn', 'remote');
        cfg = withFolderGroup(cfg, 'assets/cdn', 'subpackage');
        expect(Object.keys(cfg.groups ?? {})).toHaveLength(1);
        expect(folderGroupMode(cfg, 'assets/cdn')).toBe('subpackage');
    });

    it('dedupes the group name when two folders share a last segment', () => {
        let cfg = withFolderGroup(null, 'assets/a/cdn', 'remote');
        cfg = withFolderGroup(cfg, 'assets/b/cdn', 'remote');
        expect(Object.keys(cfg.groups ?? {}).sort()).toEqual(['cdn', 'cdn2']);
        expect(folderGroupMode(cfg, 'assets/b/cdn')).toBe('remote');
    });

    it('folderGroupMode is per-folder (a parent group does not count for a child)', () => {
        const cfg = withFolderGroup(null, 'assets/dlc', 'remote');
        expect(folderGroupMode(cfg, 'assets/dlc')).toBe('remote');
        expect(folderGroupMode(cfg, 'assets/dlc/hd')).toBe('local'); // not directly configured
    });

    it('preserves profiles when editing groups', () => {
        const base: AssetGroupsConfig = { version: '1.0', activeProfile: 'dev', profiles: { dev: { remoteRoot: 'u' } } };
        const cfg = withFolderGroup(base, 'assets/cdn', 'remote');
        expect(cfg.profiles).toEqual({ dev: { remoteRoot: 'u' } });
        expect(cfg.activeProfile).toBe('dev');
    });
});

describe('withActiveRemoteRoot', () => {
    it('sets the active profile CDN root, creating a dev profile by default', () => {
        const cfg = withActiveRemoteRoot(null, 'https://cdn.x');
        expect(cfg.activeProfile).toBe('dev');
        expect(activeRemoteRoot(cfg)).toBe('https://cdn.x');
    });

    it('updates the existing active profile and preserves groups', () => {
        const base = withFolderGroup(null, 'assets/cdn', 'remote');
        const cfg = withActiveRemoteRoot({ ...base, activeProfile: 'prod', profiles: { prod: {} } }, 'https://p');
        expect(activeRemoteRoot(cfg)).toBe('https://p');
        expect(cfg.groups).toEqual({ cdn: { folder: 'assets/cdn', mode: 'remote' } });
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

    it('carries a group\'s always-include declaration through to the cook', () => {
        const cfg: AssetGroupsConfig = {
            version: '1.0',
            groups: {
                markup: { folder: 'assets/markup', mode: 'local', alwaysInclude: true },
                plain: { folder: 'assets/plain', mode: 'local' },
            },
        };
        // What only code names (a rich-text <img>, a path built at run time) ships
        // because the project said so — reachability from a scene would cull it.
        expect(resolveAssetGroup('assets/markup/heart.png', cfg).alwaysInclude).toBe(true);
        expect(resolveAssetGroup('assets/plain/hero.png', cfg).alwaysInclude).toBe(false);
    });
});
