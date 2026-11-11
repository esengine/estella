// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A model imported with `dynamicGI` on gets a `.esmeshsdf` and `.esmeshcards` beside each mesh; without it, none.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { importModelFile } from '../src/assets/importModelFile';
import { decodeMeshSdf, sampleMeshSdf } from '../src/assets/meshSdf';
import { decodeMeshCards } from '../../sdk/src/gi/cardFormat';

/** A cube of half extent 50 (units), glTF with outward winding. */
function cubeGltf(): string {
    const p: number[] = [];
    for (let i = 0; i < 8; i++) p.push((i & 1 ? 1 : -1) * 50, (i & 2 ? 1 : -1) * 50, (i & 4 ? 1 : -1) * 50);
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    const idx: number[] = [];
    for (const [a, b, c, d] of quads as [number, number, number, number][]) {
        const pa = p.slice(a * 3, a * 3 + 3), pb = p.slice(b * 3, b * 3 + 3), pc = p.slice(c * 3, c * 3 + 3);
        const u = pb.map((v, k) => v - pa[k]!), w = pc.map((v, k) => v - pa[k]!);
        const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
        idx.push(...(n[0]! * pa[0]! + n[1]! * pa[1]! + n[2]! * pa[2]! > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
    }
    const positions = new Float32Array(p), indices = new Uint16Array(idx);
    const bytes = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
    return JSON.stringify({
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'cube' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 }, { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-50, -50, -50], max: [50, 50, 50] },
            { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
        ],
    });
}

describe('importing a model with a distance field', () => {
    const roots: string[] = [];
    afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

    async function run(dynamicGI: boolean) {
        const root = mkdtempSync(path.join(tmpdir(), 'model-sdf-'));
        roots.push(root);
        const dir = path.join(root, 'assets', 'models');
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, 'cube.gltf'), cubeGltf());
        const result = await importModelFile({ root, destDir: 'assets/models', absSource: path.join(dir, 'cube.gltf'), settings: { dynamicGI } });
        return { result, dir, files: readdirSync(dir) };
    }

    it('writes a field that measures the mesh it sits beside', async () => {
        const { result, dir, files } = await run(true);
        const name = files.find((f) => f.endsWith('.esmeshsdf'));
        expect(name).toBeDefined();
        expect(result.products.some((p) => p.endsWith('.esmeshsdf'))).toBe(true);
        const sdf = decodeMeshSdf(new Uint8Array(readFileSync(path.join(dir, name!))));
        expect(sampleMeshSdf(sdf, [0, 0, 0])).toBeLessThan(-40);
        expect(sampleMeshSdf(sdf, [80, 0, 0])).toBeGreaterThan(20);
        const cardsName = files.find((f) => f.endsWith('.esmeshcards'));
        expect(cardsName).toBeDefined();
        expect(decodeMeshCards(new Uint8Array(readFileSync(path.join(dir, cardsName!)))).cards.length).toBe(6);
    });

    it('writes none unless it is asked to', async () => {
        const { files } = await run(false);
        expect(files.some((f) => f.endsWith('.esmeshsdf') || f.endsWith('.esmeshcards'))).toBe(false);
    });
});
