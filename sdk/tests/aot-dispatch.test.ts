// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-dispatch.test.ts
 * @brief   The scheduler runs a compiled twin, and the world comes out the same.
 *
 * @details The differential moved up one level. Everything before compared a
 *          compiled system against an oracle by hand; this schedules the SAME
 *          system twice — once as the TypeScript closure the author wrote, once
 *          as the twin a build produced — and requires the two worlds to agree.
 *
 *          That is the shape of the pixel gate the roadmap ends at, minus the
 *          pixels: same project, two runs, and nothing may differ.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { Query, Mut, Changed } from '../src/ecs/query';
import { ResourceStorage } from '../src/ecs/resource';
import { WasmPoolMemory, type WasmHeap } from '../src/ecs/WasmPoolMemory';
import { AotContext } from '../src/ecs/aot/AotContext';
import { AotSystems, type AotManifest } from '../src/ecs/aot/AotSystems';
import type { AotAddresses, AotRuntime } from '../src/ecs/aot/AotRuntime';
import { AotDispatch } from '../src/ecs/aot/AotDispatch';
import type { AnyComponentDef } from '../src/ecs/component';
import { engineAbiDigest, projectShapeDigest } from '../src/ecs/aot/abiDigest';
import type { Entity } from '../src/types';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { FakeEngine } from './fakeEngine';
import { buildAotModule } from './helpers/aotFade';

const N = 20;
const FRAMES = 10;
/** What a build for THIS engine would have written into the manifest. */
const ENGINE = engineAbiDigest(4);
const DECAY_FIELDS = ['remaining', 'rate'];
const SHAPES = projectShapeDigest([{ name: 'Decay', fields: DECAY_FIELDS }]);

const EMCC = emccPath();

/** `Decay`: remaining -= rate, and despawn once it reaches zero. */
const SYSTEM_C = `#include <stdint.h>
#include <string.h>
typedef uint32_t es_addr_t;
#define ES_PTR(a) ((unsigned char *)(a))
typedef struct { es_addr_t rows, count; } EsQueryRows;
typedef struct { uint32_t kind, a, b, c; } EsCmd;
typedef struct { es_addr_t queries, resources, cmdBuf, cmdCap, cmdCount, events; } EsSysCtx;
static double ld(const unsigned char *p) { double v; memcpy(&v, p, 8); return v; }
static void st(unsigned char *p, double v) { memcpy(p, &v, 8); }

void es_sys_Decay(es_addr_t ctx) {
    const EsSysCtx *c = (const EsSysCtx *)ES_PTR(ctx);
    const EsQueryRows *q = (const EsQueryRows *)ES_PTR(c->queries);
    EsCmd *cmds = (EsCmd *)ES_PTR(c->cmdBuf);
    uint32_t *count = (uint32_t *)ES_PTR(c->cmdCount);
    uint32_t n = *count;
    const es_addr_t *rows = (const es_addr_t *)ES_PTR(q[0].rows);
    for (es_addr_t i = 0; i < q[0].count; ++i) {
        const es_addr_t *row = rows + i * 2u;
        unsigned char *m = ES_PTR(row[1]);
        st(m, ld(m) - ld(m + 8));            /* remaining -= rate */
        if (ld(m) <= 0.0 && n < (uint32_t)c->cmdCap) {
            cmds[n].kind = 1u; cmds[n].a = (uint32_t)row[0];
            cmds[n].b = 0u; cmds[n].c = 0u; n += 1u;
        }
    }
    *count = n;
}
`;

const buildModule = (): Uint8Array => buildAotModule(EMCC!, SYSTEM_C, 'es_sys_Decay');

/**
 * The system the author wrote. The twin is held against THIS, so the C above is
 * the compiler's job to produce — here it stands in for what it produced.
 */
function makeWorld(): {
    world: World; runner: SystemRunner; Decay: AnyComponentDef; system: ReturnType<typeof defineSystem>;
} {
    const world = new World();
    const resources = new ResourceStorage();
    const runner = new SystemRunner(world, resources);
    const Decay = defineComponent('Decay', { remaining: 1, rate: 0.1 }) as AnyComponentDef;
    const system = defineSystem([Query(Mut(Decay))], (query) => {
        const doomed: Entity[] = [];
        for (const [entity, decay] of query as Iterable<[Entity, { remaining: number; rate: number }]>) {
            decay.remaining -= decay.rate;
            if (decay.remaining <= 0) doomed.push(entity);
        }
        for (const entity of doomed) world.despawn(entity);
    }, { name: 'Decay' });
    return { world, runner, Decay, system };
}

