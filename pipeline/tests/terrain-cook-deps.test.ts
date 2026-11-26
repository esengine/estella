// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { cookAssets, type CookManifest } from '../src/assets/cookAssets';
import { encodeRgbaPng } from '../src/assets/png';

it('ships terrain tile and overview samples byte-for-byte through the asset cook', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-terrain-cook-'));
    const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
    const terrain = 'assets/ground.esterrain';
    const scene = 'assets/main.esscene';
    const dir = 'assets/ground.atlas';
    const names = ['overview.png', 'tile.png', 'overview-weights.png', 'tile-weights.png'];
    const images = names.map((name, i) => ({
        path: `${dir}/${name}`,
        uuid: id(i + 1),
        bytes: encodeRgbaPng(9, 9, Uint8Array.from({ length: 9 * 9 * 4 }, (_, byte) => byte % 4 === 3 ? 0 : (byte + i * 23) % 256)),
    }));
    const write = (rel: string, type: string, uuid: string, body: string | Uint8Array, importer = {}) => {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(abs + '.meta', JSON.stringify({ version: '2.0', uuid, type, importer }));
    };
    try {
        for (const image of images) write(image.path, 'texture', image.uuid, image.bytes, { use: 'colour', maxSize: 4, compress: 'on' });
        write(terrain, 'terrain-tiles', id(5), JSON.stringify({
            version: 1, tileSamples: 9, tilesX: 1, tilesZ: 1, format: 1, overview: images[0]!.path,
            overviewSplat2: '@uuid:' + images[2]!.uuid,
            tiles: [{ x: 0, z: 0, height: images[1]!.path, splat: images[3]!.path }],
        }));
        write(scene, 'scene', id(6), JSON.stringify({ version: '1.0', name: 'Terrain', entities: [{
            id: 1, name: 'Ground', parent: null, children: [],
            components: [{ type: 'Terrain', data: { tiles: terrain } }],
        }] }));
        const result = await cookAssets(root, {
            entryScenes: [scene], outDir: 'build', atlasTextures: true, resizeTextures: true, compressTextures: true, contentAddressed: true,
        });
        expect(result.ok).toBe(true);
        expect(result.included).toEqual(expect.arrayContaining([id(5), ...images.map(image => image.uuid)]));
        const manifest = JSON.parse(readFileSync(result.manifestPath!, 'utf8')) as CookManifest;
        for (const image of images) {
            const entry = manifest.entries.find(entry => entry.uuid === image.uuid)!;
            expect(entry.atlas).toBeUndefined();
            expect(readFileSync(path.join(result.outDir, entry.path))).toEqual(Buffer.from(image.bytes));
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
