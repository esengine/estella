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
 *          Loud skip without emsdk — the module here is really compiled.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

    it.skipIf(!EMCC)('one call, and the scheduler runs the twin', async () => {
        const wasm = buildFadeModule(EMCC!);

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
            manifest: fadeManifest(projectShapeDigest([{ name: 'Fade', fields: ['alpha'] }])),
            wasm: buildFadeModule(EMCC!), resources: () => undefined,
        })).rejects.toThrow(/Rebuild the project/);
    });

    it.skipIf(!EMCC)('and installs nothing when it refuses', async () => {
        const p = project();
        const entities = seed(p.world, p.Fade);
        await installAot({
            world: p.world, runner: p.runner, host: new FakeEngine(),
            manifest: fadeManifest(), wasm: buildFadeModule(EMCC!), resources: () => undefined,
        }).catch(() => { /* the ordering check below is the point */ });
        // Rows already existed, so pool memory could not move: the install threw
        // before any twin was registered, and the closure still runs.
        p.runner.run(p.system);
        expect((p.world.get(entities[0]!, p.Fade) as { alpha: number }).alpha).toBeCloseTo(0.09, 10);
    });
});
