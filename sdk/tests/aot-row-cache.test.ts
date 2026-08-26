// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-row-cache.test.ts
 * @brief   When last frame's rows are this frame's rows, and when they are not.
 *
 * @details The row table a compiled system reads is a function of two things:
 *          which entities match, and where their components are. Keeping it
 *          across frames is the difference between 27 ns per entity per frame
 *          and under 2 (bench/aot-frame) — and the way it goes wrong is silent.
 *          A stale address is not an error; it is somebody else's bytes.
 *
 *          So each half is tested against the thing only IT can see. The query
 *          cache answers "which entities", and hands back a different array the
 *          moment the set or the order changed. `World.layoutEpoch` answers
 *          "where", including the moves this SDK never hears about — a C++
 *          system inserting a component reallocates that pool with no JS call
 *          anywhere in it.
 *
 *          Addresses here come from an injected MemoryProvider and the epoch
 *          from a stub binding, because both of those are what a real engine
 *          would move and neither can be moved on demand.
 */
import { describe, it, expect } from 'vitest';

import { World } from '../src/ecs/world';
import { Transform } from '../src/ecs/component';
import type { AnyComponentDef } from '../src/ecs/component';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { ResourceStorage } from '../src/ecs/resource';
import { WasmPoolMemory, type WasmHeap } from '../src/ecs/WasmPoolMemory';
import { AotContext, SYSCTX_WORDS } from '../src/ecs/aot/AotContext';
import { AotDispatch } from '../src/ecs/aot/AotDispatch';
import { AotSystems, type AotManifest } from '../src/ecs/aot/AotSystems';
import type { AotRuntime } from '../src/ecs/aot/AotRuntime';
import type { ComponentHeap, MemoryProvider } from '../src/ecs/bridge/memoryProvider';
import { engineAbiDigest, projectShapeDigest } from '../src/ecs/aot/abiDigest';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import type { Entity } from '../src/types';

const N = 8;
const STRIDE = 64;

/** A linear memory and a bump allocator: the engine, as far as an arena cares. */
class Heap implements WasmHeap {
    readonly memory = new WebAssembly.Memory({ initial: 4, maximum: 4 });
    HEAPU8 = new Uint8Array(this.memory.buffer);
    private next = 4096;
    _malloc(size: number): number {
        const at = this.next;
        this.next += (size + 15) & ~15;
        return at;
    }
    _free(): void { /* a bump allocator frees nothing */ }
}

/**
 * Enough of a CppRegistry for `insert` to go through: the bridge refuses a
 * builtin component whose four methods are not there. What they do is nobody's
 * business here — the addresses come from the injected provider below.
 */
let nextEntity = 0;
const REGISTRY = {
    create: () => ++nextEntity,
    addTransform: () => {},
    getTransform: () => ({}),
    hasTransform: () => true,
    removeTransform: () => {},
} as unknown as CppRegistry;

/**
 * A world whose `Transform` addresses this test can move, and whose engine can
 * be asked — or not asked — for its layout epoch.
 */
function harness(options: { epochBinding?: boolean } = {}) {
    const heap = new Heap();
    const memory = new WasmPoolMemory(heap);
    const world = new World();
    world.useScriptPoolMemory(memory);

    const live = new Set<number>();
    const state = { base: 1 << 16, epoch: 0, resolved: 0 };
    const provider: MemoryProvider = {
        resolveComponentHeap: (name: string) => (name === 'Transform'
            ? (entity: Entity, out: ComponentHeap): boolean => {
                const id = entity as unknown as number;
                if (!live.has(id)) return false;
                state.resolved++;
                out.f32 = new Float32Array(heap.memory.buffer);
                out.u32 = new Uint32Array(heap.memory.buffer);
                out.u8 = heap.HEAPU8;
                out.ptr = state.base + id * STRIDE;
                return true;
            }
            : null),
    };
    const module = {
        ...(options.epochBinding === false ? {} : { registryLayoutEpoch: () => state.epoch }),
    } as unknown as ESEngineModule;
    world.connectCpp(REGISTRY, module, { memory: provider });

    const runner = new SystemRunner(world, new ResourceStorage());
    const system = defineSystem([], () => { /* the closure never runs here */ },
        { name: 'Move' });

    // The twin: it records the rows it was handed rather than reading them, which
    // is the only thing this test is about.
    const seen: number[][] = [];
    const ctx = new AotContext(memory);
    const systems = new AotSystems();
    systems.install(
        {
            engineAbi: engineAbiDigest(4),
            projectShapes: projectShapeDigest([]),
            systems: [{
                name: 'Move', symbol: 'es_sys_Move',
                queries: [[{ comp: 'Transform', mut: false }]], resources: [],
            }],
        } satisfies AotManifest,
        { es_sys_Move: (at: number) => seen.push(rowsAt(heap, at)) },
        (name) => (name === 'Transform' ? Transform as unknown as AnyComponentDef : undefined),
    );
    const runtime: AotRuntime = {
        systems,
        addresses: { componentNamed: () => Transform as unknown as AnyComponentDef, resourceAt: () => undefined },
        ctx,
    };
    runner.useAot(runtime);
    void new AotDispatch(world, runtime);

    const spawn = (): Entity => {
        const entity = world.spawn();
        live.add(entity as unknown as number);
        world.insert(entity, Transform as unknown as AnyComponentDef, {});
        return entity;
    };
    return { world, runner, system, state, seen, spawn, live };
}

