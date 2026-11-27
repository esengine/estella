// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { cookAssets, type CookManifest } from '../src/assets/cookAssets';
import { encodeRgbaPng } from '../src/assets/png';

it.each([9, 8])('cooks terrain with a %i×9 PNG for a 9×9 tile only when its dimensions match', async tileWidth => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-terrain-cook-'));
    const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
    const terrain = 'assets/ground.esterrain';
    const scene = 'assets/main.esscene';
    const dir = 'assets/ground.atlas';
    const noteImage = `${dir}/authoring-note.png`;
    const names = ['overview.png', 'tile.png', 'overview-weights.png', 'tile-weights.png'];
    const images = names.map((name, i) => {
        const width = i === 1 ? tileWidth : 9;
        return {
            path: `${dir}/${name}`,
            uuid: id(i + 1),
            bytes: encodeRgbaPng(width, 9, Uint8Array.from({ length: width * 9 * 4 }, (_, byte) => byte % 4 === 3 ? 0 : (byte + i * 23) % 256)),
        };
    });
    const write = (rel: string, type: string, uuid: string, body: string | Uint8Array, importer = {}) => {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        writeFileSync(abs + '.meta', JSON.stringify({ version: '2.0', uuid, type, importer }));
    };
    try {
        for (const image of images) write(image.path, 'texture', image.uuid, image.bytes, { use: 'colour', maxSize: 4, compress: 'on' });
        write(noteImage, 'texture', id(7), images[0]!.bytes);
        write(terrain, 'terrain-tiles', id(5), JSON.stringify({
            version: 1, tileSamples: 9, tilesX: 1, tilesZ: 1, format: 1, overview: images[0]!.path,
            note: noteImage,
            overviewSplat2: '@uuid:' + images[2]!.uuid,
            tiles: [{ x: 0, z: 0, height: tileWidth === 9 ? images[1]!.path : '@uuid:' + images[1]!.uuid, splat: images[3]!.path }],
        }));
        write(scene, 'scene', id(6), JSON.stringify({ version: '1.0', name: 'Terrain', entities: [{
            id: 1, name: 'Ground', parent: null, children: [],
            components: [{ type: 'Terrain', data: { tiles: terrain } }],
        }] }));
        const result = await cookAssets(root, {
            entryScenes: [scene], outDir: 'build', atlasTextures: true, resizeTextures: true, compressTextures: true, contentAddressed: true,
        });
        if (tileWidth === 8) {
            expect(result.ok).toBe(false);
            expect(result.failed).toEqual([`${terrain}: terrain tile 0:0 (${images[1]!.path}) is 8 by 9, not 9 a side`]);
            return;
        }
        expect(result.ok).toBe(true);
        expect(result.included).toEqual(expect.arrayContaining([id(5), ...images.map(image => image.uuid)]));
        expect(result.included).not.toContain(id(7));
        const manifest = JSON.parse(readFileSync(result.manifestPath!, 'utf8')) as CookManifest;
        for (const image of images) {
            const entry = manifest.entries.find(entry => entry.uuid === image.uuid)!;
            expect(entry.atlas).toBeUndefined();
            expect(readFileSync(path.join(result.outDir, entry.path))).toEqual(Buffer.from(image.bytes));
        }
    } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

it.each([false, true])('fails cooking a reachable terrain with missing images or an invalid manifest (malformed: %s)', async malformed => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-terrain-missing-'));
    const terrain = 'assets/maps/ground.esterrain', scene = 'assets/main.esscene';
    const overview = 'assets/maps/unregistered.png', height = 'excluded/tile.png';
    const weights = '@uuid:aaaaaaaa-aaaa-4aaa-8aaa-000000000024';
    const put = (rel: string, body: string, type?: string, suffix?: string) => {
        const abs = path.join(root, rel);
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, body);
        if (type) writeFileSync(abs + '.meta', JSON.stringify({ type, version: '2.0', uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-' + suffix }));
    };
    try {
        put('project.esproject', JSON.stringify({ name: 'Terrain', assetExclude: ['excluded'] }));
        put(overview, 'unregistered image');
        put(height, 'excluded image', 'texture', '000000000021');
        put(terrain, JSON.stringify({ version: 1, tileSamples: 9, tilesX: 1, tilesZ: 1, overview,
            tiles: [{ x: 0, z: 0, height, splat: malformed ? 24 : weights }] }),
            'terrain-tiles', '000000000022');
        put(scene, JSON.stringify({ version: '1.0', name: 'Terrain', entities: [{
            id: 1, name: 'Ground', parent: null, children: [], components: [{ type: 'Terrain', data: { tiles: terrain } }],
        }] }), 'scene', '000000000023');

        const result = await cookAssets(root, { entryScenes: [scene], outDir: 'build' });
        expect(result.ok).toBe(false);
        expect(result.failed).toEqual(malformed
            ? [`${terrain}: terrain tiles: tile 0:0 splat must name an image`]
            : [overview, height, weights].map(ref => `${terrain}: terrain image '${ref}' is not packaged`));
    } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});
