/**
 * @file    SpinePlugin.ts
 * @brief   Plugin that integrates standalone Spine WASM with ESEngine
 */

import type { Plugin } from '../app';
import type { App } from '../app';
import type { ESEngineModule } from '../wasm';
import { defineResource } from '../resource';
import { Schedule } from '../system';
import type { SystemDef } from '../system';
import { SpineAnimation, WorldTransform, type SpineAnimationData, type WorldTransformData } from '../component';
import { Assets } from '../asset';
import type { Entity } from '../types';
import { loadSpineModule, type SpineModuleFactory } from './SpineModuleLoader';
import { SpineModuleController } from './SpineController';

export const SpineResource = defineResource<SpineModuleController | null>(null, 'SpineController');

const _transformBuf = new Float32Array(16);

function buildTransformMatrix(
    wt: WorldTransformData,
    skeletonScale: number,
    flipX: boolean,
    flipY: boolean,
): Float32Array {
    const sx = wt.scale.x * skeletonScale * (flipX ? -1 : 1);
    const sy = wt.scale.y * skeletonScale * (flipY ? -1 : 1);
    const sz = wt.scale.z;
    const qx = wt.rotation.x, qy = wt.rotation.y, qz = wt.rotation.z, qw = wt.rotation.w;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    _transformBuf[0] = (1 - (yy + zz)) * sx;
    _transformBuf[1] = (xy + wz) * sx;
    _transformBuf[2] = (xz - wy) * sx;
    _transformBuf[3] = 0;
    _transformBuf[4] = (xy - wz) * sy;
    _transformBuf[5] = (1 - (xx + zz)) * sy;
    _transformBuf[6] = (yz + wx) * sy;
    _transformBuf[7] = 0;
    _transformBuf[8] = (xz + wy) * sz;
    _transformBuf[9] = (yz - wx) * sz;
    _transformBuf[10] = (1 - (xx + yy)) * sz;
    _transformBuf[11] = 0;
    _transformBuf[12] = wt.position.x;
    _transformBuf[13] = wt.position.y;
    _transformBuf[14] = wt.position.z;
    _transformBuf[15] = 1;
    return _transformBuf;
}

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

                if (app.hasResource(Assets)) {
                    app.getResource(Assets).setSpineController(controller);
                }

                const instances = new Map<number, number>();
                const entitySkelKeys = new Map<number, string>();
                const entityState = new Map<number, { animation: string; skin: string; loop: boolean }>();

                const spineAutoSystem: SystemDef = {
                    _id: Symbol('SpineAutoSystem'),
                    _name: 'SpineAutoSystem',
                    _params: [],
                    _fn: () => {
                        const world = app.world;
                        const assetServer = app.hasResource(Assets) ? app.getResource(Assets) : null;
                        if (!assetServer) return;

                        const spineEntities = world.getEntitiesWithComponents([SpineAnimation]);
                        const activeEntities = new Set<number>();

                        for (const entity of spineEntities) {
                            activeEntities.add(entity);
                            const spineData = world.get(entity, SpineAnimation) as SpineAnimationData;
                            const skelKey = `${spineData.skeletonPath}:${spineData.atlasPath}`;

                            if (!instances.has(entity) || entitySkelKeys.get(entity) !== skelKey) {
                                if (instances.has(entity)) {
                                    controller.destroyInstance(instances.get(entity)!);
                                    instances.delete(entity);
                                    entitySkelKeys.delete(entity);
                                    entityState.delete(entity);
                                }

                                const skelHandle = assetServer.getSpineSkeletonHandle(
                                    spineData.skeletonPath, spineData.atlasPath
                                );
                                if (skelHandle === undefined) continue;

                                const instanceId = controller.createInstance(skelHandle);
                                if (instanceId < 0) continue;

                                instances.set(entity, instanceId);
                                entitySkelKeys.set(entity, skelKey);

                                if (spineData.skin) {
                                    controller.setSkin(instanceId, spineData.skin);
                                }
                                if (spineData.animation) {
                                    controller.play(instanceId, spineData.animation, spineData.loop);
                                }
                                entityState.set(entity, {
                                    animation: spineData.animation,
                                    skin: spineData.skin,
                                    loop: spineData.loop,
                                });
                                continue;
                            }

                            const prev = entityState.get(entity);
                            if (!prev) continue;
                            const instanceId = instances.get(entity)!;

                            if (prev.skin !== spineData.skin) {
                                controller.setSkin(instanceId, spineData.skin);
                                prev.skin = spineData.skin;
                            }
                            if (prev.animation !== spineData.animation || prev.loop !== spineData.loop) {
                                if (spineData.animation) {
                                    controller.play(instanceId, spineData.animation, spineData.loop);
                                }
                                prev.animation = spineData.animation;
                                prev.loop = spineData.loop;
                            }
                        }

                        for (const [entity, instanceId] of instances) {
                            if (!activeEntities.has(entity)) {
                                controller.destroyInstance(instanceId);
                                instances.delete(entity);
                                entitySkelKeys.delete(entity);
                                entityState.delete(entity);
                            }
                        }
                    },
                };

                app.addSystemToSchedule(Schedule.PreUpdate, spineAutoSystem);

                if (!app.pipeline?.spineRenderer) {
                    let lastElapsed = 0;
                    app.setSpineRenderer((_registry: unknown, elapsed: number) => {
                        let dt = elapsed - lastElapsed;
                        lastElapsed = elapsed;
                        if (dt <= 0 || dt > 0.5) dt = 1 / 60;

                        const world = app.world;

                        for (const [entity, instanceId] of instances) {
                            const spineData = world.has(entity as Entity, SpineAnimation)
                                ? world.get(entity as Entity, SpineAnimation) as SpineAnimationData
                                : null;

                            const playing = spineData?.playing !== false;
                            const timeScale = spineData?.timeScale ?? 1;
                            if (playing) {
                                controller.update(instanceId, dt * timeScale);
                            }

                            let transform: Float32Array | undefined;
                            if (world.has(entity as Entity, WorldTransform)) {
                                const wt = world.get(entity as Entity, WorldTransform) as WorldTransformData;
                                const skeletonScale = spineData?.skeletonScale ?? 1;
                                const flipX = spineData?.flipX ?? false;
                                const flipY = spineData?.flipY ?? false;
                                transform = buildTransformMatrix(wt, skeletonScale, flipX, flipY);
                            }

                            const color = spineData?.color;
                            submitSpineMeshesToCore(coreModule, controller, instanceId, transform, color);
                        }
                    });
                }

                return { controller, coreModule };
            }
        );

        app.insertResource(SpineResource, null);

        initPromise.catch(() => {});
        app.spineInitPromise = initPromise;
    }
}

let _tintBuf = new Float32Array(0);

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
            if (_tintBuf.length < vertices.length) {
                _tintBuf = new Float32Array(vertices.length * 2);
            }
            _tintBuf.set(vertices);
            const tinted = _tintBuf.subarray(0, vertices.length);
            for (let i = 0; i < tinted.length; i += 8) {
                if (isPMA) {
                    tinted[i + 4] *= color.r * color.a;
                    tinted[i + 5] *= color.g * color.a;
                    tinted[i + 6] *= color.b * color.a;
                } else {
                    tinted[i + 4] *= color.r;
                    tinted[i + 5] *= color.g;
                    tinted[i + 6] *= color.b;
                }
                tinted[i + 7] *= color.a;
            }
            vertices = tinted;
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
