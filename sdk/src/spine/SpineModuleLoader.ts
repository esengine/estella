/**
 * @file    SpineModuleLoader.ts
 * @brief   Loads and initializes the standalone Spine WASM module
 */

import { log } from '../logger';

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

    _spine_setDefaultMix(skeletonHandle: number, duration: number): void;
    _spine_setMixDuration(skeletonHandle: number, fromAnim: number, toAnim: number, duration: number): void;
    _spine_setTrackAlpha(instanceId: number, track: number, alpha: number): void;

    _spine_enableEvents(instanceId: number): void;
    _spine_getEventCount(instanceId: number): number;
    _spine_getEventBuffer(): number;
    _spine_clearEvents(): void;
    _spine_getEventAnimationName(index: number): number;
    _spine_getEventName(index: number): number;
    _spine_getEventStringValue(index: number): number;

    _spine_setAttachment(instanceId: number, slotName: number, attachmentName: number): number;
    _spine_setIKTarget(instanceId: number, constraintName: number, targetX: number, targetY: number, mix: number): number;
    _spine_setSlotColor(instanceId: number, slotName: number, r: number, g: number, b: number, a: number): number;
    _spine_listConstraints(instanceId: number): number;
    _spine_getTransformConstraintMix(instanceId: number, name: number): number;
    _spine_setTransformConstraintMix(instanceId: number, name: number, rotate: number, x: number, y: number, scaleX: number, scaleY: number, shearY: number): number;
    _spine_getPathConstraintMix(instanceId: number, name: number): number;
    _spine_setPathConstraintMix(instanceId: number, name: number, position: number, spacing: number, rotate: number, x: number, y: number): number;

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
    getLastError(): string;
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

    setDefaultMix(skeletonHandle: number, duration: number): void;
    setMixDuration(skeletonHandle: number, fromAnim: string, toAnim: string, duration: number): void;
    setTrackAlpha(instanceId: number, track: number, alpha: number): void;

    enableEvents(instanceId: number): void;
    getEventCount(instanceId: number): number;
    getEventBuffer(): number;
    clearEvents(): void;
    getEventAnimationName(index: number): string;
    getEventName(index: number): string;
    getEventStringValue(index: number): string;

    setAttachment(instanceId: number, slotName: string, attachmentName: string): boolean;
    setIKTarget(instanceId: number, constraintName: string, targetX: number, targetY: number, mix: number): boolean;
    setSlotColor(instanceId: number, slotName: string, r: number, g: number, b: number, a: number): boolean;
    listConstraints(instanceId: number): string;
    getTransformConstraintMix(instanceId: number, name: string): string;
    setTransformConstraintMix(instanceId: number, name: string, rotate: number, x: number, y: number, scaleX: number, scaleY: number, shearY: number): boolean;
    getPathConstraintMix(instanceId: number, name: string): string;
    setPathConstraintMix(instanceId: number, name: string, position: number, spacing: number, rotate: number, x: number, y: number): boolean;
}

