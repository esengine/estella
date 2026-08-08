// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ESEngineModule, CppRegistry } from '../wasm';
import { CoreApiBridge } from '../wasm/CoreApiBridge';
import { handleWasmError } from '../wasm/wasmError';
import { requireResourceManager } from '../wasm/resourceManager';
import { platformOnContextLost } from '../platform';
import { decodeFrameCapture, replayToDrawCall as replayToDrawCallImpl, getSnapshotImageData as getSnapshotImpl, type FrameCaptureData } from './frameCapture';

export enum RenderStage {
    Background = 0,
    Opaque = 1,
    Transparent = 2,
    Overlay = 3,
}

export const SubmitSkipFlags = {
    None: 0,
    Spine: 1,
    Particles: 2,
} as const;

export type RenderTargetHandle = number;

export interface RenderStats {
    drawCalls: number;
    triangles: number;
    sprites: number;
    text: number;
    spine: number;
    meshes: number;
    culled: number;
}

/**
 * How a frame reaches the engine. The web marshals through the wasm heap; the
 * native (embedded-Dawn) core takes the typed arrays as they are. One `Renderer`
 * façade over two backends — the shape the ResourceManager and the memory
 * provider already take — so the frame ORCHESTRATION (cameras, viewports, clear
 * flags, pre-flush draws) is one implementation on both platforms instead of one
 * per host.
 *
 * Only the frame lives here. Render targets, capture and the editor-side queries
 * remain wasm-only below, and simply do nothing on a native build until they
 * grow their own bindings.
 */
export interface RendererBackend {
    init(width: number, height: number): void;
    resize(width: number, height: number): void;
    beginFrame(elapsedSec: number): void;
    updateTransforms(registry: CppRegistry): void;
    begin(viewProjection: Float32Array, target: number, clearFlags: number,
          r: number, g: number, b: number, a: number,
          clearX: number, clearY: number, clearW: number, clearH: number): void;
    submitAll(registry: CppRegistry, skipFlags: number,
              vpX: number, vpY: number, vpW: number, vpH: number): void;
    flush(): void;
    end(): void;
    setStage(stage: number): void;
    setViewport(x: number, y: number, w: number, h: number): void;
    setYSortLayers(mask: number): void;
    setDepthLayers(mask: number): void;
    setCullingMask(mask: number): void;
    getStats(): RenderStats;
}

const NO_STATS: RenderStats = { drawCalls: 0, triangles: 0, sprites: 0, text: 0, spine: 0, meshes: 0, culled: 0 };

const bridge = new CoreApiBridge('renderer');
let module: ESEngineModule | null = null;
let viewProjectionPtr: number = 0;
let backend: RendererBackend | null = null;

/** The wasm backend: every call marshals through the module's heap, exactly as
 *  the Renderer always has. */
function wasmBackend(m: ESEngineModule): RendererBackend {
    return {
        init: (width, height) => m.renderer_init(width, height),
        resize: (width, height) => m.renderer_resize(width, height),
        beginFrame: (elapsedSec) => m.renderer_beginFrame(elapsedSec),
        updateTransforms: (registry) => {
            try {
                m.renderer_updateTransforms(registry);
            } catch (e) {
                handleWasmError(e, 'Renderer.updateTransforms');
            }
        },
        begin: (viewProjection, target, clearFlags, r, g, b, a, clearX, clearY, clearW, clearH) => {
            if (!viewProjectionPtr) return;
            try {
                m.HEAPF32.set(viewProjection, viewProjectionPtr / 4);
                m.renderer_begin(viewProjectionPtr, target, clearFlags, r, g, b, a, clearX, clearY, clearW, clearH);
            } catch (e) {
                handleWasmError(e, 'Renderer.begin');
            }
        },
        submitAll: (registry, skipFlags, vpX, vpY, vpW, vpH) => {
            try {
                m.renderer_submitAll(registry, skipFlags, vpX, vpY, vpW, vpH);
            } catch (e) {
                handleWasmError(e, 'Renderer.submitAll');
            }
        },
        flush: () => {
            try {
                m.renderer_flush();
            } catch (e) {
                handleWasmError(e, 'Renderer.flush');
            }
        },
        end: () => {
            try {
                m.renderer_end();
            } catch (e) {
                handleWasmError(e, 'Renderer.end');
            }
        },
        setStage: (stage) => m.renderer_setStage(stage),
        setViewport: (x, y, w, h) => m.renderer_setViewport(x, y, w, h),
        setYSortLayers: (mask) => m.renderer_setYSortLayers?.(mask >>> 0),
        setDepthLayers: (mask) => m.renderer_setDepthLayers?.(mask >>> 0),
        setCullingMask: (mask) => m.renderer_setCullingMask?.(mask >>> 0),
        getStats: () => ({
            drawCalls: m.renderer_getDrawCalls(),
            triangles: m.renderer_getTriangles(),
            sprites: m.renderer_getSprites(),
            text: m.renderer_getText(),
            spine: m.renderer_getSpine?.() ?? 0,
            meshes: m.renderer_getMeshes(),
            culled: m.renderer_getCulled(),
        }),
    };
}

