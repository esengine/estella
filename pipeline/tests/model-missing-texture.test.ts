// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A model whose material names a texture file that is not there is imported without that texture, and says so — instead of
 *        leaving a reference that fails to load every time the model is used.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { importModelFile } from '../src/assets/importModelFile';

function triangleGltf(image: string): string {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2, 0]);
    const bytes = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
    return JSON.stringify({
        asset: { version: '2.0' },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'tri' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
        materials: [{ name: 'wall', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        textures: [{ source: 0 }], images: [{ uri: image }],
        buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
    });
}

describe('a model that names a texture the project does not have', () => {
    const roots: string[] = [];
    afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

    async function run(image: string, withFile: boolean) {
        const root = mkdtempSync(path.join(tmpdir(), 'model-missing-'));
        roots.push(root);
        const src = path.join(root, 'assets', 'models');
        mkdirSync(src, { recursive: true });
        writeFileSync(path.join(src, 'tri.gltf'), triangleGltf(image));
        if (withFile) writeFileSync(path.join(src, image), Buffer.from('89504e470d0a1a0a', 'hex'));
        const result = await importModelFile({ root, destDir: 'assets/models', absSource: path.join(src, 'tri.gltf') });
        const text = readdirSync(src).map((f) => (/\.(esprefab|esmaterial)$/.test(f) ? readFileSync(path.join(src, f), 'utf8') : '')).join('\n');
        return { result, text };
    }

    it('leaves the texture off and says it is not there', async () => {
        const { result, text } = await run('wall.psd', false);
        expect(result.warnings.some((w) => w.includes('wall.psd'))).toBe(true);
        expect(text).not.toContain('wall.psd');
    });

    it('keeps a texture that is there', async () => {
        const { result, text } = await run('wall.png', true);
        expect(result.warnings.some((w) => w.includes('wall.png'))).toBe(false);
        expect(text).toContain('wall.png');
    });
});
