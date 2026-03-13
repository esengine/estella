import { describe, bench, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { wrapSpineModule } from '../src/spine/SpineModuleLoader';
import type { SpineWasmModule, SpineWrappedAPI } from '../src/spine/SpineModuleLoader';
import { SpineModuleController } from '../src/spine/SpineController';
import type { ESEngineModule } from '../src/wasm';

const WASM_DIR = path.resolve(__dirname, '../../desktop/public/wasm');
const SPINE_ASSETS = path.resolve(__dirname, 'fixtures/spine');

let raw: SpineWasmModule;
let api: SpineWrappedAPI;
let controller: SpineModuleController;
let coreModule: ESEngineModule;

let spineboySkel: Uint8Array;
let spineboyAtlas: string;
let raptorSkel: Uint8Array;
let raptorAtlas: string;
let coinSkel: Uint8Array;
let coinAtlas: string;

beforeAll(async () => {
    const jsPath = path.join(WASM_DIR, 'spine38.js');
    const mod = await import(jsPath);
    const wasmBytes = fs.readFileSync(path.join(WASM_DIR, 'spine38.wasm'));
    raw = await mod.default({
        instantiateWasm(imports: WebAssembly.Imports, cb: Function) {
            WebAssembly.instantiate(wasmBytes, imports).then(
                (r: WebAssembly.WebAssemblyInstantiatedSource) => cb(r.instance, r.module),
            );
            return {};
        },
    }) as SpineWasmModule;
    api = wrapSpineModule(raw);
    controller = new SpineModuleController(raw, api);

    const coreJsPath = path.join(WASM_DIR, 'esengine.js');
    const coreMod = await import(coreJsPath);
    coreModule = await coreMod.default({
        locateFile(p: string) {
            return path.join(WASM_DIR, p);
        },
    }) as ESEngineModule;

    spineboySkel = fs.readFileSync(path.join(SPINE_ASSETS, 'spineboy-38/spineboy-pro.skel'));
    spineboyAtlas = fs.readFileSync(path.join(SPINE_ASSETS, 'spineboy-38/spineboy.atlas'), 'utf-8');
    raptorSkel = fs.readFileSync(path.join(SPINE_ASSETS, 'raptor-38/raptor-pro.skel'));
    raptorAtlas = fs.readFileSync(path.join(SPINE_ASSETS, 'raptor-38/raptor.atlas'), 'utf-8');
    coinSkel = fs.readFileSync(path.join(SPINE_ASSETS, 'coin-38/coin-pro.skel'));
    coinAtlas = fs.readFileSync(path.join(SPINE_ASSETS, 'coin-38/coin.atlas'), 'utf-8');
});

function loadAndSetup(skel: Uint8Array, atlas: string): { skelHandle: number; instanceId: number } {
    const skelHandle = controller.loadSkeleton(skel, atlas, true);
    const pageCount = controller.getAtlasPageCount(skelHandle);
    for (let i = 0; i < pageCount; i++) {
        controller.setAtlasPageTexture(skelHandle, i, 1, 512, 512);
    }
    const instanceId = controller.createInstance(skelHandle);
    return { skelHandle, instanceId };
}

function loadNInstances(skel: Uint8Array, atlas: string, n: number): { skelHandle: number; instances: number[] } {
    const skelHandle = controller.loadSkeleton(skel, atlas, true);
    const pageCount = controller.getAtlasPageCount(skelHandle);
    for (let i = 0; i < pageCount; i++) {
        controller.setAtlasPageTexture(skelHandle, i, 1, 512, 512);
    }
    const instances: number[] = [];
    for (let i = 0; i < n; i++) {
        instances.push(controller.createInstance(skelHandle));
    }
    return { skelHandle, instances };
}

function cleanupInstances(skelHandle: number, instances: number[]) {
    for (const id of instances) controller.destroyInstance(id);
    controller.unloadSkeleton(skelHandle);
}

// =============================================================================
// Skeleton loading
// =============================================================================

describe('Spine: skeleton loading', () => {
    bench('load coin (2.4K skel, simple)', () => {
        const h = controller.loadSkeleton(coinSkel, coinAtlas, true);
        controller.unloadSkeleton(h);
    });

    bench('load spineboy (60K skel, medium)', () => {
        const h = controller.loadSkeleton(spineboySkel, spineboyAtlas, true);
        controller.unloadSkeleton(h);
    });

    bench('load raptor (59K skel, complex)', () => {
        const h = controller.loadSkeleton(raptorSkel, raptorAtlas, true);
        controller.unloadSkeleton(h);
    });
});

// =============================================================================
// Instance creation
// =============================================================================

describe('Spine: instance creation', () => {
    bench('create 1 spineboy instance', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 1);
        cleanupInstances(skelHandle, instances);
    });

    bench('create 10 spineboy instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 10);
        cleanupInstances(skelHandle, instances);
    });

    bench('create 50 spineboy instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 50);
        cleanupInstances(skelHandle, instances);
    });

    bench('create 100 spineboy instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 100);
        cleanupInstances(skelHandle, instances);
    });
});

