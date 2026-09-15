// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetLoader, LoadContext } from '../AssetLoader';
import type { EngineApi } from '../../ecs/bridge/engineApi';
import { marshallingCore } from './engineCore';
import { withScratch } from '../../wasm/wasmScratch';

/** The `.esprobes` document, as a bake wrote it. */
interface ProbeVolumeAssetData {
    version: number;
    /** Probes along x, y and z. */
    resolution: [number, number, number];
    /** Nine RGB coefficients per probe, x fastest then y then z. */
    irradiance: number[];
}

/** A baked probe grid, named by the handle a LightProbeVolume references. */
export interface ProbeVolumeResult {
    handle: number;
}

/**
 * Loads `.esprobes` — irradiance solved at a grid of points.
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
        const text = await ctx.loadText(ctx.catalog.getBuildPath(path));
        const data = JSON.parse(text) as ProbeVolumeAssetData;
        const res = data.resolution;
        if (!Array.isArray(res) || res.length !== 3 || res.some((n) => !Number.isInteger(n) || n < 1)) {
            throw new Error(`${path}: a probe volume is three positive probe counts, got `
                + `${JSON.stringify(data.resolution)}`);
        }
        const want = res[0] * res[1] * res[2] * 27;
        if (!Array.isArray(data.irradiance) || data.irradiance.length !== want) {
            throw new Error(`${path}: ${res[0]}x${res[1]}x${res[2]} probes want ${want} `
                + `coefficients, got ${data.irradiance?.length ?? 0}`);
        }
        const m = marshallingCore(this.core_());
        if (!m?.probe_volume_create) {
            throw new Error('this engine build carries no probe_volume_create');
        }

        const handle = withScratch(m, (alloc) => {
            const shPtr = alloc(want * 4);
            m.HEAPF32.set(Float32Array.from(data.irradiance), shPtr >> 2);
            return m.probe_volume_create!(res[0], res[1], res[2], shPtr);
        });

        if (!handle) {
            throw new Error(`the engine rejected the probe volume in ${path}`);
        }
        return { handle };
    }

    unload(asset: ProbeVolumeResult): void {
        this.core_()?.probe_volume_release?.(asset.handle);
    }
}