export function wrapSpineModule(raw: SpineWasmModule): SpineWrappedAPI {
    const cw = raw.cwrap.bind(raw);
    return {
        loadSkeleton: cw('spine_loadSkeleton', 'number', ['number', 'number', 'string', 'number', 'number']) as SpineWrappedAPI['loadSkeleton'],
        getLastError: cw('spine_getLastError', 'string', []) as SpineWrappedAPI['getLastError'],
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

        setDefaultMix: cw('spine_setDefaultMix', null, ['number', 'number']) as SpineWrappedAPI['setDefaultMix'],
        setMixDuration: cw('spine_setMixDuration', null, ['number', 'string', 'string', 'number']) as SpineWrappedAPI['setMixDuration'],
        setTrackAlpha: cw('spine_setTrackAlpha', null, ['number', 'number', 'number']) as SpineWrappedAPI['setTrackAlpha'],

        enableEvents: cw('spine_enableEvents', null, ['number']) as SpineWrappedAPI['enableEvents'],
        getEventCount: cw('spine_getEventCount', 'number', ['number']) as SpineWrappedAPI['getEventCount'],
        getEventBuffer: cw('spine_getEventBuffer', 'number', []) as SpineWrappedAPI['getEventBuffer'],
        clearEvents: cw('spine_clearEvents', null, []) as SpineWrappedAPI['clearEvents'],
        getEventAnimationName: cw('spine_getEventAnimationName', 'string', ['number']) as SpineWrappedAPI['getEventAnimationName'],
        getEventName: cw('spine_getEventName', 'string', ['number']) as SpineWrappedAPI['getEventName'],
        getEventStringValue: cw('spine_getEventStringValue', 'string', ['number']) as SpineWrappedAPI['getEventStringValue'],

        setAttachment: cw('spine_setAttachment', 'number', ['number', 'string', 'string']) as SpineWrappedAPI['setAttachment'],
        setIKTarget: cw('spine_setIKTarget', 'number', ['number', 'string', 'number', 'number', 'number']) as SpineWrappedAPI['setIKTarget'],
        setSlotColor: cw('spine_setSlotColor', 'number', ['number', 'string', 'number', 'number', 'number', 'number']) as SpineWrappedAPI['setSlotColor'],
        listConstraints: cw('spine_listConstraints', 'string', ['number']) as SpineWrappedAPI['listConstraints'],
        getTransformConstraintMix: cw('spine_getTransformConstraintMix', 'string', ['number', 'string']) as SpineWrappedAPI['getTransformConstraintMix'],
        setTransformConstraintMix: cw('spine_setTransformConstraintMix', 'number', ['number', 'string', 'number', 'number', 'number', 'number', 'number', 'number']) as SpineWrappedAPI['setTransformConstraintMix'],
        getPathConstraintMix: cw('spine_getPathConstraintMix', 'string', ['number', 'string']) as SpineWrappedAPI['getPathConstraintMix'],
        setPathConstraintMix: cw('spine_setPathConstraintMix', 'number', ['number', 'string', 'number', 'number', 'number', 'number', 'number']) as SpineWrappedAPI['setPathConstraintMix'],
    };
}

export type SpineModuleFactory = (config?: Record<string, unknown>) => Promise<SpineWasmModule>;

export interface SpineWasmProvider {
    loadJs(version: string): Promise<string>;
    loadWasm(version: string): Promise<ArrayBuffer>;
}

type SpineVersion = '3.8' | '4.1' | '4.2';

export function createSpineFactories(provider: SpineWasmProvider): Map<SpineVersion, SpineModuleFactory> {
    const versions: SpineVersion[] = ['3.8', '4.1', '4.2'];
    const factories = new Map<SpineVersion, SpineModuleFactory>();

    for (const version of versions) {
        factories.set(version, async () => {
            const [jsSource, wasmBytes] = await Promise.all([
                provider.loadJs(version),
                provider.loadWasm(version),
            ]);
            const blob = new Blob([`${jsSource};\nself.__ESSpineModule__ = ESSpineModule;`], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            await import(/* @vite-ignore */ /* webpackIgnore: true */ url);
            URL.revokeObjectURL(url);
            const moduleFactory = (globalThis as any).__ESSpineModule__ as
                (opts: Record<string, unknown>) => Promise<SpineWasmModule>;
            delete (globalThis as any).__ESSpineModule__;
            return moduleFactory({
                instantiateWasm(imports: WebAssembly.Imports, cb: Function) {
                    WebAssembly.instantiate(wasmBytes, imports).then(
                        r => cb(r.instance, r.module),
                    ).catch(e => {
                        log.error('spine', 'WASM instantiation failed', e);
                    });
                    return {};
                },
            });
        });
    }

    return factories;
}

export async function loadSpineModule(
    wasmUrl: string,
    factory?: SpineModuleFactory
): Promise<{ raw: SpineWasmModule; api: SpineWrappedAPI }> {
    if (!factory) {
        throw new Error(
            'SpineModuleLoader: factory parameter is required. ' +
            'Pass the Spine WASM factory function explicitly via loadSpineModule(url, factory).'
        );
    }
    const raw = await factory();
    return { raw, api: wrapSpineModule(raw) };
}
