// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
/**
 * @file  The desktop assembler and the icon container it writes.
 *
 * Pinned here: a package is ASSEMBLED from a runtime template with no toolchain,
 * as the APK and the Xcode project are. The bundle's Resources are ONE asset
 * namespace — the game's files plus the runtime's bytecode — because that is what
 * Platform::readAsset reads, and bytecode the host cannot find costs every first
 * launch seconds of black screen with nothing to say why.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleDesktopApp } from '../../build-tools/utils/desktopApp.js';
import { pngToIcns, pngSize } from '../../build-tools/utils/icns.js';
import { templateLayout, desktopTemplateSources } from '../../build-tools/utils/nativeTemplate.js';

/** A minimal but REAL png — the icns writer reads IHDR, so a stub will not do. */
function png(size: number): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const chunk = (type: string, data: Buffer) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'ascii');
        return Buffer.concat([head, data, Buffer.alloc(4)]);
    };
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
    ]);
}

let dir: string;
let templateDir: string;
let contentDir: string;
let outDir: string;

const APP = { id: 'com.acme.game', name: 'Acme Game', version: '2.1', versionCode: 7 };

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'estella-desktop-'));
    templateDir = path.join(dir, 'template');
    contentDir = path.join(dir, 'content');
    outDir = path.join(dir, 'out');
    mkdirSync(templateDir, { recursive: true });
    mkdirSync(contentDir, { recursive: true });

    const sources = desktopTemplateSources(templateDir);
    writeFileSync(sources.executable, 'MZ-not-really-a-binary');
    writeFileSync(sources.bytecode, 'BYTECODE');
    writeFileSync(sources.icon, png(1024));
    writeFileSync(sources.infoPlistIn,
        '<plist><dict><key>N</key><string>@APP_NAME@</string>'
        + '<key>I</key><string>@APP_ID@</string>'
        + '<key>V</key><string>@VERSION_NAME@</string>'
        + '<key>M</key><string>@MACOS_MIN@</string></dict></plist>');

    writeFileSync(path.join(contentDir, 'game.config.json'), '{"entryScene":"a.esscene"}');
    mkdirSync(path.join(contentDir, 'assets'), { recursive: true });
    writeFileSync(path.join(contentDir, 'assets', 'a.esscene'), '{}');
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('macOS app assembly', () => {
    it('produces a bundle named and executed by the app, not by the runtime', async () => {
        const { dir: bundle } = await assembleDesktopApp({ platform: 'macos', templateDir, contentDir, outDir, app: APP });
        expect(bundle).toBe(path.join(outDir, 'Acme Game.app'));
        // The executable carries the app's name because on desktop the executable
        // IS the identity — the host reads its own argv[0] rather than a config.
        expect(existsSync(path.join(bundle, 'Contents/MacOS/Acme Game'))).toBe(true);
        expect(existsSync(path.join(bundle, 'Contents/MacOS/estella_desktop'))).toBe(false);
    });

    it('puts the runtime bytecode in the SAME asset namespace as the game', async () => {
        const { dir: bundle } = await assembleDesktopApp({ platform: 'macos', templateDir, contentDir, outDir, app: APP });
        const content = path.join(bundle, 'Contents/Resources/Content');
        expect(readFileSync(path.join(content, 'game.config.json'), 'utf8')).toContain('entryScene');
        // Beside the game's files, since that is the one path readAsset resolves.
        expect(readFileSync(path.join(content, 'esengine.native.qjsbc'), 'utf8')).toBe('BYTECODE');
        expect(existsSync(path.join(content, 'assets/a.esscene'))).toBe(true);
    });

    it('fills the identity into Info.plist', async () => {
        const { dir: bundle } = await assembleDesktopApp({
            platform: 'macos', templateDir, contentDir, outDir, app: APP, macosMin: '12.3',
        });
        const plist = readFileSync(path.join(bundle, 'Contents/Info.plist'), 'utf8');
        expect(plist).toContain('<string>Acme Game</string>');
        expect(plist).toContain('<string>com.acme.game</string>');
        expect(plist).toContain('<string>2.1</string>');
        expect(plist).toContain('<string>12.3</string>');
        expect(plist).not.toContain('@');
    });

    it('refuses a content dir that is not an export', async () => {
        rmSync(path.join(contentDir, 'game.config.json'));
        await expect(assembleDesktopApp({ platform: 'macos', templateDir, contentDir, outDir, app: APP }))
            .rejects.toThrow(/not an editor export/);
    });

    it('refuses a template with no runtime in it', async () => {
        rmSync(desktopTemplateSources(templateDir).executable);
        await expect(assembleDesktopApp({ platform: 'macos', templateDir, contentDir, outDir, app: APP }))
            .rejects.toThrow(/no executable/);
    });

    it('reassembling replaces the bundle rather than merging into it', async () => {
        const { dir: bundle } = await assembleDesktopApp({ platform: 'macos', templateDir, contentDir, outDir, app: APP });
        writeFileSync(path.join(bundle, 'Contents/Resources/Content/stale.txt'), 'x');
        await assembleDesktopApp({ platform: 'macos', templateDir, contentDir, outDir, app: APP });
        expect(existsSync(path.join(bundle, 'Contents/Resources/Content/stale.txt'))).toBe(false);
    });
});

