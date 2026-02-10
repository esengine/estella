/**
 * @file    SpinePlugin.ts
 * @brief   Plugin that integrates standalone Spine WASM with ESEngine
 */

import type { Plugin } from '../app';
import type { App } from '../app';
import type { ESEngineModule } from '../wasm';
import { defineResource } from '../resource';
import { loadSpineModule, type SpineWasmModule, type SpineModuleFactory } from './SpineModuleLoader';
import { SpineModuleController } from './SpineController';

export const SpineResource = defineResource<SpineModuleController | null>(null, 'SpineController');

export class SpinePlugin implements Plugin {
    private wasmUrl_: string;
    private factory_?: SpineModuleFactory;

    constructor(wasmUrl: string, factory?: SpineModuleFactory) {
        this.wasmUrl_ = wasmUrl;
        this.factory_ = factory;
    }

    build(app: App): void {
        const coreModule = app.wasmModule!;

        const initPromise = loadSpineModule(this.wasmUrl_, this.factory_).then(
            (spineModule: SpineWasmModule) => {
                const controller = new SpineModuleController(spineModule);
                app.insertResource(SpineResource, controller);
                return { controller, coreModule };
            }
        );

        app.insertResource(SpineResource, null);

        (app as any).__spineInitPromise = initPromise;
    }
}

export function submitSpineMeshesToCore(
    coreModule: ESEngineModule,
    controller: SpineModuleController,
    instanceId: number,
    transform?: Float32Array
): void {
    const batches = controller.extractMeshBatches(instanceId);

    let transformPtr = 0;
    if (transform) {
        transformPtr = coreModule._malloc(64);
        coreModule.HEAPF32.set(transform, transformPtr >> 2);
    }

    for (const batch of batches) {
        const vertBytes = batch.vertices.byteLength;
        const idxBytes = batch.indices.byteLength;

        const vertPtr = coreModule._malloc(vertBytes);
        const idxPtr = coreModule._malloc(idxBytes);

        coreModule.HEAPF32.set(batch.vertices, vertPtr >> 2);
        new Uint16Array(coreModule.HEAPU8.buffer, idxPtr, batch.indices.length)
            .set(batch.indices);

        coreModule.renderer_submitTriangles(
            vertPtr, batch.vertices.length / 8,
            idxPtr, batch.indices.length,
            batch.textureId, batch.blendMode,
            transformPtr
        );

        coreModule._free(vertPtr);
        coreModule._free(idxPtr);
    }

    if (transformPtr) {
        coreModule._free(transformPtr);
    }
}
