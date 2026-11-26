// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, GraphicsPath, RenderSurfaceSource } from './app';
import type { PlatformCanvas } from '../platform/types';
import type { ESEngineModule } from '../wasm';

type ViewportSize = () => { width: number; height: number };
type CanvasModule = Partial<Pick<ESEngineModule, 'GL' | 'canvas'>>;
interface AppSurface {
    graphics?: GraphicsPath | null;
    canvas?: PlatformCanvas;
    size?: ViewportSize;
}
const surfaces = new WeakMap<App, AppSurface>();
interface BoundSurface extends AppSurface { signal: AbortSignal }
interface SurfaceRef { deref(): BoundSurface | undefined }
const WeakSurface = (globalThis as { WeakRef?: new (surface: BoundSurface) => SurfaceRef }).WeakRef;
const liveSurfaces: SurfaceRef[] = [];

/** An unscoped call uses the newest live renderer. Keeping the lookup alive
 *  must not retain an abandoned browser App or its WebGL context. */
export function currentRenderSurface(): BoundSurface | undefined {
    while (liveSurfaces.length) {
        const surface = liveSurfaces[liveSurfaces.length - 1].deref();
        if (surface) return surface;
        liveSurfaces.pop();
    }
    return undefined;
}

export function graphicsPathFor(surface: RenderSurfaceSource): GraphicsPath | null {
    switch (surface.kind) {
        case 'threaded-webgpu':
        case 'webgpu': return 'WebGPU';
        case 'threaded-webgl2': return 'WebGL2';
        case 'gl-context': return surface.glx ? 'EmscriptenGLX' : 'WebGL2';
        case 'default': return null;
    }
}

function canvasForSurface(module: CanvasModule, surface: RenderSurfaceSource): PlatformCanvas | undefined {
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

export function bindRenderSurface(app: App, module: CanvasModule, surface: RenderSurfaceSource, size?: ViewportSize): void {
    const bound: BoundSurface = { graphics: graphicsPathFor(surface), canvas: canvasForSurface(module, surface), size, signal: app.signal };
    surfaces.set(app, bound);
    const ref = WeakSurface ? new WeakSurface(bound) : { deref: () => bound };
    liveSurfaces.push(ref);
    bound.signal.addEventListener('abort', () => {
        liveSurfaces.splice(liveSurfaces.indexOf(ref), 1);
        surfaces.delete(app);
    }, { once: true });
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
    const surface = surfaces.get(app);
    if (surface) surface.size = size;
    else surfaces.set(app, { size });
}

export function surfaceSizeOf(app: App): ReturnType<ViewportSize> | null {
    return surfaces.get(app)?.size?.() ?? null;
}
