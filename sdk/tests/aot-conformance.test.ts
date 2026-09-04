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
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { lowerProgram, brokenPromises } from '../../compiler/src/frontend';
import { builtinShapes } from '../../compiler/src/builtins';
import { inlineSystem } from '../../compiler/src/inline';
import { packLayout } from '../../compiler/src/abi';
import { emitC, moduleDeclarations } from '../../compiler/src/codegen';
import { emccPath } from '../../build-tools/utils/emscripten.js';

import { App } from '../src/app/app';
import { AppContext, setDefaultContext } from '../src/ecs/context';
import { setEditorMode, setPlayMode } from '../src/ecs/env';
import { createMockModule } from './mocks/wasm';
import { FakeEngine } from './fakeEngine';
import { buildAotModule, useBytesPlatform } from './helpers/aotFade';
import { Schedule, defineSystem } from '../src/ecs/system';
import { Query, Changed } from '../src/ecs/query';
import { Time } from '../src/ecs/resource';
import type { AotManifest } from '../src/ecs/aot/AotSystems';
import type { Entity } from '../src/types';

const EMCC = emccPath();
const FIXTURE = path.resolve(__dirname, 'fixtures/conformance-systems.ts');
const FRAMES = 12;
const DT = 1 / 60;

/** The seed world, at module scope because two readers need the same one: the
 *  suite that plays it, and the header the native harness starts from. */
const SEEDS: readonly (readonly [number, number])[] =
    [[0, 120], [9.5, 60], [-9.5, -60], [3, -300]];

/** The population an event feeds and a command removes, at three thresholds so
 *  they leave on three different frames rather than all at once. */
const DOOMED: readonly number[] = [0, 2, 4];

/** Where the native harness reads its inputs. Its own directory: the emitted C
 *  includes `estella_offsets.h` by that name and guards it by that name, so two
 *  fixtures cannot share one. */
const NATIVE_DIR = path.resolve(__dirname, '../../tests/aot/generated/conformance');
/** The project a native host runs the same fixture as, scripts and all. */
const PROJECT_DIR = path.resolve(__dirname, '../../fixtures/aot-conformance/src');
const WRITE = process.env['ESTELLA_AOT_WRITE'] === '1';

