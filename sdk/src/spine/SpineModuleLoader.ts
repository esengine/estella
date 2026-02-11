/**
 * @file    SpineModuleLoader.ts
 * @brief   Loads and initializes the standalone Spine WASM module
 */

export interface SpineWasmModule {
    _spine_loadSkeleton(skelDataPtr: number, skelDataLen: number, atlasText: number, atlasLen: number, isBinary: number): number;
    _spine_unloadSkeleton(handle: number): void;
    _spine_getAtlasPageCount(handle: number): number;
    _spine_getAtlasPageTextureName(handle: number, pageIndex: number): number;
    _spine_setAtlasPageTexture(handle: number, pageIndex: number, textureId: number, width: number, height: number): void;

    _spine_createInstance(skeletonHandle: number): number;
    _spine_destroyInstance(instanceId: number): void;

    _spine_playAnimation(instanceId: number, name: number, loop: number, track: number): number;
    _spine_addAnimation(instanceId: number, name: number, loop: number, delay: number, track: number): number;
    _spine_setSkin(instanceId: number, name: number): void;
    _spine_update(instanceId: number, dt: number): void;

    _spine_getAnimations(instanceId: number): number;
    _spine_getSkins(instanceId: number): number;
    _spine_getBonePosition(instanceId: number, bone: number, outXPtr: number, outYPtr: number): number;
    _spine_getBoneRotation(instanceId: number, bone: number): number;
    _spine_getBounds(instanceId: number, outXPtr: number, outYPtr: number, outWPtr: number, outHPtr: number): void;

    _spine_getMeshBatchCount(instanceId: number): number;
    _spine_getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    _spine_getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    _spine_getMeshBatchData(instanceId: number, batchIndex: number,
        outVerticesPtr: number, outIndicesPtr: number,
        outTextureIdPtr: number, outBlendModePtr: number): void;

    cwrap(ident: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
    UTF8ToString(ptr: number): string;
    stringToNewUTF8(str: string): number;

    HEAPF32: Float32Array;
    HEAPU8: Uint8Array;
    HEAPU32: Uint32Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
}

export interface SpineWrappedAPI {
    loadSkeleton(skelDataPtr: number, skelDataLen: number, atlasText: string, atlasLen: number, isBinary: boolean): number;
    unloadSkeleton(handle: number): void;
    getAtlasPageCount(handle: number): number;
    getAtlasPageTextureName(handle: number, pageIndex: number): string;
    setAtlasPageTexture(handle: number, pageIndex: number, textureId: number, width: number, height: number): void;
    createInstance(skeletonHandle: number): number;
    destroyInstance(instanceId: number): void;
    playAnimation(instanceId: number, name: string, loop: boolean, track: number): boolean;
    addAnimation(instanceId: number, name: string, loop: boolean, delay: number, track: number): boolean;
    setSkin(instanceId: number, name: string): void;
    update(instanceId: number, dt: number): void;
    getAnimations(instanceId: number): string;
    getSkins(instanceId: number): string;
    getBonePosition(instanceId: number, bone: string, outXPtr: number, outYPtr: number): boolean;
    getBoneRotation(instanceId: number, bone: string): number;
    getBounds(instanceId: number, outXPtr: number, outYPtr: number, outWPtr: number, outHPtr: number): void;
    getMeshBatchCount(instanceId: number): number;
    getMeshBatchVertexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchIndexCount(instanceId: number, batchIndex: number): number;
    getMeshBatchData(instanceId: number, batchIndex: number,
        outVerticesPtr: number, outIndicesPtr: number,
        outTextureIdPtr: number, outBlendModePtr: number): void;
}

export function wrapSpineModule(raw: SpineWasmModule): SpineWrappedAPI {
    const cw = raw.cwrap.bind(raw);
    return {
        loadSkeleton: cw('spine_loadSkeleton', 'number', ['number', 'number', 'string', 'number', 'number']) as SpineWrappedAPI['loadSkeleton'],
        unloadSkeleton: cw('spine_unloadSkeleton', null, ['number']) as SpineWrappedAPI['unloadSkeleton'],
        getAtlasPageCount: cw('spine_getAtlasPageCount', 'number', ['number']) as SpineWrappedAPI['getAtlasPageCount'],
        getAtlasPageTextureName: cw('spine_getAtlasPageTextureName', 'string', ['number', 'number']) as SpineWrappedAPI['getAtlasPageTextureName'],
        setAtlasPageTexture: cw('spine_setAtlasPageTexture', null, ['number', 'number', 'number', 'number', 'number']) as SpineWrappedAPI['setAtlasPageTexture'],
        createInstance: cw('spine_createInstance', 'number', ['number']) as SpineWrappedAPI['createInstance'],
        destroyInstance: cw('spine_destroyInstance', null, ['number']) as SpineWrappedAPI['destroyInstance'],
        playAnimation: cw('spine_playAnimation', 'number', ['number', 'string', 'number', 'number']) as SpineWrappedAPI['playAnimation'],
        addAnimation: cw('spine_addAnimation', 'number', ['number', 'string', 'number', 'number', 'number']) as SpineWrappedAPI['addAnimation'],
        setSkin: cw('spine_setSkin', null, ['number', 'string']) as SpineWrappedAPI['setSkin'],
        update: cw('spine_update', null, ['number', 'number']) as SpineWrappedAPI['update'],
        getAnimations: cw('spine_getAnimations', 'string', ['number']) as SpineWrappedAPI['getAnimations'],
        getSkins: cw('spine_getSkins', 'string', ['number']) as SpineWrappedAPI['getSkins'],
        getBonePosition: cw('spine_getBonePosition', 'number', ['number', 'string', 'number', 'number']) as SpineWrappedAPI['getBonePosition'],
        getBoneRotation: cw('spine_getBoneRotation', 'number', ['number', 'string']) as SpineWrappedAPI['getBoneRotation'],
        getBounds: cw('spine_getBounds', null, ['number', 'number', 'number', 'number', 'number']) as SpineWrappedAPI['getBounds'],
        getMeshBatchCount: cw('spine_getMeshBatchCount', 'number', ['number']) as SpineWrappedAPI['getMeshBatchCount'],
        getMeshBatchVertexCount: cw('spine_getMeshBatchVertexCount', 'number', ['number', 'number']) as SpineWrappedAPI['getMeshBatchVertexCount'],
        getMeshBatchIndexCount: cw('spine_getMeshBatchIndexCount', 'number', ['number', 'number']) as SpineWrappedAPI['getMeshBatchIndexCount'],
        getMeshBatchData: cw('spine_getMeshBatchData', null, ['number', 'number', 'number', 'number', 'number', 'number']) as SpineWrappedAPI['getMeshBatchData'],
    };
}

export type SpineModuleFactory = (config?: Record<string, unknown>) => Promise<SpineWasmModule>;

export async function loadSpineModule(
    wasmUrl: string,
    factory?: SpineModuleFactory
): Promise<{ raw: SpineWasmModule; api: SpineWrappedAPI }> {
    let raw: SpineWasmModule;
    if (factory) {
        raw = await factory();
    } else {
        const moduleFactory = (await import(/* webpackIgnore: true */ wasmUrl)).default as SpineModuleFactory;
        raw = await moduleFactory();
    }
    return { raw, api: wrapSpineModule(raw) };
}
