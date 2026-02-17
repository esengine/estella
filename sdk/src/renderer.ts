import type { ESEngineModule, CppRegistry } from './wasm';
import { handleWasmError } from './wasmError';

export enum RenderStage {
    Background = 0,
    Opaque = 1,
    Transparent = 2,
    Overlay = 3,
}

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

let module: ESEngineModule | null = null;
let viewProjectionPtr: number = 0;

export function initRendererAPI(wasmModule: ESEngineModule): void {
    module = wasmModule;
    viewProjectionPtr = module._malloc(16 * 4);
}

export function shutdownRendererAPI(): void {
    if (module && viewProjectionPtr) {
        module._free(viewProjectionPtr);
        viewProjectionPtr = 0;
    }
    module = null;
}

export const Renderer = {
    init(width: number, height: number): void {
        module?.renderer_init(width, height);
    },

    resize(width: number, height: number): void {
        module?.renderer_resize(width, height);
    },

    begin(viewProjection: Float32Array, target?: RenderTargetHandle): void {
        if (!module || !viewProjectionPtr) return;
        try {
            module.HEAPF32.set(viewProjection, viewProjectionPtr / 4);
            module.renderer_begin(viewProjectionPtr, target ?? 0);
        } catch (e) {
            handleWasmError(e, 'Renderer.begin');
        }
    },

    flush(): void {
        try {
            module?.renderer_flush();
        } catch (e) {
            handleWasmError(e, 'Renderer.flush');
        }
    },

    end(): void {
        try {
            module?.renderer_end();
        } catch (e) {
            handleWasmError(e, 'Renderer.end');
        }
    },

    submitSprites(registry: { _cpp: CppRegistry }): void {
        if (!module) return;
        try {
            module.renderer_submitSprites(registry._cpp);
        } catch (e) {
            handleWasmError(e, 'Renderer.submitSprites');
        }
    },

    submitBitmapText(registry: { _cpp: CppRegistry }): void {
        if (!module) return;
        try {
            module.renderer_submitBitmapText(registry._cpp);
        } catch (e) {
            handleWasmError(e, 'Renderer.submitBitmapText');
        }
    },

    submitSpine(registry: { _cpp: CppRegistry }): void {
        if (!module) return;
        try {
            module.renderer_submitSpine?.(registry._cpp);
        } catch (e) {
            handleWasmError(e, 'Renderer.submitSpine');
        }
    },

    setStage(stage: RenderStage): void {
        module?.renderer_setStage(stage);
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
        module?.renderer_setViewport(x, y, w, h);
    },

    setScissor(x: number, y: number, w: number, h: number, enable: boolean): void {
        module?.renderer_setScissor(x, y, w, h, enable);
    },

    clearBuffers(flags: number): void {
        module?.renderer_clearBuffers(flags);
    },

    measureBitmapText(fontHandle: number, text: string, fontSize: number, spacing: number): { width: number; height: number } {
        if (!module) return { width: 0, height: 0 };
        return module.getResourceManager().measureBitmapText(fontHandle, text, fontSize, spacing);
    },

    getStats(): RenderStats {
        if (!module) {
            return { drawCalls: 0, triangles: 0, sprites: 0, text: 0, spine: 0, meshes: 0, culled: 0 };
        }
        return {
            drawCalls: module.renderer_getDrawCalls(),
            triangles: module.renderer_getTriangles(),
            sprites: module.renderer_getSprites(),
            text: module.renderer_getText(),
            spine: module.renderer_getSpine?.() ?? 0,
            meshes: module.renderer_getMeshes(),
            culled: module.renderer_getCulled(),
        };
    },
};