describe('Windows assembly', () => {
    beforeEach(() => {
        // The Windows template names its runtime .exe and carries the HLSL compiler.
        writeFileSync(path.join(templateDir, 'estella_desktop.exe'), 'runtime');
        writeFileSync(path.join(templateDir, 'd3dcompiler_47.dll'), 'compiler');
    });

    it('lays the app out as a directory the depot can map whole', async () => {
        const { dir: root } = await assembleDesktopApp({
            platform: 'windows', templateDir, contentDir, outDir, app: APP,
        });
        expect(root).toBe(path.join(outDir, 'Acme Game'));
        expect(existsSync(path.join(root, 'Acme Game.exe'))).toBe(true);
        expect(existsSync(path.join(root, 'Content', 'game.config.json'))).toBe(true);
        // One namespace, as on macOS: the runtime's bytecode joins the game's files.
        expect(existsSync(path.join(root, 'Content', 'esengine.native.qjsbc'))).toBe(true);
    });

    it('ships the HLSL compiler, without which Dawn creates no device at all', async () => {
        const { dir: root } = await assembleDesktopApp({
            platform: 'windows', templateDir, contentDir, outDir, app: APP,
        });
        expect(existsSync(path.join(root, 'd3dcompiler_47.dll'))).toBe(true);
    });

    it('writes no Info.plist and no icns — those describe a bundle', async () => {
        const { dir: root } = await assembleDesktopApp({
            platform: 'windows', templateDir, contentDir, outDir, app: APP,
        });
        expect(existsSync(path.join(root, 'Info.plist'))).toBe(false);
        expect(existsSync(path.join(root, 'AppIcon.icns'))).toBe(false);
    });

    it('refuses a platform with no layout', async () => {
        await expect(assembleDesktopApp({
            platform: 'linux' as 'windows', templateDir, contentDir, outDir, app: APP,
        })).rejects.toThrow(/no desktop layout/);
    });
});

