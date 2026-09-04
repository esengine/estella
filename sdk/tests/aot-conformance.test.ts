// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aot-conformance.test.ts
 * @brief   One source on two roads, frame for frame.
 *
 * @details The compiler holds its emitted C against its OWN interpreter, and
 *          this suite held hand-written C against expectations. Neither asks
 *          the question a player asks: does the module the compiler makes of a
 *          system do what the author's closure does, in the App that runs it?
 *
 *          So the same file is read twice — as closures, and as the artifact a
 *          real build produces — and the worlds are compared after every frame.
 *          Loud skip without emsdk: a differential that never compiled anything
 *          agrees with itself.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { lowerProgram, brokenPromises } from '../../compiler/src/frontend';
import { builtinShapes } from '../../compiler/src/builtins';
import { inlineSystem } from '../../compiler/src/inline';
import { packLayout } from '../../compiler/src/abi';
import { emitC, moduleDeclarations, WASM_LINK_FLAGS } from '../../compiler/src/codegen';
import { emccPath } from '../../build-tools/utils/emscripten.js';

import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { createMockModule } from './mocks/wasm';
import { FakeEngine } from './fakeEngine';
import { useBytesPlatform } from './helpers/aotFade';
import { Schedule } from '../src/ecs/system';
import type { AotManifest } from '../src/ecs/aot/AotSystems';
import type { Entity } from '../src/types';

const EMCC = emccPath();
const FIXTURE = path.resolve(__dirname, 'fixtures/conformance-systems.ts');
const FRAMES = 12;
const DT = 1 / 60;

/** The artifact a build makes of the fixture: the module, and what it declares. */
function compileFixture(emcc: string): { wasm: Uint8Array; manifest: AotManifest } {
    const lowered = lowerProgram([FIXTURE], builtinShapes());
    expect(brokenPromises(lowered), 'the fixture must compile').toEqual([]);
    const inlined = lowered.module.systems.map((s) => inlineSystem(s, lowered.module.fns));
    const c = emitC(lowered.module, packLayout(lowered.module.comps), inlined, 4);

    const dir = mkdtempSync(path.join(tmpdir(), 'estella-conf-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'estella_abi.h'), c.header);
    writeFileSync(path.join(dir, 'estella_offsets.h'), c.offsets);
    writeFileSync(path.join(dir, 'sys.c'), c.source);
    const out = path.join(dir, 'sys.wasm');
    const built = spawnSync(emcc, [
        '-std=c11', '-O2', '-ffp-contract=off', '-Wall', '-Wextra',
        ...WASM_LINK_FLAGS, `-sEXPORTED_FUNCTIONS=${c.symbols.map((s) => `_${s}`).join(',')}`,
        '-o', out, path.join(dir, 'sys.c'),
    ], { encoding: 'utf8', cwd: dir, shell: process.platform === 'win32' });
    if (built.status !== 0) throw new Error(`emcc failed:\n${built.stderr}`);

    return {
        wasm: readFileSync(out),
        manifest: {
            engineAbi: c.handshake.engineAbi,
            projectShapes: c.handshake.projectShapes,
            moduleContract: c.handshake.moduleContract,
            systems: moduleDeclarations(lowered.module, inlined),
        },
    };
}

/** The world the fixture's systems touch, after each frame. */
type Trace = number[][][];

async function play(compiled: { wasm: Uint8Array; manifest: AotManifest } | null): Promise<{
    trace: Trace; calls: number;
}> {
    // One context for both roads on purpose: the fixture's `defineComponent`
    // runs once, at import, and a road that reset the registry under it would
    // hand the runtime a project with no components at all.
    useBytesPlatform();
    const app = App.new();
    const module = createMockModule();
    app.connectCpp(module.getRegistry(), module);
    const fixture = await import('./fixtures/conformance-systems');
    app.addSystemToSchedule(Schedule.Update, fixture.driftSystem);
    app.addSystemToSchedule(Schedule.Update, fixture.clampSystem);

    // Before the first pooled component: a pool cannot move to other memory
    // once it has rows, and the module addresses only the heap it was given.
    let runtime = null as { systems: { calls: number } } | null;
    if (compiled) {
        await app.useCompiledSystems({
            host: new FakeEngine(), manifest: compiled.manifest, wasm: compiled.wasm,
        });
        runtime = (app as unknown as { aot_: { systems: { calls: number } } }).aot_;
    }

    const seeds: [number, number][] = [[0, 120], [9.5, 60], [-9.5, -60], [3, -300]];
    const entities: Entity[] = seeds.map(([x, speed]) => {
        const e = app.world.spawn();
        app.world.insert(e, fixture.Mover, { x, speed, bounces: 0 });
        return e;
    });

    const trace: Trace = [];
    for (let f = 0; f < FRAMES; f++) {
        await app.tick(DT);
        trace.push(entities.map((e) => {
            const m = app.world.get(e, fixture.Mover) as { x: number; speed: number; bounces: number };
            return [m.x, m.speed, m.bounces];
        }));
    }
    return { trace, calls: runtime?.systems.calls ?? 0 };
}

describe.skipIf(!EMCC)('one source, interpreted and compiled', () => {
    it('answers the same world after every frame', async () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const artifact = compileFixture(EMCC!);
        const interpreted = await play(null);
        const twins = await play(artifact);

        // Installed is not the same question as ran, and a differential cannot
        // tell them apart — the closure that would have run produces the same
        // numbers. Two systems, every frame.
        expect(twins.calls).toBe(FRAMES * 2);
        expect(interpreted.calls).toBe(0);

        // Frame for frame, so a divergence names the frame it began on rather
        // than only the state it ended in.
        for (let f = 0; f < FRAMES; f++) {
            expect([f, twins.trace[f]]).toEqual([f, interpreted.trace[f]]);
        }
        // And the run went somewhere: a fixture whose systems do nothing agrees
        // on every road.
        expect(interpreted.trace[FRAMES - 1]).not.toEqual(interpreted.trace[0]);
    });
});
