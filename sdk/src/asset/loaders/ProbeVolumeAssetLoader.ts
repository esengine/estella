// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { marshallingCore } from './engineCore';
import { withScratch } from '../../wasm/wasmScratch';
import { decodeProbeFile } from '../../lightmap/probeFile';

/** A baked probe grid, named by the handle a LightProbeVolume references. */
export interface ProbeVolumeResult {
    handle: number;
}

/**
 * Loads `.esprobes` — irradiance solved at a grid of points (see lightmap/probeFile for the file).
 *
 * The same nine coefficients an `.esenv` carries, at every probe instead of once:
 * an environment is this field held constant. Where the grid stands is NOT here —
 * the component's box says that, so one bake can be read at a second placement.
 */
export class ProbeVolumeAssetLoader implements AssetLoader<ProbeVolumeResult> {
    readonly type = 'probeVolume';
    readonly extensions = ['.esprobes'];

    /** Lazy like the environment loader's: the module arrives after construction. */
    constructor(private readonly core_: () => EngineApi | null) {}

    async load(path: string, ctx: LoadContext): Promise<ProbeVolumeResult> {
        // Version 2 is binary and version 1 JSON; decodeProbeFile tells them apart, checks the counts and refuses a
        // version it does not know.
        const bytes = new Uint8Array(await ctx.loadBinary(ctx.catalog.getBuildPath(path)));
        const data = decodeProbeFile(bytes, path);
        const res = data.resolution;
        const want = res[0] * res[1] * res[2] * 27;
        const m = marshallingCore(this.core_());
        if (!m?.probe_volume_create) {
            throw new Error('this engine build carries no probe_volume_create');
        }

        const handle = withScratch(m, (alloc) => {
            const shPtr = alloc(want * 4);
            m.HEAPF32.set(data.irradiance as Float32Array, shPtr >> 2);
            return m.probe_volume_create!(res[0], res[1], res[2], shPtr);
        });

        if (!handle) {
            throw new Error(`the engine rejected the probe volume in ${path}`);
        }
        if (data.skyVisibility !== undefined) {
            const visibility = data.skyVisibility as Float32Array;
            const count = res[0] * res[1] * res[2] * 9;
            if (!m.probe_volume_setSkyVisibility) {
                throw new Error(`${path} is baked with sky occlusion, which this engine build cannot read`);
            }
            withScratch(m, (alloc) => {
                const ptr = alloc(count * 4);
                m.HEAPF32.set(visibility, ptr >> 2);
                m.probe_volume_setSkyVisibility!(handle, ptr);
            });
        }
        return { handle };
    }

    unload(asset: ProbeVolumeResult): void {
        this.core_()?.probe_volume_release?.(asset.handle);
    }
}
