// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadProjectPlatform, listPlatforms } from '../src/export/platformCatalog';
import { exportGame } from '../src/export/exportGame';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
let dirs: { web: string; minigame: string; quickgame: string };
const sdk = () => path.join(root, '_sdk');
beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'estella-openpaas-'));
    dirs = { web: path.join(root, '_web'), minigame: path.join(root, '_minigame'), quickgame: path.join(root, '_compat') };
    for (const dir of [dirs.web, dirs.minigame, dirs.quickgame, sdk(), path.join(sdk(), 'openpaas'),
        path.join(root, 'scenes'), path.join(root, '.esengine/platforms')]) mkdirSync(dir, { recursive: true });
    copyFileSync(path.resolve(__dirname, '../platforms/openpaas.mjs'), path.join(root, '.esengine/platforms/openpaas.mjs'));
    writeFileSync(path.join(dirs.quickgame, 'esengine.wxgame.js'), 'module.exports = () => Promise.resolve({});');
    writeFileSync(path.join(dirs.quickgame, 'esengine.wxgame.wasm'), Uint8Array.from([0,97,115,109,1,0,0,0]));
    writeFileSync(path.join(sdk(), 'index.minigame.js'), 'export function initMiniGameRuntime(){}\nexport function installMiniGamePlatform(){}');
    writeFileSync(path.join(sdk(), 'openpaas/index.js'), 'export const openpaasProfile = {id:"openpaas",hostLabel:"SUD OpenPaaS"};');
    for (const [name, type, uuid] of [['2d', 'Sprite', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        ['3d', 'MeshRenderer', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]) {
        writeFileSync(path.join(root, `scenes/${name}.esscene`), JSON.stringify({
            version: '1.0', name, entities: [{ id: 1, components: [{ type, data: {} }] }],
        }));
        writeFileSync(path.join(root, `scenes/${name}.esscene.meta`), JSON.stringify({ uuid, version: '2.0', type: 'scene', importer: {} }));
    }
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

describe('OpenPaaS third-party directory export', () => {
    it('loads the shipped preset and probes the same compatibility runtime the exporter uses', async () => {
        const loaded = await loadProjectPlatform(root, 'openpaas', dirs);
        expect(loaded).not.toBeNull();
        expect(loaded!.wasmDir).toBe(dirs.quickgame);
        expect(loaded!.profile.entryFile).toBe('main.js');
        expect(loaded!.profile.runtimeProfileHost).toBe('openpaasPlatformProfile');
        const rows = await listPlatforms(root, dirs, '0.0.0', { emcc: null, cc: null });
        expect(rows.find(row => row.id === 'openpaas')).toMatchObject({ ready: true, source: 'project' });
    });

    it('exports both 2D and 3D scenes through the shared pipeline with main.js and uncompressed wasm', async () => {
        const loaded = (await loadProjectPlatform(root, 'openpaas', dirs))!;
        const out = path.join(root, 'out');
        const result = await exportGame({
            minifyScripts: false,
            root, platform: 'openpaas', miniGameProfile: loaded.profile,
            entryScene: 'scenes/2d.esscene', sdkDistDir: sdk(), wasmDir: loaded.wasmDir, outDir: out,
            hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
            compressWasm: true, engineSubpackage: true, orientation: 'landscape', aotMode: 'dev',
        });
        expect(result.errors).toEqual([]); expect(result.ok).toBe(true);
        expect(result.platform).toBe('openpaas');
        const entry = readFileSync(path.join(out, 'main.js'), 'utf8');
        expect(entry).toContain("__load('./wasm/esengine.wxgame.js')");
        expect(entry).toContain("__load('./game-bundle.js')");
        expect(entry).toContain('globalThis.module = current');
        expect(entry).not.toContain('loadSubpackage');
        expect(existsSync(path.join(out, 'game.js'))).toBe(false);
        expect(existsSync(path.join(out, 'project.config.json'))).toBe(false);
        expect(JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))).toEqual({});
        expect(existsSync(path.join(out, 'wasm/esengine.wxgame.wasm'))).toBe(true);
        expect(existsSync(path.join(out, 'wasm/esengine.wxgame.wasm.br'))).toBe(false);
        expect(readFileSync(path.join(out, 'scenes/2d.json'), 'utf8')).toContain('Sprite');
        expect(readFileSync(path.join(out, 'scenes/3d.json'), 'utf8')).toContain('MeshRenderer');
        expect(readFileSync(path.join(out, 'game-bundle.js'), 'utf8')).toContain('installMiniGamePlatform');
        expect(readFileSync(path.join(out, 'OPENPAAS.txt'), 'utf8')).toContain('acceptance is pending');
    }, 180_000);

    it('rejects a misspelled preset instead of silently choosing generic host defaults', async () => {
        writeFileSync(path.join(root, '.esengine/platforms/typo.mjs'),
            'export default {id:"typo",label:"Typo",preset:"openpass"}');
        const rows = await listPlatforms(root, dirs, '0.0.0', { emcc: null, cc: null });
        expect(rows.find(row => row.id === 'typo')?.error).toContain('unknown mini-game profile preset');
        expect(await loadProjectPlatform(root, 'typo', dirs)).toBeNull();
    });

    it('allows a project entry filename but rejects traversal outside the export directory', async () => {
        for (const [id, entryFile] of [['named', 'startup.js'], ['traversal', '../outside.js']]) {
            writeFileSync(path.join(root, `.esengine/platforms/${id}.mjs`),
                `export default ${JSON.stringify({ id, label: id, preset: 'openpaas', entryFile })}`);
        }
        expect((await loadProjectPlatform(root, 'named', dirs))?.profile.entryFile).toBe('startup.js');
        expect(await loadProjectPlatform(root, 'traversal', dirs)).toBeNull();
    });
});
