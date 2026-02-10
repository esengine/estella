/**
 * @file    SpineModuleLoader.ts
 * @brief   Loads and initializes the standalone Spine WASM module
 */

export interface SpineWasmModule {
    spine_loadSkeleton(skelPath: string, atlasText: string, atlasLen: number, isBinary: boolean): number;
    spine_unloadSkeleton(handle: number): void;
    spine_getAtlasPageCount(handle: number): number;
    spine_getAtlasPageTextureName(handle: number, pageIndex: number): string;
    spine_setAtlasPageTexture(handle: number, pageIndex: number, textureId: number, width: number, height: number): void;

    spine_createInstance(skeletonHandle: number): number;
    spine_destroyInstance(instanceId: number): void;

    spine_playAnimation(instanceId: number, name: string, loop: boolean, track: number): boolean;
    spine_addAnimation(instanceId: number, name: string, loop: boolean, delay: number, track: number): boolean;
    spine_setSkin(instanceId: number, name: string): void;
    spine_update(instanceId: number, dt: number): void;

    spine_getAnimations(instanceId: number): string;
    spine_getSkins(instanceId: number): string;
    spine_getBonePosition(instanceId: number, bone: string, outXPtr: number, outYPtr: number): boolean;
    spine_getBoneRotation(instanceId: number, bone: string): number;
    spine_getBounds(instanceId: number, outXPtr: number, outYPtr: number, outWPtr: number, outHPtr: number): void;

    spine_getMeshBatchCount(instanceId: number): number;
    spine_getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    spine_getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    spine_getMeshBatchData(instanceId: number, batchIndex: number,
        outVerticesPtr: number, outIndicesPtr: number,
        outTextureIdPtr: number, outBlendModePtr: number): void;

    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;

    FS: {
        writeFile(path: string, data: string | Uint8Array): void;
        mkdirTree(path: string): void;
        analyzePath(path: string): { exists: boolean };
    };
}

export type SpineModuleFactory = (config?: Record<string, unknown>) => Promise<SpineWasmModule>;

export async function loadSpineModule(
    wasmUrl: string,
    factory?: SpineModuleFactory
): Promise<SpineWasmModule> {
    if (factory) {
        return factory();
    }

    const moduleFactory = (await import(/* webpackIgnore: true */ wasmUrl)).default as SpineModuleFactory;
    return moduleFactory();
}