/** The addresses in the first query's rows, read out of the arena. */
function rowsAt(heap: Heap, ctx: number): number[] {
    const words = new Uint32Array(heap.memory.buffer);
    const queries = words[(ctx >> 2) + 0]!;
    const rows = words[(queries >> 2) + 0]!;
    const count = words[(queries >> 2) + 1]!;
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(words[(rows >> 2) + i * 2 + 1]!);
    return out;
}

describe('the rows a compiled system reads, kept across frames', () => {
    it('resolves an address once, not once a frame', () => {
        const h = harness();
        for (let i = 0; i < N; i++) h.spawn();

        h.runner.run(h.system);
        const first = h.state.resolved;
        expect(first).toBe(N);

        for (let f = 0; f < 5; f++) h.runner.run(h.system);
        // Nothing moved and nothing joined, so there was nothing to ask again.
        expect(h.state.resolved).toBe(first);
        expect(h.seen.length).toBe(6);
        expect(h.seen[5]).toEqual(h.seen[0]);
    });

    it('follows the addresses when the engine says its pools moved', () => {
        const h = harness();
        for (let i = 0; i < N; i++) h.spawn();
        h.runner.run(h.system);
        const before = h.seen[0]!;

        // What a C++ system's insert does to a pool: every component of that type
        // is somewhere else, and nothing in JS was called.
        h.state.base += 1 << 20;
        h.state.epoch++;
        h.runner.run(h.system);

        const after = h.seen[1]!;
        expect(after).not.toEqual(before);
        expect(after).toEqual(before.map((a) => a + (1 << 20)));
    });

    it('follows the entity set without needing the epoch to say so', () => {
        const h = harness();
        for (let i = 0; i < N; i++) h.spawn();
        h.runner.run(h.system);
        expect(h.seen[0]!.length).toBe(N);

        h.spawn();
        h.runner.run(h.system);
        expect(h.seen[1]!.length).toBe(N + 1);
    });

    it('follows a reorder, which moves neither the count nor the epoch', () => {
        const h = harness();
        const entities = [];
        for (let i = 0; i < N; i++) entities.push(h.spawn());
        h.runner.run(h.system);
        const before = h.seen[0]!;

        // The same entities the other way round: a cache that only counted rows
        // would hand the compiled code last frame's order, and the closure it must
        // agree with iterates the new one.
        h.world.applyEntityOrder([...entities].reverse());
        h.runner.run(h.system);

        expect(h.seen[1]).toEqual([...before].reverse());
    });

    it('re-resolves every frame when the engine cannot be asked', () => {
        const h = harness({ epochBinding: false });
        for (let i = 0; i < N; i++) h.spawn();

        h.runner.run(h.system);
        h.runner.run(h.system);
        h.runner.run(h.system);
        // An artifact with no epoch binding is one that cannot promise anything
        // stayed put, so the rows are rebuilt — the same cost as before this
        // cache existed, which is the point: it degrades, it does not guess.
        expect(h.state.resolved).toBe(3 * N);
    });

    it('lays out a SysCtx whichever way the rows came', () => {
        const h = harness();
        for (let i = 0; i < N; i++) h.spawn();
        h.runner.run(h.system);
        // The arena's shape is the ABI's, not the cache's: rows begin after the
        // SysCtx and one QueryRows record, cached or freshly packed.
        expect(h.seen[0]!.length).toBe(N);
        expect(SYSCTX_WORDS).toBe(6);
    });
});
