// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    censusProbes.ts
 * @brief   The engine's own census probes — one place that knows which of the
 *          engine's counters obey a conservation law and which are caches.
 *
 * @details Installed by a CALL, never by a bare side-effect import. The first
 *          version registered at module load and a bundler removed the module
 *          whole: `takeCensus` shipped in dist with zero probes, answering every
 *          question with an empty snapshot — an instrument that cannot fail
 *          because it cannot measure. Nothing here runs until a census is taken.
 *
 *          Every probe returns `undefined` rather than zeros when its subsystem
 *          is absent. The distinction matters more than it looks: a census that
 *          reported `render.gl.textures = 0` because the renderer was not up
 *          would show a texture leak as a clean fall to zero, which is the exact
 *          shape of the bug it exists to catch.
 */
import { registerCensusProbe, counter } from './censusRegistry';
import type { CensusContext, CensusEntry, CensusTier } from './censusTypes';
import { liveEmitterHandlers } from '../ecs/emitter';
import { liveDomListeners } from '../util/listeners';
import { getResourceManager } from '../wasm/resourceManager';
import type { World } from '../ecs/world';
import type { ESEngineModule } from '../wasm';

function worldOf(ctx: CensusContext): World | undefined {
    return ctx.world ?? ctx.app?.world;
}

function moduleOf(ctx: CensusContext): ESEngineModule | null {
    return ctx.module ?? ctx.app?.wasmModule ?? null;
}

/**
 * Subsystems are reached by resource NAME, not by importing their tokens.
 * Importing them would put every plugin the census can see into the import graph
 * of the census itself — a game that only wants an entity count would pull in
 * Box2D — and would make this module a cycle for anything registering a probe.
 */
function resource<T>(ctx: CensusContext, name: string): T | undefined {
    return ctx.app?.getResourceByName(name) as T | undefined;
}

/**
 * Register the engine's own probes. Idempotent (probes are keyed by id), so a
 * second call replaces rather than doubles.
 */
