// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, GraphicsPath, RenderSurfaceSource } from './app';
import type { PlatformCanvas } from '../platform/types';
import type { ESEngineModule } from '../wasm';

type ViewportSize = () => { width: number; height: number };
interface AppSurface {
    graphics?: GraphicsPath | null;
    canvas?: PlatformCanvas;
    size?: ViewportSize;
}
const surfaces = new WeakMap<App, AppSurface>();

export function graphicsPathFor(surface: RenderSurfaceSource): GraphicsPath | null {
    switch (surface.kind) {
        case 'threaded-webgpu':
        case 'webgpu': return 'WebGPU';
        case 'threaded-webgl2': return 'WebGL2';
        case 'gl-context': return surface.glx ? 'EmscriptenGLX' : 'WebGL2';
        case 'default': return null;
    }
}

function canvasForSurface(module: ESEngineModule, surface: RenderSurfaceSource): PlatformCanvas | undefined {
    if (surface.kind === 'gl-context') {
        return module.GL?.contexts?.[surface.handle]?.GLctx.canvas
            ?? module.GL?.currentContext?.GLctx.canvas ?? module.canvas;
    }
    if (surface.kind === 'default' && module.GL?.currentContext?.GLctx.canvas) {
        return module.GL.currentContext.GLctx.canvas;
    }
    // WebGPU configures the swapchain by selector. A threaded renderer transfers
    // the backing store but the original #canvas still receives the DOM events.
    const selector = surface.kind === 'webgpu' ? surface.canvasSelector ?? '#canvas' : '#canvas';
    return globalThis.document?.querySelector?.<HTMLCanvasElement>(selector) ?? module.canvas;
}

export function bindRenderSurface(app: App, module: ESEngineModule, surface: RenderSurfaceSource, size?: ViewportSize): void {
    surfaces.set(app, { graphics: graphicsPathFor(surface), canvas: canvasForSurface(module, surface), size });
}

export function renderCanvasOf(app: App): PlatformCanvas | undefined {
    return surfaces.get(app)?.canvas;
}

/** Null when the module resolved its own graphics path. */
export function graphicsPathOf(app: App): GraphicsPath | null {
    return surfaces.get(app)?.graphics ?? null;
}

/** Hosts such as the native core supply the drawable size after construction. */
export function setAppSurfaceSize(app: App, size: ViewportSize): void {
    surfaces.set(app, { ...surfaces.get(app), size });
}

export function surfaceSizeOf(app: App): ReturnType<ViewportSize> | null {
    return surfaces.get(app)?.size?.() ?? null;
}
