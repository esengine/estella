// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the engine needs a WebGPU device to be created with.
 *
 *        A feature the adapter offers is unusable until the device asked for it,
 *        and the refusal arrives late and quietly: `createTexture` throws, the
 *        asset loader logs a warning, and the frame draws the white placeholder.
 *        So every host that acquires a device asks the same question here rather
 *        than each remembering its own list.
 */

/** Optional device features the engine uses when the adapter has them. */
export const ENGINE_WEBGPU_FEATURES = [
    // Compressed textures: the cook ships KTX2, and which family a device can
    // sample decides what the transcoder targets.
    'texture-compression-astc',
    'texture-compression-bc',
    'texture-compression-etc2',
    // GPU timing for the profiler; absent, the backend reports no GPU time.
    'timestamp-query',
] as const;

/** An adapter, as far as this needs to know it. */
export interface WebGPUAdapterLike {
    readonly features?: { has(name: string): boolean };
}

/** The subset of {@link ENGINE_WEBGPU_FEATURES} this adapter actually offers. */
export function engineWebGPUFeatures(adapter: WebGPUAdapterLike): string[] {
    return ENGINE_WEBGPU_FEATURES.filter((f) => adapter.features?.has(f) ?? false);
}
