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
}

interface GpuLike {
    requestAdapter(): Promise<{
        features?: { has(name: string): boolean };
        requestDevice(descriptor?: { requiredFeatures?: string[] }): Promise<unknown>;
    } | null>;
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
        return { device };
    } catch (e) {
        return { device: null, reason: `WebGPU device request failed: ${String(e)}` };
    }
}
