// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    probeLayout.ts
 * @brief   How a loaded probe volume is laid out, read back from the engine: what an editor draws when it shows where a
 *          sparse bake put its fine bricks and where it left the air coarse.
 */
import { withScratch, type WasmAllocator } from '../wasm/wasmScratch';

/** A probe volume as the engine holds it. @experimental */
export interface ProbeVolumeLayout {
    /** The finest grid's probes along x, y and z. */
    resolution: [number, number, number];
    /** A sparse volume's bricks, four ints each: the first finest-brick cell x, y, z (4 cells a side) and the span in those
     *  cells (1 for the finest, 2, 4 or 8 coarser). Null for a dense volume, every probe at the finest spacing. */
    bricks: Int32Array | null;
    /** Bricks the volume has, which is more than `bricks` holds when `maxBricks` cut it short. */
    brickCount: number;
}

interface ProbeLayoutModule extends WasmAllocator {
    HEAPU8: Uint8Array;
    probe_volume_getResolution?(volumeHandle: number, outPtr: number): boolean;
    probe_volume_getBricks?(volumeHandle: number, outPtr: number, maxBricks: number): number;
}

/**
 * The layout of the probe volume `handle` names (a `LightProbeVolume.probes` handle), or null when there is no such
 * volume or the engine cannot say. At most `maxBricks` bricks are read.
 *
 * @experimental
 */
export function probeVolumeLayout(module: ProbeLayoutModule | null | undefined, handle: number,
                                  maxBricks = 4096): ProbeVolumeLayout | null {
    if (!module?.probe_volume_getResolution || !module.probe_volume_getBricks || !handle) return null;
    return withScratch(module, (alloc) => {
        const resPtr = alloc(12);
        if (!module.probe_volume_getResolution!(handle, resPtr)) return null;
        const res = new Int32Array(module.HEAPU8.buffer, resPtr, 3);
        const resolution: [number, number, number] = [res[0]!, res[1]!, res[2]!];
        const take = Math.max(0, Math.floor(maxBricks));
        const bricksPtr = alloc(Math.max(4, take * 16));
        const brickCount = module.probe_volume_getBricks!(handle, bricksPtr, take);
        if (brickCount <= 0) return { resolution, bricks: null, brickCount: 0 };
        const bricks = new Int32Array(module.HEAPU8.buffer, bricksPtr, Math.min(brickCount, take) * 4).slice();
        return { resolution, bricks, brickCount };
    });
}