/** The artifact a build makes of the fixture: the module, and what it declares. */
function compileFixture(emcc: string): { wasm: Uint8Array; manifest: AotManifest } {
    const lowered = lowerProgram([FIXTURE], builtinShapes());
    expect(brokenPromises(lowered), 'the fixture must compile').toEqual([]);
    const inlined = lowered.module.systems.map((s) => inlineSystem(s, lowered.module.fns));
    const c = emitC(lowered.module, packLayout(lowered.module.comps), inlined, 4);

    // Through the one spelling of "how the emitted C is compiled", so this road
    // is built the way a shipped project's is rather than nearly that way.
    const wasm = buildAotModule(emcc, c.source, c.symbols, {
        'estella_abi.h': c.header,
        'estella_offsets.h': c.offsets,
    });

    return {
        wasm,
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
/** The resource one of them WRITES, after each frame: [bounces, frames]. */
type ResTrace = number[][];
/** How many rows a `Changed(Mover)` watcher matched, after each frame. */
type TickTrace = number[];
/** The despawned population, after each frame: [alive, total ttl]. */
type PopTrace = number[][];

async function play(compiled: { wasm: Uint8Array; manifest: AotManifest } | null): Promise<{
    trace: Trace; resource: ResTrace; ticks: TickTrace; pop: PopTrace;
    calls: number; delta: number;
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
    app.addSystemToSchedule(Schedule.Update, fixture.tallySystem);
    // The three the LOADING road refuses: a writer, a reader and a despawn.
    // On that road they interpret, which is what makes the trace one answer.
    app.addSystemToSchedule(Schedule.Update, fixture.announceSystem);
    app.addSystemToSchedule(Schedule.Update, fixture.absorbSystem);
    app.addSystemToSchedule(Schedule.Update, fixture.reapSystem);
    // After the reap, so its query walks a set that SHRANK this frame.
    app.addSystemToSchedule(Schedule.Update, fixture.censusSystem);
    // Interpreted, and last: the Changed ticks a twin leaves are the one duty
    // no value in the trace can show. A watcher counts what a filter matched,
    // which is the same question a game asks of change detection.
    const ticks: TickTrace = [];
    app.addSystemToSchedule(Schedule.Update, defineSystem([Query(Changed(fixture.Mover))],
        (query) => {
            let n = 0;
            for (const _row of query) n++;
            ticks.push(n);
        }, { name: 'ConfWatch' }));
    // NOT inserted: a project resource nothing has touched yet is exactly the
    // case a shipped game boots in, and the handshake has to find it by the name
    // the manifest carries or refuse the module over a resource that is there.

    // Before the first pooled component: a pool cannot move to other memory
    // once it has rows, and the module addresses only the heap it was given.
    let runtime = null as { systems: { calls: number } } | null;
    if (compiled) {
        await app.useCompiledSystems({
            host: new FakeEngine(), manifest: compiled.manifest, wasm: compiled.wasm,
        });
        runtime = (app as unknown as { aot_: { systems: { calls: number } } }).aot_;
    }

    const entities: Entity[] = SEEDS.map(([x, speed]) => {
        const e = app.world.spawn();
        app.world.insert(e, fixture.Mover, { x, speed, bounces: 0 });
        return e;
    });

    const doomed: Entity[] = DOOMED.map((ttl) => {
        const e = app.world.spawn();
        app.world.insert(e, fixture.Doomed, { ttl });
        return e;
    });

    const trace: Trace = [];
    const resource: ResTrace = [];
    const pop: PopTrace = [];
    for (let f = 0; f < FRAMES; f++) {
        await app.tick(DT);
        trace.push(entities.map((e) => {
            const m = app.world.get(e, fixture.Mover) as { x: number; speed: number; bounces: number };
            return [m.x, m.speed, m.bounces];
        }));
        // A ResMut is written into the MIRROR; this reads the world, which is
        // where it lands only if the road copied it back.
        const tally = app.getResource(fixture.Tally) as
            { bounces: number; frames: number; census: number };
        resource.push([tally.bounces, tally.frames, tally.census]);
        // What the event fed and the command removed. A despawn that reached
        // one world and not the other is a count that stops agreeing.
        const alive = doomed.filter((e) => app.world.valid(e));
        pop.push([alive.length, alive.reduce((n, e) =>
            n + (app.world.get(e, fixture.Doomed) as { ttl: number }).ttl, 0)]);
    }
    // The delta the interpreter was HANDED, which is what the native harness is
    // given: `tick` scales what it is asked for, and a harness restating 1/60
    // would be a second opinion about the frame rather than a reading of it.
    const time = (app as unknown as { resources_: { get: (r: unknown) => { delta: number } } })
        .resources_.get(Time);
    return { trace, resource, ticks, pop, calls: runtime?.systems.calls ?? 0, delta: time.delta };
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
        // numbers. Three systems, every frame.
        expect(twins.calls).toBe(FRAMES * 7);
        expect(interpreted.calls).toBe(0);

        // Frame for frame, so a divergence names the frame it began on rather
        // than only the state it ended in.
        for (let f = 0; f < FRAMES; f++) {
            expect([f, twins.trace[f]]).toEqual([f, interpreted.trace[f]]);
            // The resource a twin WROTE, read back out of the world: the road
            // that never copied the mirror back would leave it at its default
            // while every row above still agreed.
            expect([f, twins.resource[f]]).toEqual([f, interpreted.resource[f]]);
            // The ticks the compiled code could not leave, which the host has
            // to mark instead. Nothing in the world's VALUES shows them.
            expect([f, twins.ticks[f]]).toEqual([f, interpreted.ticks[f]]);
            expect([f, twins.pop[f]]).toEqual([f, interpreted.pop[f]]);
        }
        // And the run went somewhere: a fixture whose systems do nothing agrees
        // on every road.
        expect(interpreted.trace[FRAMES - 1]).not.toEqual(interpreted.trace[0]);
        // A watcher that matched nothing agrees on every road: the tick
        // comparison above is only worth running if something was ticked.
        expect(interpreted.ticks.some((n) => n > 0)).toBe(true);
        // The event fed the population and the command emptied it: without both,
        // the five duties this fixture carries for the wasm road are untouched.
        expect(interpreted.pop[0]![1]).toBeGreaterThan(0);
        expect(interpreted.pop[FRAMES - 1]![0]).toBeLessThan(DOOMED.length);
    });
});

/**
 * The same lowering the wasm road takes, at the width a LOADING host uses.
 *
 * One source, two machines: the C is byte for byte the same file either way
 * and the width is a typedef the building compiler picks, so this is the same
 * artifact rather than a second one written for the harness.
 */
