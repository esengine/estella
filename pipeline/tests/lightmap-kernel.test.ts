// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The C++ bake kernel solves what the TypeScript solve does: the same
 *        rays, the same cutout hash, the same sky, to rounding — and the same
 *        answer however many threads it runs on.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodeMesh, unwrapLightmapUV, decodeLightmap, MeshChannel, MeshChannelType,
         type MeshData, type BakeLight } from 'esengine';
import { bakeSceneLightmap, bakeSceneLightmapParallel, statsOf, TO_LINEAR, type SceneBakeInput }
    from '../src/assets/lightmapBake';
import { PNG } from 'pngjs';
import { BakeKernelExecutor } from '../src/assets/lightmapKernel';
import { encodeRgbaPng } from '../src/assets/png';
import { decodeRgbaPng } from '../src/assets/tilesetExtrude';

let dir = '';
let kernel: BakeKernelExecutor;

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
    dir = await mkdtemp(path.join(tmpdir(), 'estella-kernel-'));
    await writeFile(path.join(dir, 'floor.esmesh'), encodeMesh(quad(4, 0, 1)));
    await writeFile(path.join(dir, 'roof.esmesh'), encodeMesh(quad(1.5, 1, -1)));
    await writeFile(path.join(dir, 'shelf.esmesh'), encodeMesh(quad(0.8, 0.5, 1)));
    // Closer above the floor than half a lumel: the floor's rays pass its back.
    await writeFile(path.join(dir, 'decal.esmesh'), encodeMesh(quad(2.5, 0.03, 1)));
    const holes = new Uint8Array(4 * 4 * 4).fill(200);
    for (let i = 8; i < 16; i++) holes[i * 4 + 3] = 0;
    await writeFile(path.join(dir, 'holes.png'), encodeRgbaPng(4, 4, holes));
    await writeFile(path.join(dir, 'cutout.esmaterial'), JSON.stringify(
        { version: '1.0', type: 'material', shader: 'builtin:model', properties: { u_alphaCutoff: 0.5 } }));
    kernel = await BakeKernelExecutor.load();
});

afterAll(async () => {
    await kernel?.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const LIGHTS: BakeLight[] = [
    { kind: 'point', position: [2, 3, 1], color: [1, 0.8, 0.6], intensity: 5, radius: 20 },
    { kind: 'spot', position: [-1, 2.5, -1], direction: [0.2, -1, 0.1], color: [0.4, 0.6, 1], intensity: 8,
      radius: 10, innerCos: 0.95, outerCos: 0.8 },
    { kind: 'directional', direction: [-0.4, -1, -0.3], color: [1, 0.95, 0.9], intensity: 2 },
];
const SH = Array.from({ length: 27 }, (_, i) => [0.9, 0.3, -0.2, 0.25, 0.1, -0.05, 0.08, 0.04, -0.06][Math.floor(i / 3)]!
    * [1, 0.9, 1.2][i % 3]!);

function scene(sky: boolean): SceneBakeInput {
    return {
        surfaces: [
            { meshFile: path.join(dir, 'floor.esmesh'), label: 'Floor', transform: IDENTITY,
              baseColor: [0.7, 0.6, 0.5], realtimeDirect: true },
            { meshFile: path.join(dir, 'roof.esmesh'), label: 'Roof', transform: IDENTITY,
              baseColorTexture: path.join(dir, 'holes.png'), material: path.join(dir, 'cutout.esmaterial'),
              twoSided: true },
            { meshFile: path.join(dir, 'shelf.esmesh'), label: 'Shelf', transform: IDENTITY,
              baseColor: [0.3, 0.8, 0.4] },
            { meshFile: path.join(dir, 'decal.esmesh'), label: 'Decal', transform: IDENTITY,
              baseColor: [0.9, 0.2, 0.2] },
        ],
        lights: LIGHTS,
        probeVolumes: [{ label: 'Air', center: [0, 0.5, 0], halfExtents: [2, 0.4, 2], spacing: 1 }],
        // No face size: the environment lights the gather and nothing is captured from it.
        environment: sky ? { document: { irradiance: SH }, atlasPng: new Uint8Array(0), rotation: 40 } : null,
        options: { atlasSize: 128, texelsPerUnit: 6, bounces: 2, samples: 32, ambient: [0.3, 0.4, 0.5] },
    } as SceneBakeInput;
}

function worstTexel(pngA: Uint8Array, pngB: Uint8Array): { worst: number; differing: number } {
    const a = decodeRgbaPng(pngA).rgba, b = decodeRgbaPng(pngB).rgba;
    expect(a.length).toBe(b.length);
    let worst = 0, differing = 0;
    for (let i = 0; i < a.length / 4; i++) {
        const x = decodeLightmap(a, i), y = decodeLightmap(b, i);
        let d = 0;
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(x[k]! - y[k]!) / Math.max(0.05, y[k]!));
        if (d > 0) differing++;
        worst = Math.max(worst, d);
    }
    return { worst, differing };
}

describe('the C++ bake kernel', () => {
    it('averages a texture as the TypeScript does, bit for bit', async () => {
        const w = 37, h = 23;
        const rgba = new Uint8Array(w * h * 4);
        for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 2654435761 >>> 7) & 255;
        const files: string[] = [];
        const kinds: Array<[number, number]> = [[6, 8], [2, 8], [0, 8], [4, 8], [6, 16]];
        for (const [colorType, bitDepth] of kinds) {
            const png = new PNG({ width: w, height: h });
            Buffer.from(rgba).copy(png.data);
            const file = path.join(dir, `tex-${colorType}-${bitDepth}.png`);
            await writeFile(file, PNG.sync.write(png, { colorType, bitDepth, inputHasAlpha: true } as never));
            files.push(file);
        }
        const notPng = path.join(dir, 'not.png');
        await writeFile(notPng, 'not a png');
        files.push(notPng);
        for (const cutoff of [0, 0.5, 128 / 255]) {
            const got = await kernel.textureStats(files, files.map(() => cutoff), TO_LINEAR);
            files.forEach((file, i) => {
                if (kinds[i]?.[1] === 16 || file === notPng) {
                    expect(got[i]).toBeUndefined();
                    return;
                }
                expect(got[i]).toEqual(statsOf(file, cutoff));
            });
        }
    });
    for (const sky of [false, true]) {
        it(`bakes what the TypeScript solve bakes (${sky ? 'SH' : 'flat'} sky)`, async () => {
            const ts = bakeSceneLightmap(scene(sky));
            const cpp = await bakeSceneLightmapParallel(scene(sky), kernel);
            expect(cpp.lumels).toBe(ts.lumels);
            const { worst } = worstTexel(cpp.atlasBytes, ts.atlasBytes);
            expect(worst).toBeLessThan(0.02);
            expect(cpp.probes.length).toBe(ts.probes.length);
        });
    }

    it('bakes the same bytes on one thread as on many', async () => {
        const saved = (kernel as unknown as { kernel: { threads: number } }).kernel;
        const threads = saved.threads;
        try {
            saved.threads = 1;
            const one = await bakeSceneLightmapParallel(scene(true), kernel);
            saved.threads = 5;
            const many = await bakeSceneLightmapParallel(scene(true), kernel);
            expect(Buffer.from(many.atlasBytes).equals(Buffer.from(one.atlasBytes))).toBe(true);
        } finally {
            saved.threads = threads;
        }
    });

});
