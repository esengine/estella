// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Getting a WebGPU device before the module exists.
 *
 *        The wasm side reads `Module.preinitializedWebGPUDevice` synchronously,
 *        so the device has to be acquired first — and acquiring it is the same
 *        four steps wherever a host boots the engine: is it asked for, is there
 *        an adapter, which optional features does it offer, and where do its
 *        validation errors go. A host that writes those out itself gets a
 *        different subset right, and the ones it misses surface as a texture
 *        that never loaded or a pass that silently drew nothing.
 */
import { engineWebGPUFeatures } from './webgpuFeatures';

/** What a project asks for. `auto` takes WebGPU where the machine has it. */
export type RenderBackendRequest = 'webgl2' | 'webgpu' | 'auto';

/** The device, plus what it took to get one. `device` null ⇒ boot WebGL2. */
export interface WebGPUBootResult {
    device: unknown | null;
    /** Why WebGPU was not used, for a host that wants to say so. */
    reason?: string;
    /**
     * Which adapter served the device. An unrecognized `--use-webgpu-adapter` is
     * ignored in silence, so this is the only thing that says whether hardware or
     * a software rasterizer drew the frame.
     */
    adapter?: string;
}

interface AdapterInfo {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
}

interface GpuLike {
    requestAdapter(): Promise<{
        features?: { has(name: string): boolean };
        info?: AdapterInfo;
        isFallbackAdapter?: boolean;
        requestDevice(descriptor?: { requiredFeatures?: string[] }): Promise<unknown>;
    } | null>;
}

function describeAdapter(adapter: {
    info?: AdapterInfo; isFallbackAdapter?: boolean;
}): string {
    const info = adapter.info ?? {};
    const named = [info.vendor, info.architecture, info.device].filter(Boolean).join(' ');
    const kind = adapter.isFallbackAdapter ? 'fallback' : 'default';
    return `${named || info.description || 'unnamed adapter'} (${kind})`;
}

const gpuOf = (): GpuLike | undefined =>
    (globalThis.navigator as unknown as { gpu?: GpuLike } | undefined)?.gpu;

/**
 * A device for `requested`, or null to fall back to WebGL2 — a project that asks
 * for WebGPU still runs on a browser without it, which is the only behaviour a
 * shipped game can have. `onError` takes Dawn's uncaptured validation messages,
 * which are dropped in silence without a listener.
 *
 * @beta
 */
export async function acquireWebGPUDevice(
    requested: RenderBackendRequest,
    onError?: (message: string) => void,
): Promise<WebGPUBootResult> {
    if (requested === 'webgl2') return { device: null };

    const gpu = gpuOf();
    if (!gpu) return { device: null, reason: 'navigator.gpu is unavailable' };

    try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) return { device: null, reason: 'no WebGPU adapter' };
        const requiredFeatures = engineWebGPUFeatures(adapter);
        const device = await adapter.requestDevice(
            requiredFeatures.length ? { requiredFeatures } : undefined);
        if (onError) {
            (device as { addEventListener?(t: string, fn: (e: unknown) => void): void })
                .addEventListener?.('uncapturederror', (e) => {
                    const msg = (e as { error?: { message?: string } }).error?.message;
                    onError(`[webgpu] uncaptured error: ${msg ?? String(e)}`);
                });
        }
        return { device, adapter: describeAdapter(adapter) };
    } catch (e) {
        return { device: null, reason: `WebGPU device request failed: ${String(e)}` };
    }
}