function nativeArtifact(): ReturnType<typeof emitC> {
    const lowered = lowerProgram([FIXTURE], builtinShapes());
    expect(brokenPromises(lowered), 'the fixture must compile').toEqual([]);
    const inlined = lowered.module.systems.map((s) => inlineSystem(s, lowered.module.fns));
    return emitC(lowered.module, packLayout(lowered.module.comps), inlined, 8);
}

/** A checked-in file derived from the fixture. Regenerate them all with
 *  `ESTELLA_AOT_WRITE=1 pnpm --filter @estella/sdk test aot-conformance`. */
function artifact(dir: string, name: string, want: string): void {
    const at = path.join(dir, name);
    if (WRITE) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(at, want);
        return;
    }
    expect(existsSync(at), `${name} is missing — regenerate with ESTELLA_AOT_WRITE=1`).toBe(true);
    // Normalised: git may have handed the working tree CRLF, and the difference
    // is not one anybody wants a diff about.
    const have = readFileSync(at, 'utf8').replace(/\r\n/g, '\n');
    expect(have, `${name} is stale — regenerate with ESTELLA_AOT_WRITE=1`).toBe(want);
}

/**
 * The fixture as a PROJECT imports it.
 *
 * A project's scripts import `esengine`; this file imports the SDK by relative
 * path so the suite and the compiler can both read it. The bodies must not
 * diverge, so the imports are rewritten and nothing else is touched.
 */
function projectSystems(): string {
    const RELATIVE = /^import \{([^}]*)\} from '\.\.\/\.\.\/src\/[^']*';$/;
    const names: string[] = [];
    const out: string[] = [];
    let at = -1;
    for (const line of readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
        const m = RELATIVE.exec(line);
        if (m === null) {
            out.push(line);
            continue;
        }
        for (const n of m[1]!.split(',')) if (n.trim() !== '') names.push(n.trim());
        if (at === -1) at = out.push('') - 1;
    }
    expect(names.length, 'the fixture imports the SDK by relative path').toBeGreaterThan(0);
    out[at] = `import { ${names.join(', ')} } from 'esengine';`;
    return [
        '// GENERATED from sdk/tests/fixtures/conformance-systems.ts — do not edit.',
        '// The same systems, with the imports a PROJECT writes. Regenerate with',
        '// ESTELLA_AOT_WRITE=1 pnpm --filter @estella/sdk test aot-conformance.',
        ...out,
    ].join('\n');
}

/** The seed world, where the project that plays it can read it. */
function projectSeed(): string {
    return [
        '// GENERATED from sdk/tests/aot-conformance.test.ts — do not edit.',
        '// The world the checked-in trace was recorded over.',
        '',
        'export const SEED: readonly (readonly [number, number])[] = [',
        ...SEEDS.map(([x, speed]) => `    [${x}, ${speed}],`),
        '];',
        '',
        '/** The population an event feeds and a command removes. */',
        `export const DOOMED: readonly number[] = [${DOOMED.join(', ')}];`,
        '',
        `export const FRAMES = ${FRAMES};`,
        '',
    ].join('\n');
}

/** A double as C source. Shortest round-trip: both languages read a decimal to
 *  the NEAREST binary64, so what JS prints is the number C gets back. `-0` is
 *  the one value JS prints without its sign, and `-speed` can produce it. */
