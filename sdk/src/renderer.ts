import type { ESEngineModule, CppRegistry } from './wasm';

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
        module.HEAPF32.set(viewProjection, viewProjectionPtr / 4);
        module.renderer_begin(viewProjectionPtr, target ?? 0);
    },

    flush(): void {
        module?.renderer_flush();
    },

    end(): void {
        module?.renderer_end();
    },

    submitSprites(registry: { _cpp: CppRegistry }): void {
        if (!module) return;
        module.renderer_submitSprites(registry._cpp);
    },

    submitSpine(registry: { _cpp: CppRegistry }): void {
        if (!module) return;
        module.renderer_submitSpine(registry._cpp);
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

    getStats(): RenderStats {
        if (!module) {
            return { drawCalls: 0, triangles: 0, sprites: 0, spine: 0, meshes: 0, culled: 0 };
        }
        return {
            drawCalls: module.renderer_getDrawCalls(),
            triangles: module.renderer_getTriangles(),
            sprites: module.renderer_getSprites(),
            spine: module.renderer_getSpine(),
            meshes: module.renderer_getMeshes(),
            culled: module.renderer_getCulled(),
        };
    },
};
