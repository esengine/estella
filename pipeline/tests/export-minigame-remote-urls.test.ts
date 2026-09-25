// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mini-game's remote asset gets a new URL when its content changes.
 *        Under one name, a hot update re-read the old bytes (a WeChat phone kept
 *        showing v1's art after "update applied"), and uploading v2 to the CDN
 *        would hand v1 players v2's files.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import { exportGame } from '../src/export/exportGame';
import { miniGameSdkStub } from './fixtures/miniGameSdkStub';
import { wechatExportProfile } from '../src/export/miniGameExportProfile';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

const ART = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });

async function exportWith(art: string): Promise<{ path: string; bytes: string }> {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-remote-urls-'));
    try {
        mkdirSync(path.join(root, 'assets', 'cdn'), { recursive: true });
        writeFileSync(path.join(root, 'assets', 'cdn', 'art.png'), art);
        writeFileSync(path.join(root, 'assets', 'cdn', 'art.png.meta'), meta(ART, 'texture'));
        mkdirSync(path.join(root, '.esengine'), { recursive: true });
        writeFileSync(path.join(root, '.esengine', 'asset-groups.json'), JSON.stringify({
            version: '1.0', groups: { cdn: { folder: 'assets/cdn', mode: 'remote' } },
        }));
        mkdirSync(path.join(root, 'scenes'), { recursive: true });
        writeFileSync(path.join(root, 'scenes', 'main.esscene'), JSON.stringify({
            version: '1.0', name: 'Main',
            entities: [{ name: 'Art', components: [{ type: 'Sprite', data: { texture: `@uuid:${ART}` } }] }],
        }));
        writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
        mkdirSync(path.join(root, '_sdk'), { recursive: true });
        writeFileSync(path.join(root, '_sdk', 'index.wechat.js'), miniGameSdkStub(wechatExportProfile));
        mkdirSync(path.join(root, '_wxwasm'), { recursive: true });
        writeFileSync(path.join(root, '_wxwasm', 'esengine.js'), 'module.exports = () => Promise.resolve({});');
        writeFileSync(path.join(root, '_wxwasm', 'esengine.wasm'), 'wasmbytes');
        const out = path.join(root, 'dist');
        const res = await exportGame({
            root, entryScene: 'scenes/main.esscene', hostsDir: 'unused-for-wechat', packagesDir: OFFICIAL_PACKAGES,
            sdkDistDir: path.join(root, '_sdk'), wasmDir: path.join(root, '_wxwasm'), outDir: out,
            title: 'Remote', platform: 'wechat', miniGameAppid: 'wxTEST0123456789', orientation: 'landscape',
            runtime: runtimeConfigOf({ designResolution: { width: 1280, height: 720 } }),
        });
        expect(res.errors).toEqual([]);
        const manifest = JSON.parse(readFileSync(path.join(out, 'asset-manifest.json'), 'utf8'));
        const entry = manifest.groups.cdn.assets[ART] as { path: string };
        expect(existsSync(path.join(out, entry.path))).toBe(true);
        return { path: entry.path, bytes: readFileSync(path.join(out, entry.path), 'utf8') };
    } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
}

describe('a mini-game remote asset', () => {
    it('is named by its content, so a changed one is a new URL', async () => {
        const v1 = await exportWith('GREEN-PIXELS');
        const v2 = await exportWith('RED-PIXELS');
        expect(v1.bytes).toBe('GREEN-PIXELS');
        expect(v2.bytes).toBe('RED-PIXELS');
        expect(v1.path).not.toBe(v2.path);
        expect(v1.path).toMatch(/^remote\/cdn\/assets\/[0-9a-f]{16}\.png$/);
    }, 60_000);
});
