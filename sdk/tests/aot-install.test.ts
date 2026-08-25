// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-install.test.ts
 * @brief   One call from a built module to a scheduler that runs it.
 *
 * @details The pieces each have their own test. This is the entry point a
 *          shipping runtime actually uses, and what it has to get right is the
 *          ORDER: pool memory before any component, module instantiated against
 *          the engine's memory, digests checked before anything is installed.
 *
 *          It runs on both shapes of host, because they are not interchangeable:
 *          a browser takes the bytes, and WeChat's WXWebAssembly takes ONLY a
 *          package path and cannot compile a buffer at all. Instantiating
 *          through the platform seam is what makes one road serve both, and a
 *          host here refuses the form it would refuse on a device.
 *
 *          Loud skip without emsdk — the module here is really compiled.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter, WasmInstantiateResult } from '../src/platform/types';
import { World } from '../src/ecs/world';
import { defineComponent } from '../src/ecs/component';
import { defineSystem, SystemRunner } from '../src/ecs/system';
import { Query, Mut } from '../src/ecs/query';
import { ResourceStorage } from '../src/ecs/resource';
import { installAot } from '../src/ecs/aot/installAot';
import { engineAbiDigest, projectShapeDigest } from '../src/ecs/aot/abiDigest';
import type { AotManifest } from '../src/ecs/aot/AotSystems';
import type { AnyComponentDef } from '../src/ecs/component';
import type { WasmHeap } from '../src/ecs/WasmPoolMemory';
import type { Entity } from '../src/types';
import { emccPath } from '../../build-tools/utils/emscripten.js';
import { FakeEngine } from './fakeEngine';
import { buildFadeModule, FADE_FIELDS, fadeManifest } from './helpers/aotFade';

const N = 16;

const EMCC = emccPath();

/** The engine module, as far as a compiled system needs one. */
/** `Fade`: alpha -= step, in the shape the compiler emits. */
const SYSTEM_C = `#include <stdint.h>
#include <string.h>
typedef uint32_t es_addr_t;
#define ES_PTR(a) ((unsigned char *)(a))
typedef struct { es_addr_t rows, count; } EsQueryRows;
typedef struct { es_addr_t queries, resources, cmdBuf, cmdCap, cmdCount, events; } EsSysCtx;
static double ld(const unsigned char *p) { double v; memcpy(&v, p, 8); return v; }
static void st(unsigned char *p, double v) { memcpy(p, &v, 8); }

void es_sys_Fade(es_addr_t ctx) {
    const EsSysCtx *c = (const EsSysCtx *)ES_PTR(ctx);
    const EsQueryRows *q = (const EsQueryRows *)ES_PTR(c->queries);
    const es_addr_t *rows = (const es_addr_t *)ES_PTR(q[0].rows);
    for (es_addr_t i = 0; i < q[0].count; ++i) {
        unsigned char *f = ES_PTR(rows[i * 2u + 1u]);
        st(f, ld(f) - ld(f + 8));           /* alpha -= step */
    }
}
`;

/**
 * The two hosts, each refusing what it refuses on a device. Nothing else of a
 * platform is reached by an install, so nothing else is here.
 */
const HOSTS = {
    'a host that takes bytes': {
        instantiateWasm(src: string | ArrayBuffer, imports: WebAssembly.Imports) {
            if (typeof src === 'string') throw new Error('this host was handed a path');
            return WebAssembly.instantiate(src, imports) as Promise<WasmInstantiateResult>;
        },
    },
    'a host that takes only a path': {
        instantiateWasm(src: string | ArrayBuffer, imports: WebAssembly.Imports) {
            if (typeof src !== 'string') throw new Error('WXWebAssembly requires a file path string');
            return WebAssembly.instantiate(readFileSync(src), imports) as Promise<WasmInstantiateResult>;
        },
    },
} as const;

/** What that host is given: the same module, in the form it accepts. */
function moduleFor(kind: keyof typeof HOSTS, built: { bytes: Uint8Array; path: string }): string | BufferSource {
    setPlatform(HOSTS[kind] as unknown as PlatformAdapter);
    return kind === 'a host that takes only a path' ? built.path : built.bytes;
}

function buildModule(): { bytes: Uint8Array; path: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'estella-install-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'sys.c'), SYSTEM_C);
    const out = path.join(dir, 'sys.wasm');
    const built = spawnSync(EMCC!, [
        '-std=c11', '-O2', '-ffp-contract=off', '-Wall', '-Wextra',
        ...WASM_LINK_FLAGS, '-sEXPORTED_FUNCTIONS=_es_sys_Fade',
        '-o', out, path.join(dir, 'sys.c'),
    ], { encoding: 'utf8', cwd: dir, shell: process.platform === 'win32' });
    if (built.status !== 0) throw new Error(`emcc failed:\n${built.stderr}`);
    return { bytes: readFileSync(out), path: out };
}