describe('the store library a package carries', () => {
    /** A Steamworks SDK's shape, as far as the assembler is concerned. */
    const fakeSdk = (name: string, os: 'osx' | 'win64', file: string, body: string): string => {
        const sdk = path.join(dir, name);
        mkdirSync(path.join(sdk, 'redistributable_bin', os), { recursive: true });
        writeFileSync(path.join(sdk, 'redistributable_bin', os, file), body);
        return sdk;
    };

    it('ships it NEXT TO THE EXECUTABLE, the one place the host looks', async () => {
        // dlopen given a leaf name never searches the executable's directory, so a
        // bundle that put the dylib anywhere else would report Steam absent on
        // every machine — indistinguishable from a game that never shipped to it.
        const sdk = fakeSdk('sdk', 'osx', 'libsteam_api.dylib', 'DYLIB');
        const { dir: bundle, steamLibrary } = await assembleDesktopApp({
            platform: 'macos', templateDir, contentDir, outDir, app: APP, steamSdkDir: sdk,
        });
        expect(steamLibrary).toBe(path.join(bundle, 'Contents/MacOS/libsteam_api.dylib'));
        expect(existsSync(path.join(bundle, 'libsteam_api.dylib'))).toBe(false);
        expect(existsSync(path.join(bundle, 'Contents/Resources/libsteam_api.dylib'))).toBe(false);
    });

    it('takes the project\'s SDK over whatever the template was built with', async () => {
        // The published template carries none — CI has no Steamworks SDK and may
        // not redistribute one — so the project's is the only source that scales.
        writeFileSync(path.join(templateDir, 'libsteam_api.dylib'), 'FROM TEMPLATE');
        const sdk = fakeSdk('sdk', 'osx', 'libsteam_api.dylib', 'FROM PROJECT');
        const { steamLibrary } = await assembleDesktopApp({
            platform: 'macos', templateDir, contentDir, outDir, app: APP, steamSdkDir: sdk,
        });
        expect(readFileSync(steamLibrary!, 'utf8')).toBe('FROM PROJECT');
    });

    it('says so when the named SDK holds no redistributable', async () => {
        const warnings: string[] = [];
        const empty = path.join(dir, 'empty-sdk');
        mkdirSync(empty, { recursive: true });
        const { steamLibrary } = await assembleDesktopApp({
            platform: 'macos', templateDir, contentDir, outDir, app: APP,
            steamSdkDir: empty, warn: (m) => warnings.push(m),
        });
        expect(steamLibrary).toBeNull();
        expect(warnings.join(' ')).toMatch(/redistributable_bin/);
    });

    it('is absent, not invented, when no SDK is named', async () => {
        const { steamLibrary } = await assembleDesktopApp({
            platform: 'macos', templateDir, contentDir, outDir, app: APP,
        });
        expect(steamLibrary).toBeNull();
    });
});

describe('the icon container', () => {
    it('writes a slot matching the icon and a length covering the file', () => {
        const icns = pngToIcns(png(1024));
        expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
        expect(icns.readUInt32BE(4)).toBe(icns.length);
        expect(icns.subarray(8, 12).toString('ascii')).toBe('ic10');   // the 1024 slot
        expect(icns.readUInt32BE(12)).toBe(icns.length - 8);
    });

    it('takes the largest slot the icon covers rather than claiming one it does not', () => {
        expect(pngToIcns(png(512)).subarray(8, 12).toString('ascii')).toBe('ic09');
        expect(pngToIcns(png(256)).subarray(8, 12).toString('ascii')).toBe('ic08');
        // Between two slots: the smaller one, so the file never says 512 about a
        // 300px picture.
        expect(pngToIcns(png(300)).subarray(8, 12).toString('ascii')).toBe('ic08');
    });

    it('refuses what it cannot honestly wrap', () => {
        expect(() => pngToIcns(png(8))).toThrow(/smallest macOS slot/);
        expect(() => pngToIcns(Buffer.from('not a png'))).toThrow(/not a PNG/);
        const oblong = png(64);
        oblong.writeUInt32BE(32, 20);
        expect(() => pngToIcns(oblong)).toThrow(/square/);
    });

    it('reads a PNG size from IHDR', () => {
        expect(pngSize(png(128))).toEqual({ width: 128, height: 128 });
    });
});

describe('the layout table is the only thing that names files', () => {
    it('describes the macOS template the assembler reads', () => {
        const rels = templateLayout('macos').map((e: { rel: string }) => e.rel);
        const sources = desktopTemplateSources('T');
        for (const [key, file] of Object.entries(sources)) {
            // The D3D compiler is Windows-only; macOS has no counterpart.
            if (key === 'd3dCompiler') continue;
            expect(rels).toContain(path.relative('T', file as string));
        }
    });

    it('carries the HLSL compiler on Windows, without which no device is created', () => {
        const rels = templateLayout('windows').map((e: { rel: string }) => e.rel);
        expect(rels).toContain('d3dcompiler_47.dll');
        expect(rels).toContain('estella_desktop.exe');
        // No Info.plist: a bundle description is macOS's, and an entry every
        // consumer has to check for is worse than a layout that differs where the
        // platforms do.
        expect(rels).not.toContain('Info.plist.in');
    });
});
