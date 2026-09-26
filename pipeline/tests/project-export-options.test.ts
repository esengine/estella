// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a project's settings make of an export, as both the Build dialog
 *        and the command line receive it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseManifest } from '../src/project/format';
import { projectExportOptions } from '../src/export/projectExportOptions';

let root: string;

beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'export-options-'));
    mkdirSync(path.join(root, 'sign'));
    writeFileSync(path.join(root, 'sign', 'key.pem'), 'KEY');
    writeFileSync(path.join(root, 'sign', 'cert.pem'), 'CERT');
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

const manifest = parseManifest({
    formatVersion: '1',
    name: 'Star Hopper',
    version: '2.1.0',
    defaultScene: 'levels/start.esscene',
    layout: { scenes: 'levels' },
    scripts: { main: 'game/boot.ts' },
    features: { modules: { 'esengine/tilemap': 'exclude' } },
    packaging: {
        modulesByPlatform: { wechat: { 'esengine/ai': 'include' } },
        sizeBudget: { wechat: 4_000_000 },
        platforms: {
            wechat: { appid: 'wx-own' },
            douyin: { appid: 'tt-own' },
            quickgame: { appid: 'qg', versionCode: 7, releaseKey: { privateKey: 'sign/key.pem', certificate: 'sign/cert.pem' } },
            android: { versionCode: 12, appBundle: true, output: 'project' },
            desktop: { productName: 'Star Hopper Deluxe', channel: 'steam', steam: { appId: 480 } },
            playable: { network: 'meta' },
        },
    },
});

describe('the export a project describes', () => {
    it('carries the project\'s layout, entry points and name', async () => {
        const o = await projectExportOptions(root, manifest, 'web');
        expect(o).toMatchObject({
            root, platform: 'web', entryScene: 'levels/start.esscene', scenesDir: 'levels',
            scriptsEntry: 'game/boot.ts', title: 'Star Hopper', appVersion: '2.1.0',
        });
    });

    it('carries the engine modules the project chose, per target', async () => {
        const o = await projectExportOptions(root, manifest, 'wechat');
        expect(o.features?.modules).toEqual({ 'esengine/tilemap': 'exclude' });
        expect(o.modulesByPlatform?.wechat).toEqual({ 'esengine/ai': 'include' });
        expect(o.sizeBudgetBytes).toBe(4_000_000);
    });

    it('gives each mini-game vendor its own id, and a web build none', async () => {
        expect((await projectExportOptions(root, manifest, 'douyin')).miniGameAppid).toBe('tt-own');
        expect((await projectExportOptions(root, manifest, 'wechat')).miniGameAppid).toBe('wx-own');
        expect((await projectExportOptions(root, manifest, 'web')).miniGameAppid).toBeUndefined();
    });

    it('gives a project-defined target WeChat\'s id', async () => {
        expect((await projectExportOptions(root, manifest, 'my-portal')).miniGameAppid).toBe('wx-own');
    });

    it('names a native app after the project, not a placeholder', async () => {
        const android = await projectExportOptions(root, manifest, 'android');
        expect(android.appId).toMatch(/^[a-z][\w.]*\.[a-z]\w*$/i);
        expect(android.appId).not.toBe('com.estella.game');
        expect(android).toMatchObject({ androidVersionCode: 12, androidAppBundle: true, androidOutput: 'project' });
        expect((await projectExportOptions(root, manifest, 'web')).appId).toBeUndefined();
    });

    it('carries the desktop product, channel and Steam app', async () => {
        expect(await projectExportOptions(root, manifest, 'desktop')).toMatchObject({
            desktopProductName: 'Star Hopper Deluxe', desktopChannel: 'steam', steam: { appId: 480 },
        });
    });

    it('reads a quick game\'s release key from the project', async () => {
        const o = await projectExportOptions(root, manifest, 'quickgame');
        expect(o.miniGameVersionCode).toBe(7);
        expect(o.miniGameReleaseKey).toBeDefined();
    });

    it('resolves a playable\'s ad network', async () => {
        expect((await projectExportOptions(root, manifest, 'playable')).playableAdProfile?.id).toBe('meta');
    });
});

describe('an export profile', () => {
    const withProfiles = parseManifest({
        formatVersion: '1',
        name: 'Star Hopper',
        defaultScene: 'levels/start.esscene',
        packaging: {
            sourceMaps: false,
            platforms: { wechat: { appid: 'wx-prod' }, quickgame: { appid: 'qg', versionCode: 7 } },
            profiles: {
                test: {
                    platform: 'wechat', config: 'development', sourceMaps: true,
                    remoteRoot: 'http://192.168.1.5:8080/cdn',
                    platforms: { wechat: { appid: 'wx-test' }, android: { versionCode: 99 } },
                },
                prod: { platform: 'wechat', config: 'shipping', remoteRoot: 'https://cdn.example.com/hop' },
                vivo: { platform: 'quickgame', platforms: { quickgame: { appid: 'qg-test' } } },
                broken: { config: 'shipping' },
            },
        },
    });

    it('keeps only what a profile may set, and only its own target\'s slice', () => {
        expect(withProfiles.packaging?.profiles?.test).toEqual({
            platform: 'wechat', config: 'development', sourceMaps: true,
            remoteRoot: 'http://192.168.1.5:8080/cdn',
            platforms: { wechat: { appid: 'wx-test' } },
        });
    });

    it('is dropped when it names no target', () => {
        expect(withProfiles.packaging?.profiles?.broken).toBeUndefined();
    });

    it('lays its settings over the project\'s', async () => {
        const o = await projectExportOptions(root, withProfiles, 'wechat', 'test');
        expect(o).toMatchObject({
            miniGameAppid: 'wx-test', sourcemap: true, minify: false, profile: 'test',
            hotUpdate: { remoteRoot: 'http://192.168.1.5:8080/cdn' },
        });
        expect(await projectExportOptions(root, withProfiles, 'wechat', 'prod'))
            .toMatchObject({ miniGameAppid: 'wx-prod', minify: true, sourcemap: false, hotUpdate: { remoteRoot: 'https://cdn.example.com/hop' } });
    });

    it('keeps the project\'s fields in its target\'s slice that it does not name', async () => {
        const o = await projectExportOptions(root, withProfiles, 'quickgame', 'vivo');
        expect(o).toMatchObject({ miniGameAppid: 'qg-test', miniGameVersionCode: 7 });
        expect(o.minify).toBeUndefined();
    });

    it('leaves an export without a profile as the project describes it', async () => {
        const o = await projectExportOptions(root, withProfiles, 'wechat');
        expect(o).toMatchObject({ miniGameAppid: 'wx-prod', sourcemap: false });
        expect(o.profile).toBeUndefined();
        expect(o.hotUpdate).toBeUndefined();
    });

    it('refuses a name the project does not define, and a profile for another target', async () => {
        await expect(projectExportOptions(root, withProfiles, 'wechat', 'staging')).rejects.toThrow(/this project has test, prod, vivo/);
        await expect(projectExportOptions(root, withProfiles, 'douyin', 'test')).rejects.toThrow(/is for wechat, not douyin/);
    });
});