// =============================================================================
// Animation update (the hot loop)
// =============================================================================

describe('Spine: animation update - spineboy', () => {
    const DT = 1 / 60;

    bench('update 1 instance', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 1);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 10 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 10);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 50 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 50);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 100 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 100);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 500 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 500);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 1000 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 1000);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });
});

describe('Spine: animation update - raptor (complex)', () => {
    const DT = 1 / 60;

    bench('update 10 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 10);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 50 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 50);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 100 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 100);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('update 500 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 500);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });
});

// =============================================================================
// Mesh extraction (measures vertex generation overhead)
// =============================================================================

describe('Spine: mesh extraction - spineboy', () => {
    const DT = 1 / 60;

    bench('extract 1 instance', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 1);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });

    bench('extract 10 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 10);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });

    bench('extract 50 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 50);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });

    bench('extract 100 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 100);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });

    bench('extract 500 instances', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 500);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });
});

describe('Spine: mesh extraction - raptor (complex)', () => {
    const DT = 1 / 60;

    bench('extract 10 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 10);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });

    bench('extract 50 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 50);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });

    bench('extract 100 raptor instances', () => {
        const { skelHandle, instances } = loadNInstances(raptorSkel, raptorAtlas, 100);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (const id of instances) controller.extractMeshBatches(id);
        cleanupInstances(skelHandle, instances);
    });
});

// =============================================================================
// Full frame simulation (update + extract, measures per-frame budget)
// =============================================================================

describe('Spine: full frame (update + extract) - spineboy', () => {
    const DT = 1 / 60;

    bench('1 instance per frame x60', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 1);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) {
                controller.update(id, DT);
                controller.extractMeshBatches(id);
            }
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('10 instances per frame x60', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 10);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) {
                controller.update(id, DT);
                controller.extractMeshBatches(id);
            }
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('50 instances per frame x60', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 50);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) {
                controller.update(id, DT);
                controller.extractMeshBatches(id);
            }
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('100 instances per frame x60', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 100);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) {
                controller.update(id, DT);
                controller.extractMeshBatches(id);
            }
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('200 instances per frame x60', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 200);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) {
                controller.update(id, DT);
                controller.extractMeshBatches(id);
            }
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('500 instances per frame x60', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 500);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) {
                controller.update(id, DT);
                controller.extractMeshBatches(id);
            }
        }
        cleanupInstances(skelHandle, instances);
    });
});

// =============================================================================
// Vertex count report (not a perf bench, just data collection)
// =============================================================================

describe('Spine: vertex/batch statistics', () => {
    bench('spineboy mesh stats', () => {
        const { skelHandle, instanceId } = loadAndSetup(spineboySkel, spineboyAtlas);
        controller.play(instanceId, 'walk', true);
        controller.update(instanceId, 1 / 60);
        const batches = controller.extractMeshBatches(instanceId);
        let totalVerts = 0, totalIndices = 0;
        for (const b of batches) {
            totalVerts += b.vertices.length / 8;
            totalIndices += b.indices.length;
        }
        controller.destroyInstance(instanceId);
        controller.unloadSkeleton(skelHandle);
    });

    bench('raptor mesh stats', () => {
        const { skelHandle, instanceId } = loadAndSetup(raptorSkel, raptorAtlas);
        controller.play(instanceId, 'walk', true);
        controller.update(instanceId, 1 / 60);
        const batches = controller.extractMeshBatches(instanceId);
        let totalVerts = 0, totalIndices = 0;
        for (const b of batches) {
            totalVerts += b.vertices.length / 8;
            totalIndices += b.indices.length;
        }
        controller.destroyInstance(instanceId);
        controller.unloadSkeleton(skelHandle);
    });

    bench('coin mesh stats', () => {
        const { skelHandle, instanceId } = loadAndSetup(coinSkel, coinAtlas);
        controller.play(instanceId, 'animation', true);
        controller.update(instanceId, 1 / 60);
        const batches = controller.extractMeshBatches(instanceId);
        let totalVerts = 0, totalIndices = 0;
        for (const b of batches) {
            totalVerts += b.vertices.length / 8;
            totalIndices += b.indices.length;
        }
        controller.destroyInstance(instanceId);
        controller.unloadSkeleton(skelHandle);
    });
});

// =============================================================================
// Engine overhead: isolate JS→WASM data copy + submit cost
// =============================================================================

type CachedBatchEntry = {
    vertices: Float32Array;
    indices: Uint16Array;
    textureId: number;
    blendMode: number;
    entity: number;
    skeletonScale: number;
    flipX: boolean;
    flipY: boolean;
    layer: number;
};