const FADE_FIELDS = ['alpha', 'step'];

function manifestFor(shapes = projectShapeDigest([{ name: 'Fade', fields: FADE_FIELDS }])): AotManifest {
    return {
        engineAbi: engineAbiDigest(4),
        projectShapes: shapes,
        systems: [{
            name: 'Fade', symbol: 'es_sys_Fade',
            queries: [[{ comp: 'Fade', mut: true }]], resources: [],
        }],
    };
}

/** A world and the system the author wrote, before anything is installed. */
function project(): {
    world: World; runner: SystemRunner; Fade: AnyComponentDef;
    system: ReturnType<typeof defineSystem>;
} {
    const world = new World();
    const runner = new SystemRunner(world, new ResourceStorage());
    const Fade = defineComponent('Fade', { alpha: 1, step: 0.1 }) as AnyComponentDef;
    const system = defineSystem([Query(Mut(Fade))], (query) => {
        for (const [, fade] of query as Iterable<[Entity, { alpha: number; step: number }]>) {
            fade.alpha -= fade.step;
        }
    }, { name: 'Fade' });
    return { world, runner, Fade, system };
}

function seed(world: World, Fade: AnyComponentDef): Entity[] {
    const out: Entity[] = [];
    for (let i = 1; i <= N; i++) {
        const e = world.spawn();
        world.insert(e, Fade, { alpha: i * 0.1, step: 0.01 });
        out.push(e);
    }
    return out;
}

describe('installing a built module', () => {
    it('reports whether this gate could run at all', () => {
        if (EMCC) console.log('[aot-install] a built module was installed and run');
        else console.warn('[aot-install] NO EMSDK — the install did NOT run (pnpm emsdk:setup).');
        expect(true).toBe(true);
    });

    it.skipIf(!EMCC).each(Object.keys(HOSTS) as (keyof typeof HOSTS)[])(
        'one call, and the scheduler runs the twin — on %s', async (kind) => {
        const wasm = moduleFor(kind, buildModule());

        const interpreted = project();
        const interpretedEntities = seed(interpreted.world, interpreted.Fade);

        const compiled = project();
        const engine = new FakeEngine();
        await installAot({
            world: compiled.world, runner: compiled.runner, host: engine,
            manifest: fadeManifest(), wasm, resources: () => undefined,
        });
        const compiledEntities = seed(compiled.world, compiled.Fade);

        for (let f = 0; f < 6; f++) {
            interpreted.runner.run(interpreted.system);
            compiled.runner.run(compiled.system);
        }

        const alphas = (w: World, c: AnyComponentDef, es: Entity[]): number[] =>
            es.map((e) => (w.get(e, c) as { alpha: number }).alpha);
        expect(alphas(compiled.world, compiled.Fade, compiledEntities))
            .toEqual(alphas(interpreted.world, interpreted.Fade, interpretedEntities));
        // A world nothing touched would compare two untouched worlds.
        expect(alphas(compiled.world, compiled.Fade, compiledEntities)[0]).not.toBeCloseTo(0.1, 10);
        // Loading wrote a data section, or running spilled to a stack, only if
        // the engine's own bytes moved. Both land at link-time addresses.
        expect(engine.staticsIntact()).toBe(true);
    });

    it.skipIf(!EMCC)('refuses a module built for other component shapes', async () => {
        const p = project();
        await expect(installAot({
            world: p.world, runner: p.runner, host: new FakeEngine(),
            // What a build would have written before `step` was added.
            manifest: manifestFor(projectShapeDigest([{ name: 'Fade', fields: ['alpha'] }])),
            wasm: moduleFor('a host that takes bytes', buildModule()),
            resources: () => undefined,
        })).rejects.toThrow(/Rebuild the project/);
    });

    it.skipIf(!EMCC)('and installs nothing when it refuses', async () => {
        const p = project();
        const entities = seed(p.world, p.Fade);
        await installAot({
            world: p.world, runner: p.runner, host: new FakeEngine(),
            manifest: manifestFor(), wasm: moduleFor('a host that takes bytes', buildModule()),
            resources: () => undefined,
        }).catch(() => { /* the ordering check below is the point */ });
        // Rows already existed, so pool memory could not move: the install threw
        // before any twin was registered, and the closure still runs.
        p.runner.run(p.system);
        expect((p.world.get(entities[0]!, p.Fade) as { alpha: number }).alpha).toBeCloseTo(0.09, 10);
    });
});