function cDouble(v: number): string {
    if (Object.is(v, -0)) return '-0.0';
    const s = String(v);
    return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** The handshake the harness compares the artifact's own baked numbers against.
 *  From the same function the artifact's come from, so the harness carries no
 *  second opinion about what this engine or this build is. */
function handshakeHeader(h: { engineAbi: string; moduleContract: string }): string {
    return [
        '/* GENERATED by sdk/tests/aot-conformance.test.ts — do not edit. */',
        '/* The contract half of the handshake. The width half is the harness. */',
        `#define ES_CONF_EXPECTED_CONTRACT_HASH 0x${h.engineAbi}ULL`,
        '/* And which BUILD the artifact beside this one is. */',
        `#define ES_CONF_EXPECTED_MODULE_CONTRACT 0x${h.moduleContract}ULL`,
        '',
    ].join('\n');
}

/**
 * The interpreter's answer, as a header the native harness includes.
 *
 * The point is WHOSE answer it is: the harness held a twin loop written in C++,
 * which only ever asked whether two C-family readings of one struct agree.
 * This asks what the author's closure does.
 */
function traceHeader(run: { trace: Trace; delta: number }): string {
    return [
        '/* GENERATED by sdk/tests/aot-conformance.test.ts — do not edit. */',
        '/* What the INTERPRETER makes of sdk/tests/fixtures/conformance-systems.ts,',
        '   frame by frame, so a divergence names the frame it began on. */',
        '#ifndef ESTELLA_CONFORMANCE_TRACE_H',
        '#define ESTELLA_CONFORMANCE_TRACE_H',
        '',
        `#define ES_CONF_ENTITIES ${SEEDS.length}u`,
        `#define ES_CONF_FRAMES ${FRAMES}u`,
        '/* x, speed, bounces — ConfMover in declaration order, which is the order',
        '   the ABI lays a script record out in. */',
        '#define ES_CONF_FIELDS 3u',
        '/* The delta the interpreter was handed, rather than the one it asked for. */',
        `#define ES_CONF_DELTA ${cDouble(run.delta)}`,
        '',
        'static const double ES_CONF_SEED[ES_CONF_ENTITIES][ES_CONF_FIELDS] = {',
        ...SEEDS.map(([x, speed]) => `    { ${cDouble(x)}, ${cDouble(speed)}, 0.0 },`),
        '};',
        '',
        '/* After each frame, both systems having run in the order the schedule has',
        '   them: ConfDrift, then ConfClamp. */',
        'static const double ES_CONF_EXPECT[ES_CONF_FRAMES][ES_CONF_ENTITIES][ES_CONF_FIELDS] = {',
        ...run.trace.flatMap((frame, f) => [
            `    { /* frame ${f} */`,
            ...frame.map((m) => `        { ${m.map(cDouble).join(', ')} },`),
            '    },',
        ]),
        '};',
        '',
        '#endif',
        '',
    ].join('\n');
}

/**
 * The third road's inputs, written where a C++ harness can build them.
 *
 * Not behind emsdk: this is the compiler and the interpreter, and a machine
 * without emscripten still has to notice that the checked-in artifacts have
 * gone stale — otherwise the only gate on them is a road it cannot walk.
 */
describe('the inputs a loading host builds against', () => {
    it('the C the compiler makes of the fixture, at the loading width', () => {
        const c = nativeArtifact();
        artifact(NATIVE_DIR, 'estella_offsets.h', c.offsets);
        artifact(NATIVE_DIR, 'systems.c', c.source);
        artifact(NATIVE_DIR, 'systems_decl.c', c.decls);
        artifact(NATIVE_DIR, 'handshake.h', handshakeHeader(c.handshake));
    });

    it('and the answer the interpreter gives, for the harness to hold it against', async () => {
        setDefaultContext(new AppContext());
        setEditorMode(false);
        setPlayMode(false);
        const run = await play(null);
        // A seed world that ends where it started proves nothing on any road.
        expect(run.trace[FRAMES - 1]).not.toEqual(run.trace[0]);
        artifact(NATIVE_DIR, 'trace.h', traceHeader(run));
        // The same answer for a reader that is not a C compiler: the native
        // host road is driven from JS, and re-parsing the header there would be
        // a second reading of one number rather than the number.
        artifact(NATIVE_DIR, 'trace.json', `${JSON.stringify({
            delta: run.delta,
            fields: ['x', 'speed', 'bounces'],
            seed: SEEDS.map(([x, speed]) => [x, speed, 0]),
            frames: run.trace,
            // The resource a twin WROTE, read back out of the world. A road that
            // never copied the mirror back leaves it at its default while every
            // row above still agrees, which is why it is traced separately.
            resourceFields: ['bounces', 'frames', 'census'],
            resource: run.resource,
            // What a `Changed(Mover)` filter matched after each frame. Nothing
            // in the values above shows a tick, and a road that stopped marking
            // them agrees with every other column.
            ticks: run.ticks,
            // The population an event fed and a command emptied. The despawn is
            // the one effect no field of any surviving row can show.
            popFields: ['alive', 'ttl'],
            pop: run.pop,
        }, null, 2)}\n`);
    });

    // The third road runs the fixture as a shipped game, so it needs the source
    // as a project holds one. Generated rather than copied: a hand-kept twin is
    // the thing this whole differential exists to not have.
    it('and the fixture as a project imports it', () => {
        artifact(PROJECT_DIR, 'systems.generated.ts', projectSystems());
        artifact(PROJECT_DIR, 'seed.generated.ts', projectSeed());
    });
});