/** GPU device status, mirroring the engine's `GfxDeviceStatus`. */
export const DeviceStatus = { Live: 0, Lost: 1, Recovering: 2, Dead: 3 } as const;

/** Why a device was lost, mirroring the engine's `GfxDeviceLostReason`. */
export const DeviceLostReason = {
    Unknown: 0, ContextLost: 1, OutOfMemory: 2, Reset: 3,
    Removed: 4, Destroyed: 5, Validation: 6, Internal: 7,
} as const;

/**
 * Whether the GPU device can still be drawn to.
 *
 * Reports `Live` when the core cannot answer — an older wasm build, or a native
 * backend with no heap to marshal. Treating "cannot tell" as a loss would black
 * out every host predating this call.
 */
export function getDeviceStatus(): number {
    return module?.deviceStatus?.() ?? DeviceStatus.Live;
}

/** The engine's one-line loss report (backend, GPU, driver, reason); empty while live. */
export function getDeviceLostReport(): string {
    return module?.deviceLostReport?.() ?? '';
}

/**
 * Tell the engine about a loss the host observed.
 *
 * The browser reports context loss to JS, not to wasm, so without this the core
 * keeps submitting until its own next poll notices.
 */
export function reportDeviceLost(reason: number, message: string): void {
    module?.notifyDeviceLost?.(reason, message);
}

/**
 * Ask the engine to rebuild the renderer after a loss.
 *
 * False means "not yet", not "never": a browser hands a WebGL context back when
 * it is ready. On success the device is Recovering — drawing, with placeholder
 * textures — until {@link finishDeviceRecovery}.
 */
export function recoverDevice(): boolean {
    return module?.recoverDevice?.() ?? false;
}

/** Ends recovery: call once the asset layer has re-uploaded the textures. */
export function finishDeviceRecovery(): void {
    module?.markDeviceRestored?.();
}

/**
 * Subscribe to the host's `GPUDevice.lost`.
 *
 * WebGPU reports loss to whoever holds the JS device object, never to the
 * engine — the page acquires it before the module exists. Reading it back off
 * the module lets ONE subscription cover every host, instead of each wiring its own.
 */
export function watchWebGPUDeviceLoss(wasmModule: ESEngineModule): void {
    const device = (wasmModule as unknown as {
        preinitializedWebGPUDevice?: { lost?: Promise<{ reason?: string; message?: string }> };
    }).preinitializedWebGPUDevice;
    void device?.lost?.then((info) => {
        // `destroyed` is us tearing the device down, not a failure.
        const reason = info?.reason === 'destroyed'
            ? DeviceLostReason.Destroyed
            : DeviceLostReason.Unknown;
        reportDeviceLost(reason, info?.message ?? 'The GPUDevice reported itself lost');
    });
}

let lossGuardInstalled = false;

/**
 * Subscribe to context loss unconditionally, at renderer init.
 *
 * The subscription is what calls preventDefault, and without that the browser
 * abandons the context for good. That decision belongs to the renderer, not to
 * whether a diagnostics plugin happens to be installed.
 */
function installContextLossGuard(): void {
    if (lossGuardInstalled) return;
    lossGuardInstalled = true;
    platformOnContextLost(() => {
        reportDeviceLost(DeviceLostReason.ContextLost, 'The host reported the rendering context was lost');
    });
}

/** @internal Wired by the engine plugins — not part of the public API. */
export function initRendererAPI(wasmModule: ESEngineModule): void {
    bridge.connect(wasmModule);
    module = bridge.module;
    installContextLossGuard();
    viewProjectionPtr = module._malloc(16 * 4);
    backend = wasmBackend(module);
}

/** @internal Install a non-wasm backend (the native host's). Mirrors
 *  {@link initRendererAPI} for a core that has no heap to marshal through. */
export function setRendererBackend(next: RendererBackend | null): void {
    backend = next;
}

export function shutdownRendererAPI(): void {
    if (module && viewProjectionPtr) {
        module._free(viewProjectionPtr);
        viewProjectionPtr = 0;
    }
    bridge.disconnect();
    module = null;
    backend = null;
}

