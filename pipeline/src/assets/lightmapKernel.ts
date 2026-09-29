// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    lightmapKernel.ts
 * @brief   A bake's passes run by the C++ kernel (tools/lightmap-wasm): the same
 *          rules as the TypeScript solve, on every core, with a tree built for
 *          tracing rather than for building quickly.
 */

import { SH_COSINE_BAND, type BakeLight, type BakeScene, type BakeStep } from 'esengine';
import type { BakeKernel } from '../../../build-tools/lightmap/kernel.mjs';
import { readFile } from 'node:fs/promises';
import type { BakeExecutor, TextureStats } from './lightmapBake';

const LIGHT_DOUBLES = 16;
const SKY_DOUBLES = 36;
const TEXTURE_BATCH = 16;
const LIGHT_KIND = { directional: 0, point: 1, spot: 2 } as const;

export function packLights(lights: readonly BakeLight[]): Float64Array<ArrayBuffer> {
    const out = new Float64Array(Math.max(1, lights.length) * LIGHT_DOUBLES);
    lights.forEach((l, i) => {
        const at = i * LIGHT_DOUBLES;
        const p = l.position ?? [0, 0, 0];
        const d = l.direction ?? [0, 0, -1];
        out.set([LIGHT_KIND[l.kind], p[0], p[1], p[2], d[0], d[1], d[2], l.color[0], l.color[1], l.color[2],
                 0, l.intensity, l.radius ?? 0, l.innerCos ?? 0.9, l.outerCos ?? 0.7, 0], at);
    });
    return out;
}

export function packSky(sky: BakeScene['sky']): Float64Array<ArrayBuffer> {
    if (typeof sky === 'function') {
        throw new Error('BakeKernelExecutor: the kernel needs the sky as a SkySpec');
    }
    const out = new Float64Array(SKY_DOUBLES);
    if (sky.kind === 'flat') {
        out.set([0, sky.rgb[0], sky.rgb[1], sky.rgb[2]]);
        return out;
    }
    out.set([1, 0, 0, 0, sky.yaw, sky.tint[0], sky.tint[1], sky.tint[2]]);
    // Rounded to float first, as skyRadiance holds them.
    const radiance = Float32Array.from(sky.irradiance.slice(0, 27),
        (v, i) => v / SH_COSINE_BAND[Math.floor(i / 3)]!);
    out.set(radiance, 8);
    return out;
}

export class BakeKernelExecutor implements BakeExecutor {
    private scene: BakeScene | null = null;
    private lights = new Float64Array(0);
    private sky = new Float64Array(0);

    constructor(private readonly kernel: BakeKernel) {}

    static async load(): Promise<BakeKernelExecutor> {
        const { loadBakeKernel } = await import('../../../build-tools/lightmap/kernel.mjs');
        return new BakeKernelExecutor(await loadBakeKernel());
    }

    get threads(): number { return this.kernel.threads; }

    async run({ scene, job }: BakeStep): Promise<void> {
        if (scene !== this.scene) {
            const { lookup, lumels } = scene;
            const { tris } = scene;
            this.kernel.scene({
                positions: tris.positions.subarray(0, tris.count * 9), triCount: tris.count,
                triUV: lookup.triUV, triSurface: lookup.triSurface, patch: lookup.patch,
                albedo: lookup.albedo, triNormal: lookup.triNormal, twoSided: lookup.twoSided,
                coverage: lookup.coverage, backReach: lookup.backReach,
                lumelPosition: lumels.position.subarray(0, lumels.count * 3),
                lumelNormal: lumels.normal.subarray(0, lumels.count * 3), lumelCount: lumels.count,
            });
            this.lights = packLights(scene.lights);
            this.sky = packSky(scene.sky);
            this.scene = scene;
        }
        const out = job.out.subarray(0, scene.lumels.count * 3);
        if (job.kind === 'direct') this.kernel.direct(this.lights, scene.lights.length, out);
        else this.kernel.gather(job.atlas, scene.atlasSize, scene.samples, this.sky, out);
    }

    async textureStats(files: readonly string[], cutoffs: readonly number[], toLinear: Float64Array):
        Promise<Array<TextureStats | null | undefined>> {
        const out: Array<TextureStats | null | undefined> = [];
        // Read and decoded a batch at a time: a town's textures are gigabytes decoded.
        for (let from = 0; from < files.length; from += TEXTURE_BATCH) {
            const names = files.slice(from, from + TEXTURE_BATCH);
            const bytes = await Promise.all(names.map((f) => readFile(f).then((b) => new Uint8Array(b), () => null)));
            const readable = bytes.flatMap((b, i) => (b ? [i] : []));
            const stats = this.kernel.textureStats(readable.map((i) => bytes[i]!),
                                                   readable.map((i) => cutoffs[from + i]!), toLinear);
            const solved: Array<TextureStats | null | undefined> = names.map(() => undefined);
            readable.forEach((i, k) => {
                const at = k * 5;
                if (stats[at] === 1) {
                    solved[i] = { mean: [stats[at + 1]!, stats[at + 2]!, stats[at + 3]!], coverage: stats[at + 4]! };
                } else if (stats[at] === 2) {
                    solved[i] = null;
                }
            });
            out.push(...solved);
        }
        return out;
    }

    async close(): Promise<void> {
        this.kernel.release();
        this.scene = null;
    }
}