function prepareExtractedBatches(
    skel: Uint8Array, atlas: string, n: number, animation: string,
): { skelHandle: number; instances: number[]; entries: CachedBatchEntry[] } {
    const { skelHandle, instances } = loadNInstances(skel, atlas, n);
    for (const id of instances) {
        controller.play(id, animation, true);
        controller.update(id, 1 / 60);
    }
    const entries: CachedBatchEntry[] = [];
    for (let i = 0; i < instances.length; i++) {
        const batches = controller.extractMeshBatches(instances[i]);
        for (const b of batches) {
            if (b.vertices.length === 0 || b.indices.length === 0) continue;
            entries.push({
                vertices: b.vertices,
                indices: b.indices,
                textureId: b.textureId,
                blendMode: b.blendMode,
                entity: i + 1,
                skeletonScale: 1,
                flipX: false,
                flipY: false,
                layer: 0,
            });
        }
    }
    return { skelHandle, instances, entries };
}

function simulateDataCopyOnly(entries: CachedBatchEntry[]) {
    let totalVertBytes = 0;
    let totalIdxBytes = 0;
    for (const e of entries) {
        totalVertBytes += e.vertices.byteLength;
        totalIdxBytes += e.indices.byteLength;
    }

    const vertBase = coreModule._malloc(totalVertBytes);
    const idxBase = coreModule._malloc(totalIdxBytes);

    let vOff = 0;
    let iOff = 0;
    for (const e of entries) {
        const vertPtr = vertBase + vOff;
        const idxPtr = idxBase + iOff;
        coreModule.HEAPF32.set(e.vertices, vertPtr >> 2);
        new Uint16Array(coreModule.HEAPU8.buffer, idxPtr, e.indices.length).set(e.indices);
        vOff += e.vertices.byteLength;
        iOff += e.indices.byteLength;
    }

    coreModule._free(vertBase);
    coreModule._free(idxBase);
}

function simulateDataCopyAndSubmit(entries: CachedBatchEntry[]) {
    const submitFn = coreModule.renderer_submitSpineBatchByEntity;
    const registry = new coreModule.Registry();

    let totalVertBytes = 0;
    let totalIdxBytes = 0;
    for (const e of entries) {
        totalVertBytes += e.vertices.byteLength;
        totalIdxBytes += e.indices.byteLength;
    }

    const vertBase = coreModule._malloc(totalVertBytes);
    const idxBase = coreModule._malloc(totalIdxBytes);

    let vOff = 0;
    let iOff = 0;
    for (const e of entries) {
        const vertPtr = vertBase + vOff;
        const idxPtr = idxBase + iOff;
        coreModule.HEAPF32.set(e.vertices, vertPtr >> 2);
        new Uint16Array(coreModule.HEAPU8.buffer, idxPtr, e.indices.length).set(e.indices);

        if (submitFn) {
            submitFn.call(coreModule, registry,
                vertPtr, e.vertices.length / 8,
                idxPtr, e.indices.length,
                e.textureId, e.blendMode,
                e.entity, e.skeletonScale, e.flipX, e.flipY,
                e.layer, 0);
        }

        vOff += e.vertices.byteLength;
        iOff += e.indices.byteLength;
    }

    coreModule._free(vertBase);
    coreModule._free(idxBase);
    registry.delete();
}

describe('Engine overhead: JS→WASM data copy (malloc+memcpy+free)', () => {
    bench('10 spineboy - data copy only', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 10, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyOnly(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('50 spineboy - data copy only', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 50, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyOnly(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('100 spineboy - data copy only', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 100, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyOnly(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('200 spineboy - data copy only', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 200, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyOnly(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('500 spineboy - data copy only', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 500, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyOnly(entries);
        }
        cleanupInstances(skelHandle, instances);
    });
});

describe('Engine overhead: data copy + renderer submit', () => {
    bench('10 spineboy - copy + submit', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 10, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyAndSubmit(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('50 spineboy - copy + submit', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 50, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyAndSubmit(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('100 spineboy - copy + submit', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 100, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyAndSubmit(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('200 spineboy - copy + submit', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 200, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyAndSubmit(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('500 spineboy - copy + submit', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 500, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyAndSubmit(entries);
        }
        cleanupInstances(skelHandle, instances);
    });
});

describe('Engine overhead: proportion (Spine update vs engine copy+submit)', () => {
    const DT = 1 / 60;

    bench('100 spineboy - Spine update only (baseline)', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 100);
        for (const id of instances) controller.play(id, 'walk', true);
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.update(id, DT);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('100 spineboy - Spine extract only', () => {
        const { skelHandle, instances } = loadNInstances(spineboySkel, spineboyAtlas, 100);
        for (const id of instances) {
            controller.play(id, 'walk', true);
            controller.update(id, DT);
        }
        for (let frame = 0; frame < 60; frame++) {
            for (const id of instances) controller.extractMeshBatches(id);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('100 spineboy - engine data copy only', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 100, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyOnly(entries);
        }
        cleanupInstances(skelHandle, instances);
    });

    bench('100 spineboy - engine copy + submit', () => {
        const { skelHandle, instances, entries } = prepareExtractedBatches(spineboySkel, spineboyAtlas, 100, 'walk');
        for (let frame = 0; frame < 60; frame++) {
            simulateDataCopyAndSubmit(entries);
        }
        cleanupInstances(skelHandle, instances);
    });
});