export const Renderer = {
    init(width: number, height: number): void {
        backend?.init(width, height);
    },

    resize(width: number, height: number): void {
        backend?.resize(width, height);
    },

    beginFrame(elapsedSec = 0): void {
        backend?.beginFrame(elapsedSec);
    },

    updateTransforms(registry: { _cpp: CppRegistry }): void {
        backend?.updateTransforms(registry._cpp);
    },

    /**
     * Begins the pass. The clear rides begin as a load-op: `clearFlags` bit 0 =
     * color, bit 1 = depth; `clearColor` is the color value; `clearRect` scopes the
     * clear to a viewport region (omitted = the whole target). No flags = load.
     */
    begin(viewProjection: Float32Array, target?: RenderTargetHandle, clearFlags = 0,
          clearColor?: { x: number; y: number; z: number; w: number },
          clearRect?: { x: number; y: number; w: number; h: number }): void {
        backend?.begin(viewProjection, target ?? 0, clearFlags,
            clearColor?.x ?? 0, clearColor?.y ?? 0, clearColor?.z ?? 0, clearColor?.w ?? 1,
            clearRect?.x ?? 0, clearRect?.y ?? 0, clearRect?.w ?? 0, clearRect?.h ?? 0);
    },

    flush(): void {
        backend?.flush();
    },

    end(): void {
        backend?.end();
    },

    submitAll(registry: { _cpp: CppRegistry }, skipFlags: number, vpX: number, vpY: number, vpW: number, vpH: number): void {
        backend?.submitAll(registry._cpp, skipFlags, vpX, vpY, vpW, vpH);
    },

    setStage(stage: RenderStage): void {
        backend?.setStage(stage);
    },

    createRenderTarget(width: number, height: number, flags: number = 1): RenderTargetHandle {
        return module?.renderer_createTarget(width, height, flags) ?? 0;
    },

    releaseRenderTarget(handle: RenderTargetHandle): void {
        module?.renderer_releaseTarget(handle);
    },

    getTargetTexture(handle: RenderTargetHandle): number {
        return module?.renderer_getTargetTexture(handle) ?? 0;
    },

    getTargetDepthTexture(handle: RenderTargetHandle): number {
        return module?.renderer_getTargetDepthTexture(handle) ?? 0;
    },

    setClearColor(r: number, g: number, b: number, a: number): void {
        module?.renderer_setClearColor?.(r, g, b, a);
    },

    setViewport(x: number, y: number, w: number, h: number): void {
        backend?.setViewport(x, y, w, h);
    },

    /** Layers (bits 0..31) that sort by world Y within the layer — top-down occlusion. */
    setYSortLayers(mask: number): void {
        backend?.setYSortLayers(mask);
    },

    /**
     * Layers (bits 0..31) that resolve their contents by the depth buffer instead
     * of paint order — the 2.5D opt-in. Opaque draws (blend mode None) in such a
     * layer write depth and occlude whatever is behind them whatever order they
     * were drawn in; blended ones test without writing and stay back-to-front. A
     * layer that also y-sorts keeps y-sorting (see `layerOrderOf`).
     *
     * The live twin of the `depthLayers` app option, so an editor can apply the
     * project setting to a running view without rebooting the realm.
     */
    setDepthLayers(mask: number): void {
        backend?.setDepthLayers(mask);
    },

    /**
     * Sorting layers (bits 0..31) the NEXT collect draws — `Camera.cullingMask`.
     * Set per camera before submitting it; a layer with no bit (outside 0..31) is
     * drawn by every camera.
     */
    setCullingMask(mask: number): void {
        backend?.setCullingMask(mask);
    },

    setTextureParams(textureId: number, minFilter: number, magFilter: number, wrapS: number, wrapT: number): void {
        module?.renderer_setTextureParams?.(textureId, minFilter, magFilter, wrapS, wrapT);
    },

    measureBitmapText(fontHandle: number, text: string, fontSize: number, spacing: number): { width: number; height: number } {
        if (!module) return { width: 0, height: 0 };
        return requireResourceManager().measureBitmapText(fontHandle, text, fontSize, spacing);
    },

    getStats(): RenderStats {
        return backend?.getStats() ?? NO_STATS;
    },

    captureNextFrame(): void {
        module?.renderer_captureNextFrame();
    },

    getCapturedData(): FrameCaptureData | null {
        if (!module) return null;
        return decodeFrameCapture(module);
    },

    hasCapturedData(): boolean {
        return module?.renderer_hasCapturedData() ?? false;
    },

    replayToDrawCall(drawCallIndex: number): void {
        if (!module) return;
        replayToDrawCallImpl(module, drawCallIndex);
    },

    /** Resolves with the replay snapshot once its async readback lands (see frameCapture). */
    getSnapshotImageData(): Promise<ImageData | null> {
        if (!module) return Promise.resolve(null);
        return getSnapshotImpl(module);
    },
};
