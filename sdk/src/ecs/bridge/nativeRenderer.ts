// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The native RendererBackend — the embedded-Dawn sibling of the wasm renderer
// bindings the SDK's frame runs on.
//
// Before this, the native host wrote its own frame in C++: one hard-coded
// orthographic projection, collect, flush, present. Everything the SDK decides
// about a frame — which cameras exist, their viewport rects, clear flags and
// ortho size, y-sort layers, which scenes are active, what draws just before the
// flush — lived only on the web side, so each of those had to be re-implemented
// natively or go missing.
//
// The frame is now ONE implementation (CameraPlugin -> RenderPipeline ->
// Renderer) over two backends: the wasm module marshals through its heap, this
// one calls the host's es_renderer_* bindings with the typed arrays as they are.
// The C++ host keeps what only it can do: the swapchain and the present.

import type { CppRegistry } from '../../wasm';
import type { RendererBackend, RenderStats } from '../../render/renderer';
import { RENDERER_BINDINGS, RENDERER_OPTIONAL_BINDINGS, RENDERER_STATS_BINDINGS } from './nativeBindings';

/** Invoke a host-provided global by name; throws if the host did not bind it
 *  (these are the frame contract — a missing one is a broken host, not a
 *  degraded frame). */
function hostCall(scope: Record<string, unknown>, name: string, args: unknown[]): unknown {
    const fn = scope[name];
    if (typeof fn !== 'function') {
        throw new Error(`native host binding "${name}" is missing`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
}

/**
 * Build the RendererBackend over the host's frame bindings. `scope` holds the
 * globals (the QuickJS global object on a device; a plain object in tests).
 *
 * The registry argument every wasm call carries is implicit here: a native host
 * has exactly one C++ registry, the one it created the World over, so the
 * bindings take none.
 */
export function createNativeRendererBackend(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): RendererBackend {
    return {
        // The renderer is already up: the host created the device and sized the
        // surface before the SDK booted. Resizing still matters (rotation).
        init: (): void => {},
        resize: (width, height): void => {
            hostCall(scope, RENDERER_BINDINGS.resize, [width, height]);
        },
        beginFrame: (elapsedSec): void => {
            hostCall(scope, RENDERER_BINDINGS.beginFrame, [elapsedSec]);
        },
        updateTransforms: (_registry: CppRegistry): void => {
            hostCall(scope, RENDERER_BINDINGS.updateTransforms, []);
        },
        begin: (viewProjection, target, clearFlags, r, g, b, a, clearX, clearY, clearW, clearH): void => {
            hostCall(scope, RENDERER_BINDINGS.begin,
                [viewProjection, target, clearFlags, r, g, b, a, clearX, clearY, clearW, clearH]);
        },
        submitAll: (_registry: CppRegistry, skipFlags, vpX, vpY, vpW, vpH): void => {
            hostCall(scope, RENDERER_BINDINGS.submitAll, [skipFlags, vpX, vpY, vpW, vpH]);
        },
        flush: (): void => {
            hostCall(scope, RENDERER_BINDINGS.flush, []);
        },
        end: (): void => {
            hostCall(scope, RENDERER_BINDINGS.end, []);
        },
        setStage: (stage): void => {
            hostCall(scope, RENDERER_BINDINGS.setStage, [stage]);
        },
        setViewport: (x, y, w, h): void => {
            hostCall(scope, RENDERER_BINDINGS.setViewport, [x, y, w, h]);
        },
        setYSortLayers: (mask): void => {
            hostCall(scope, RENDERER_BINDINGS.setYSortLayers, [mask >>> 0]);
        },
        // Optional (RENDERER_OPTIONAL_BINDINGS): a host built before 2.5D simply
        // stays painter-ordered rather than failing the whole frame contract.
        setDepthLayers: (mask): void => {
            const fn = scope[RENDERER_OPTIONAL_BINDINGS.setDepthLayers];
            if (typeof fn === 'function') (fn as (m: number) => void)(mask >>> 0);
        },
        getStats: (): RenderStats => {
            const read = (name: string): number => {
                const fn = scope[name];
                return typeof fn === 'function' ? ((fn as () => number)() ?? 0) : 0;
            };
            return {
                drawCalls: read(RENDERER_STATS_BINDINGS.drawCalls),
                triangles: read(RENDERER_STATS_BINDINGS.triangles),
                sprites: read(RENDERER_STATS_BINDINGS.sprites),
                text: read(RENDERER_STATS_BINDINGS.text),
                spine: 0,   // the spine module has no native counterpart yet
                meshes: read(RENDERER_STATS_BINDINGS.meshes),
                culled: read(RENDERER_STATS_BINDINGS.culled),
            };
        },
    };
}

/**
 * The drawable surface in pixels, as the host currently sees it. The camera
 * plugin reads it every frame, so a rotation or a resized window reaches the
 * projection without anyone pushing an event.
 */
export function nativeSurfaceSize(
    scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): { width: number; height: number } {
    const size = hostCall(scope, RENDERER_BINDINGS.surfaceSize, []) as
        { width: number; height: number } | undefined;
    return size ?? { width: 0, height: 0 };
}
