// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every product a model import makes says, in its `.meta`, which model it came from (`source`, the model's uuid), so
 *        a product knows its source and folds under it; a re-import keeps it without
 *        rewriting an unchanged `.meta`; a file the model only names is not a product of it; and the asset index carries it.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { importModelFile } from '../src/assets/importModelFile';
import { scanAssetDatabase } from '../src/assets/assetDb';

function triangleGltf(): string {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2, 0]);
    const bytes = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
    return JSON.stringify({
        asset: { version: '2.0' },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'tri' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        materials: [{ name: 'wall', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }], images: [{ uri: 'wall.png' }],
        buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
    });
}

const metaOf = (abs: string) => JSON.parse(readFileSync(`${abs}.meta`, 'utf8')) as { uuid: string; source?: string };

describe('a model import records where its products came from', () => {
    const roots: string[] = [];
    afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

    it('marks each product with the model, leaves a file the model only names alone, and the index reads it', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'model-source-'));
        roots.push(root);
        const dir = path.join(root, 'assets', 'models');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'tri.gltf'), triangleGltf());
        writeFileSync(path.join(dir, 'wall.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

        const first = await importModelFile({ root, destDir: 'assets/models', absSource: path.join(dir, 'tri.gltf') });
        // The model had no .meta yet: the import gave it one, so there is a uuid to name.
        const model = metaOf(path.join(dir, 'tri.gltf')).uuid;
        expect(model).toMatch(/^[0-9a-f-]{36}$/);
        const made = first.products.filter((p) => /\.(esmesh|esmaterial|esprefab)$/.test(p));
        expect(made.length).toBeGreaterThanOrEqual(3);
        for (const rel of made) expect(metaOf(path.join(root, rel)).source, rel).toBe(model);
        // The image is the artist's, beside the model: named by it, not made by it.
        expect(metaOf(path.join(dir, 'wall.png')).source).toBeUndefined();

        // Imported again: the same answer, and an unchanged .meta is not rewritten.
        const prefab = path.join(root, made.find((p) => p.endsWith('.esprefab'))!);
        const before = statSync(`${prefab}.meta`).mtimeMs;
        await new Promise((r) => setTimeout(r, 20));
        await importModelFile({ root, destDir: 'assets/models', absSource: path.join(dir, 'tri.gltf') });
        expect(metaOf(prefab).source).toBe(model);
        expect(statSync(`${prefab}.meta`).mtimeMs).toBe(before);

        const { index } = await scanAssetDatabase(root);
        const bySource = index.entries.filter((e) => e.source === model).map((e) => e.path).sort();
        expect(bySource).toEqual([...made].sort());
    });

    it('preserves an existing destination dependency even for a fixed import directory', async () => {
        const root = mkdtempSync(path.join(tmpdir(), 'model-source-dest-'));
        const originDir = mkdtempSync(path.join(tmpdir(), 'model-source-origin-'));
        roots.push(root, originDir);
        const dir = path.join(root, 'assets');
        mkdirSync(dir);
        const absSource = path.join(dir, 'tri.gltf');
        const previous = 'existing PNG', incoming = path.join(originDir, 'wall.png');
        writeFileSync(absSource, triangleGltf());
        writeFileSync(path.join(dir, 'wall.png'), previous);
        writeFileSync(incoming, 'a different PNG');
        const options = { root, absSource, originDir, destDir: 'assets' };
        await expect(importModelFile(options)).rejects.toThrow('conflicts with assets/wall.png');
        expect(readFileSync(path.join(dir, 'wall.png'), 'utf8')).toBe(previous);
        writeFileSync(incoming, previous);
        expect((await importModelFile(options)).products).toContain('assets/wall.png');
    });
});