export function installBuiltinCensusProbes(): void {
    // =============================================================================
    // ECS
    // =============================================================================

    registerCensusProbe({
        id: 'ecs',
        read(ctx) {
            const world = worldOf(ctx);
            if (!world) return undefined;
            const s = world.getStorageSizes();
            return [
                counter('ecs.entities', s.entities, 'conserved'),
                counter('ecs.scriptRows', s.scripts.rows, 'conserved'),
                counter('ecs.scriptEntities', s.scripts.entities, 'conserved'),
                counter('ecs.names', s.names.entities, 'conserved'),
                counter('ecs.spawnCallbacks', s.spawnCallbacks, 'conserved'),
                counter('ecs.despawnCallbacks', s.despawnCallbacks, 'conserved'),
                counter('ecs.changeRows.added', s.changes.addedRows, 'conserved'),
                counter('ecs.changeRows.changed', s.changes.changedRows, 'conserved'),
                // Drained by cleanRemovedBuffer, not by despawn — so it is legitimately
                // non-zero mid-frame and must still not climb from cycle to cycle.
                counter('ecs.changeRows.removed', s.changes.removedRows, 'bounded'),
                counter('ecs.nameKeys', s.names.names, 'bounded'),
                counter('ecs.scriptStorages', s.scripts.storages, 'bounded'),
                counter('ecs.trackedComponents', s.changes.tracked, 'bounded'),
                counter('ecs.queryCacheEntries', s.queryCacheEntries, 'bounded'),
                counter('ecs.indexSlots', s.indexSlots, 'bounded'),
            ];
        },
    });

    // =============================================================================
    // Subscriptions
    // =============================================================================

    registerCensusProbe({
        id: 'events',
        read() {
            return [
                counter('events.emitterHandlers', liveEmitterHandlers(), 'conserved'),
                counter('events.domListeners', liveDomListeners(), 'conserved'),
            ];
        },
    });

    // =============================================================================
    // Renderer — GPU objects and the resource manager's view of them
    // =============================================================================

    registerCensusProbe({
        id: 'render',
        read(ctx) {
            const module = moduleOf(ctx);
            if (!module) return undefined;
            const out: CensusEntry[] = [];

            const live = module.renderer_getLiveObjects?.();
            if (live) {
                out.push(
                    counter('render.gl.buffers', live.buffers, 'conserved'),
                    counter('render.gl.textures', live.textures, 'conserved'),
                    counter('render.gl.programs', live.programs, 'conserved'),
                    counter('render.gl.renderTargets', live.renderTargets, 'conserved'),
                    // A readback is a request awaiting collection; at rest there are none.
                    counter('render.gl.readbacks', live.readbacks, 'conserved'),
                    counter('render.gl.layouts', live.layouts, 'bounded'),
                    counter('render.gl.pipelines', live.pipelines, 'bounded'),
                );
            }

            const stats = getResourceManager()?.getResourceStats();
            if (stats) {
                out.push(
                    counter('render.rm.textures', stats.textureCount, 'bounded'),
                    counter('render.rm.shaders', stats.shaderCount, 'bounded'),
                    counter('render.rm.vertexBuffers', stats.vertexBufferCount, 'bounded'),
                    counter('render.rm.indexBuffers', stats.indexBufferCount, 'bounded'),
                    counter('render.rm.textureBytes', stats.textureBytes, 'bounded', 'bytes'),
                    counter('render.rm.evictable', stats.textureEvictableCount, 'info'),
                );
            }

            return out.length > 0 ? out : undefined;
        },
    });

    // =============================================================================
    // Assets
    // =============================================================================

    type AssetSizes = ReturnType<import('../asset/Assets').Assets['sizes']>;

    registerCensusProbe({
        id: 'asset',
        read(ctx) {
            const assets = resource<{ sizes?: () => AssetSizes }>(ctx, 'Assets');
            if (!assets?.sizes) return undefined;
            const s = assets.sizes();
            return [
                counter('asset.refCounts', s.refCounts, 'conserved'),
                counter('asset.handlePaths', s.handlePaths, 'conserved'),
                counter('asset.trackedRefRows', s.trackedRefRows, 'conserved'),
                counter('asset.invalidateListeners', s.invalidateListeners, 'conserved'),
                // Zero at rest. A load still pending between cycles is holding its
                // promise, its callbacks and everything they closed over.
                counter('asset.pendingLoads', s.pendingLoads, 'conserved'),
                counter('asset.textureCached', s.textureCached, 'bounded'),
                counter('asset.genericCached', s.genericCached, 'bounded'),
                counter('asset.genericCaches', s.genericCaches, 'bounded'),
                counter('asset.registryEntries', s.registryEntries, 'info'),
            ];
        },
    });

    // =============================================================================
    // Physics — only present once the side module is loaded
    // =============================================================================

    interface PhysicsCensusModule {
        _physics_getBodyCount?(): number;
        _physics_getShapeCount?(): number;
        _physics_getJointCount?(): number;
        _physics_getTrackingRows?(): number;
        _physics_getDynamicBodyCount?(): number;
    }

    registerCensusProbe({
        id: 'physics',
        read(ctx) {
            const m = resource<{ module: PhysicsCensusModule | null }>(ctx, 'PhysicsRuntime')?.module;
            // Absent until the side module resolves, and absent forever in a game
            // with no physics — both are "no counters", never "no bodies".
            if (!m?._physics_getBodyCount) return undefined;
            return [
                counter('physics.bodies', m._physics_getBodyCount(), 'conserved'),
                counter('physics.shapes', m._physics_getShapeCount?.() ?? 0, 'conserved'),
                counter('physics.joints', m._physics_getJointCount?.() ?? 0, 'conserved'),
                counter('physics.trackingRows', m._physics_getTrackingRows?.() ?? 0, 'conserved'),
                counter('physics.dynamicBodies', m._physics_getDynamicBodyCount?.() ?? 0, 'info'),
            ];
        },
    });

    // =============================================================================
    // Heaps
    // =============================================================================

    interface ChromiumMemory {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
    }

    registerCensusProbe({
        id: 'heap',
        read(ctx) {
            const out: CensusEntry[] = [];

            // Judged only where a collection can be forced first (see collectGarbage),
            // and even then loosely — on a clean workload this wanders without scaling
            // with the work done. The exact C++ signal below is what catches a leak.
            const jsTier: CensusTier = typeof (globalThis as { gc?: unknown }).gc === 'function' ? 'trend' : 'info';

            // Chromium only, and behind a flag in some builds. Node answers through
            // process.memoryUsage instead; neither exists everywhere, hence the pair.
            const mem = (performance as unknown as { memory?: ChromiumMemory }).memory;
            if (mem && typeof mem.usedJSHeapSize === 'number') {
                out.push(counter('js.heapUsed', mem.usedJSHeapSize, jsTier, 'bytes'));
            } else {
                const proc = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number; external: number } } }).process;
                const usage = proc?.memoryUsage?.();
                if (usage) {
                    out.push(
                        counter('js.heapUsed', usage.heapUsed, jsTier, 'bytes'),
                        counter('js.external', usage.external, jsTier, 'bytes'),
                    );
                }
            }

            const module = moduleOf(ctx);
            const heap = (module as { HEAPU8?: Uint8Array } | null)?.HEAPU8;
            if (heap) {
                // RESERVED, not used: emscripten's heap only ever grows, so this rises
                // in steps and never falls. It is `bounded` because a step that keeps
                // repeating is the leak — the plateau itself is normal.
                out.push(counter('wasm.heapReserved', heap.length, 'bounded', 'bytes'));
            }
            const mallocBytes = module?.es_getMallocBytes?.();
            if (typeof mallocBytes === 'number') {
                // Exact, and it falls when memory is returned — so unlike either heap
                // number this needs no statistics and no allowance. Bounded rather
                // than conserved only because allocator free-lists legitimately settle.
                out.push(counter('wasm.mallocBytes', mallocBytes, 'bounded', 'bytes'));
            }

            return out.length > 0 ? out : undefined;
        },
    });
}
