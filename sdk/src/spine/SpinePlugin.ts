/**
 * @file    SpinePlugin.ts
 * @brief   Plugin that integrates standalone Spine WASM with ESEngine
 */

import type { Plugin } from '../app';
import type { App } from '../app';
import type { ESEngineModule } from '../wasm';
import { defineResource } from '../resource';
import { loadSpineModule, type SpineModuleFactory } from './SpineModuleLoader';
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
            ({ raw, api }) => {
                const controller = new SpineModuleController(raw, api);
                app.insertResource(SpineResource, controller);
                return { controller, coreModule };
            }
        );

        app.insertResource(SpineResource, null);

        (app as any).__spineInitPromise = initPromise;
    }
}

let heapVertPtr = 0;
let heapVertCap = 0;
let heapIdxPtr = 0;
let heapIdxCap = 0;
let heapTransformPtr = 0;
let heapModule: ESEngineModule | null = null;

function ensureHeapBuffer(
    module: ESEngineModule,
    currentPtr: number,
    currentCap: number,
    needed: number,
): [number, number] {
    if (currentPtr && currentCap >= needed) {
        return [currentPtr, currentCap];
    }
    if (currentPtr) {
        module._free(currentPtr);
    }
    const cap = needed * 2;
    return [module._malloc(cap), cap];
}

function freeHeapBuffers(): void {
    if (!heapModule) {
        return;
    }
    if (heapVertPtr) { heapModule._free(heapVertPtr); heapVertPtr = 0; heapVertCap = 0; }
    if (heapIdxPtr) { heapModule._free(heapIdxPtr); heapIdxPtr = 0; heapIdxCap = 0; }
    if (heapTransformPtr) { heapModule._free(heapTransformPtr); heapTransformPtr = 0; }
    heapModule = null;
}

export function submitSpineMeshesToCore(
    coreModule: ESEngineModule,
    controller: SpineModuleController,
    instanceId: number,
    transform?: Float32Array,
    color?: { r: number; g: number; b: number; a: number },
): void {
    if (heapModule && heapModule !== coreModule) {
        freeHeapBuffers();
    }
    heapModule = coreModule;

    const batches = controller.extractMeshBatches(instanceId);

    if (transform) {
        if (!heapTransformPtr) {
            heapTransformPtr = coreModule._malloc(64);
        }
        coreModule.HEAPF32.set(transform, heapTransformPtr >> 2);
    }

    const needsTint = color && (color.r !== 1 || color.g !== 1 || color.b !== 1 || color.a !== 1);

    for (const batch of batches) {
        let vertices = batch.vertices;
        if (needsTint) {
            const isPMA = batch.blendMode >= 4;
            vertices = new Float32Array(vertices);
            for (let i = 0; i < vertices.length; i += 8) {
                if (isPMA) {
                    vertices[i + 4] *= color.r * color.a;
                    vertices[i + 5] *= color.g * color.a;
                    vertices[i + 6] *= color.b * color.a;
                } else {
                    vertices[i + 4] *= color.r;
                    vertices[i + 5] *= color.g;
                    vertices[i + 6] *= color.b;
                }
                vertices[i + 7] *= color.a;
            }
        }

        const vertBytes = vertices.byteLength;
        const idxBytes = batch.indices.byteLength;

        [heapVertPtr, heapVertCap] = ensureHeapBuffer(coreModule, heapVertPtr, heapVertCap, vertBytes);
        [heapIdxPtr, heapIdxCap] = ensureHeapBuffer(coreModule, heapIdxPtr, heapIdxCap, idxBytes);

        coreModule.HEAPF32.set(vertices, heapVertPtr >> 2);
        new Uint16Array(coreModule.HEAPU8.buffer, heapIdxPtr, batch.indices.length)
            .set(batch.indices);

        coreModule.renderer_submitTriangles(
            heapVertPtr, vertices.length / 8,
            heapIdxPtr, batch.indices.length,
            batch.textureId, batch.blendMode,
            transform ? heapTransformPtr : 0
        );
    }
}