function seed(world: World, Decay: AnyComponentDef): Entity[] {
    const out: Entity[] = [];
    for (let i = 1; i <= N; i++) {
        const entity = world.spawn();
        world.insert(entity, Decay, { remaining: i * 0.1, rate: 0.1 });
        out.push(entity);
    }
    return out;
}

function snapshot(world: World, Decay: AnyComponentDef, entities: readonly Entity[]): string {
    return entities
        .filter((e) => world.valid(e) && world.has(e, Decay))
        .map((e) => `${e}:${(world.get(e, Decay) as { remaining: number }).remaining}`)
        .join(',');
}

describe('the scheduler and its compiled twin', () => {
    it('reports whether this gate could run at all', () => {
        if (EMCC) console.log('[aot-dispatch] the twin ran under the real runner');
        else console.warn('[aot-dispatch] NO EMSDK — the dispatch did NOT run (pnpm emsdk:setup).');
        expect(true).toBe(true);
    });

    it('with nothing installed there is nothing to dispatch to', () => {
        const { runner, Decay, system, world } = makeWorld();
        const entities = seed(world, Decay);
        runner.useAot(null);
        runner.run(system);
        // The closure ran: this is the path every editor preview takes, and it
        // must not have noticed that AOT exists.
        expect((world.get(entities[9]!, Decay) as { remaining: number }).remaining)
            .toBeCloseTo(0.9, 10);
    });

    it.skipIf(!EMCC)('the twin leaves the world the closure would have', async () => {
        const bytes = buildModule();

        // Interpreted.
        const a = makeWorld();
        const aEntities = seed(a.world, a.Decay);
        for (let f = 0; f < FRAMES; f++) a.runner.run(a.system);

        // Compiled, over rows in a linear memory the module shares.
        const b = makeWorld();
        const heap = new FakeEngine();
        const memory = new WasmPoolMemory(heap);
        b.world.useScriptPoolMemory(memory);
        const bEntities = seed(b.world, b.Decay);

        const instance = await WebAssembly.instantiate(
            new WebAssembly.Module(bytes as unknown as BufferSource),
            { env: { memory: heap.memory } });
        const exports = instance.exports as unknown as Record<string, unknown>;
        (exports['_initialize'] as (() => void) | undefined)?.();

        const manifest: AotManifest = {
            engineAbi: ENGINE,
            projectShapes: SHAPES,
            systems: [{
                name: 'Decay', symbol: 'es_sys_Decay',
                queries: [[{ comp: 'Decay', mut: true }]], resources: [],
            }],
        };
        const systems = new AotSystems();
        systems.install(manifest, exports, (name) => (name === 'Decay' ? b.Decay : undefined));

        const addresses: AotAddresses = {
            componentNamed: (name) => (name === 'Decay' ? b.Decay : undefined),
            resourceAt: () => undefined,
        };
        const runtime: AotRuntime = {
            systems, addresses, ctx: new AotContext(memory),
            dispatcherFor: (w) => new AotDispatch(w, runtime),
        };
        b.runner.useAot(runtime);

        for (let f = 0; f < FRAMES; f++) b.runner.run(b.system);

        expect(snapshot(b.world, b.Decay, bEntities)).toBe(snapshot(a.world, a.Decay, aEntities));
        // A run where nothing despawned would compare two full worlds and prove
        // only that neither moved.
        expect(aEntities.filter((e) => a.world.valid(e)).length).toBeLessThan(N);
        expect(aEntities.filter((e) => a.world.valid(e)).length).toBeGreaterThan(0);
        // Nothing the module did may reach the bytes the engine keeps for
        // itself — not its data section on load, not a stack spill on a call.
        expect(heap.staticsIntact()).toBe(true);
    });

    it.skipIf(!EMCC)('a twin marks Changed, which it cannot do for itself', async () => {
        // The compiled code calls nothing, so a `Mut` it honoured is invisible
        // unless the host records it. A watcher is the only thing that can tell.
        const bytes = buildModule();
        const seen: number[] = [];

        const build = async (compiled: boolean): Promise<number[]> => {
            const w = makeWorld();
            const watched: number[] = [];
            const watcher = defineSystem([Query(Changed(w.Decay))], (query) => {
                let n = 0;
                for (const _ of query as Iterable<unknown>) n++;
                watched.push(n);
            }, { name: 'Watcher' });
            const heap = new FakeEngine();
            const memory = new WasmPoolMemory(heap);
            if (compiled) w.world.useScriptPoolMemory(memory);
            seed(w.world, w.Decay);

            if (compiled) {
                const instance = await WebAssembly.instantiate(
                    new WebAssembly.Module(bytes as unknown as BufferSource),
                    { env: { memory: heap.memory } });
                const exports = instance.exports as unknown as Record<string, unknown>;
                (exports['_initialize'] as (() => void) | undefined)?.();
                const systems = new AotSystems();
                systems.install({
                    engineAbi: ENGINE,
                    projectShapes: SHAPES,
                    systems: [{
                        name: 'Decay', symbol: 'es_sys_Decay',
                        queries: [[{ comp: 'Decay', mut: true }]], resources: [],
                    }],
                }, exports, (name) => (name === 'Decay' ? w.Decay : undefined));
                const runtime: AotRuntime = {
                    systems,
                    addresses: {
                        componentNamed: (name) => (name === 'Decay' ? w.Decay : undefined),
                        resourceAt: () => undefined,
                    },
                    ctx: new AotContext(memory),
                    dispatcherFor: (world) => new AotDispatch(world, runtime),
                };
                w.runner.useAot(runtime);
            }
            for (let f = 0; f < 4; f++) {
                w.world.advanceTick();
                w.runner.run(w.system);
                w.runner.run(watcher);
            }
            return watched;
        };

        const interpreted = await build(false);
        const compiled = await build(true);
        seen.push(...compiled);
        expect(interpreted.some((n) => n > 0), 'the watcher never saw a change either way')
            .toBe(true);
        expect(compiled).toEqual(interpreted);
    });

    it('a module built for another ENGINE is refused, and says which', () => {
        const systems = new AotSystems();
        const manifest: AotManifest = {
            engineAbi: 'deadbeefdeadbeef', projectShapes: SHAPES, systems: [],
        };
        // The message has to name the fix, and the fix for this one is to rebuild
        // the module — not the project.
        expect(() => systems.install(manifest, {}, () => undefined))
            .toThrow(/Rebuild the module against this engine/);
        expect(systems.size).toBe(0);
    });

    it('a module built for other COMPONENT SHAPES is refused, and says which', () => {
        const w = makeWorld();
        const systems = new AotSystems();
        const manifest: AotManifest = {
            engineAbi: ENGINE,
            // What a build would have written before someone added a field.
            projectShapes: projectShapeDigest([{ name: 'Decay', fields: ['remaining'] }]),
            systems: [{
                name: 'Decay', symbol: 'es_sys_Decay',
                queries: [[{ comp: 'Decay', mut: true }]], resources: [],
            }],
        };
        expect(() => systems.install(manifest, { es_sys_Decay: () => { /* */ } },
            (name) => (name === 'Decay' ? w.Decay : undefined)))
            .toThrow(/Rebuild the project/);
    });

    it('a component nobody compiled against does not invalidate a module', () => {
        const w = makeWorld();
        // Declared in this project and named by no compiled system: the digest is
        // scoped to what the module reads, so this must not refuse it.
        defineComponent('Unrelated', { whatever: 1 });
        const systems = new AotSystems();
        systems.install({
            engineAbi: ENGINE, projectShapes: SHAPES,
            systems: [{
                name: 'Decay', symbol: 'es_sys_Decay',
                queries: [[{ comp: 'Decay', mut: true }]], resources: [],
            }],
        }, { es_sys_Decay: () => { /* */ } }, (name) => (name === 'Decay' ? w.Decay : undefined));
        expect(systems.size).toBe(1);
    });

    it('a manifest naming a symbol the module lacks is refused too', () => {
        const systems = new AotSystems();
        const manifest: AotManifest = {
            engineAbi: ENGINE, projectShapes: projectShapeDigest([]),
            systems: [{ name: 'Ghost', symbol: 'es_sys_Ghost', queries: [], resources: [] }],
        };
        expect(() => systems.install(manifest, {}, () => undefined))
            .toThrow(/exports no 'es_sys_Ghost'/);
    });
});
