// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A bake split across threads is the same bake: every lumel is solved on
 *        its own, so the atlas comes out byte for byte what one thread writes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { encodeMesh, unwrapLightmapUV, MeshChannel, MeshChannelType, type MeshData, type BakeLight } from 'esengine';
import { bakeSceneLightmap, bakeSceneLightmapParallel, type SceneBakeInput } from '../src/assets/lightmapBake';
import { BakePool } from '../src/assets/lightmapPool';
import { encodeRgbaPng } from '../src/assets/png';

let dir = '';
let pool: BakePool;

function quad(half: number, y: number, facing: 1 | -1): MeshData {
    const p = [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half]];
    const vertices = new Uint8Array(4 * 24);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => {
        q.forEach((v, k) => view.setFloat32(i * 24 + k * 4, v, true));
        view.setFloat32(i * 24 + 16, facing, true);
    });
    return unwrapLightmapUV({
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
        ],
        vertexStride: 24, vertexCount: 4, vertices,
        indices: Uint32Array.from(facing > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]),
        aabbMin: [-half, y, -half], aabbMax: [half, y, half],
    }).mesh;
}

beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'estella-parallel-'));
    await writeFile(path.join(dir, 'floor.esmesh'), encodeMesh(quad(4, 0, 1)));
    await writeFile(path.join(dir, 'roof.esmesh'), encodeMesh(quad(1.5, 1, -1)));
    const holes = new Uint8Array(4 * 4 * 4).fill(200);
    for (let i = 8; i < 16; i++) holes[i * 4 + 3] = 0;
    await writeFile(path.join(dir, 'holes.png'), encodeRgbaPng(4, 4, holes));
    await writeFile(path.join(dir, 'cutout.esmaterial'), JSON.stringify(
        { version: '1.0', type: 'material', shader: 'builtin:model', properties: { u_alphaCutoff: 0.5 } }));
    const worker = path.join(dir, 'lightmapWorker.mjs');
    await build({ entryPoints: [path.resolve(__dirname, '../src/assets/lightmapWorker.ts')],
                  outfile: worker, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
    pool = new BakePool(worker, 3);
});

afterAll(async () => {
    await pool?.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LAMP: BakeLight[] = [{ kind: 'point', position: [2, 3, 1], color: [1, 0.8, 0.6], intensity: 5, radius: 20 }];

function scene(): SceneBakeInput {
    return {
        surfaces: [
            { meshFile: path.join(dir, 'floor.esmesh'), label: 'Floor', transform: IDENTITY,
              baseColor: [0.7, 0.6, 0.5], realtimeDirect: true },
            { meshFile: path.join(dir, 'roof.esmesh'), label: 'Roof', transform: IDENTITY,
              baseColorTexture: path.join(dir, 'holes.png'), material: path.join(dir, 'cutout.esmaterial'),
              twoSided: true },
        ],
        lights: LAMP,
        probeVolumes: [{ label: 'Air', center: [0, 0.5, 0], halfExtents: [2, 0.4, 2], spacing: 1 }],
        options: { atlasSize: 128, texelsPerUnit: 6, bounces: 2, samples: 16, ambient: [0.3, 0.4, 0.5] },
    } as SceneBakeInput;
}

describe('a bake split across threads', () => {
    it('writes the atlas and the probes one thread writes', async () => {
        const one = bakeSceneLightmap(scene());
        const many = await bakeSceneLightmapParallel(scene(), pool);
        expect(many.lumels).toBe(one.lumels);
        expect(many.lumels).toBeGreaterThan(pool.threads * 64);
        expect(Buffer.from(many.atlasBytes).equals(Buffer.from(one.atlasBytes))).toBe(true);
        expect(many.probes).toEqual(one.probes);
    });
});
