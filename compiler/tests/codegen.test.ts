// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    codegen.test.ts
 * @brief   The compiled code and the interpreter must produce the SAME BYTES.
 *
 * @details Stage 2's exit criterion in miniature (docs/REARCH_AOT.md §10). Up to
 *          here every test has compared an interpreter against node; both are
 *          JavaScript, and neither is what ships. This one compiles the emitted
 *          C with a real compiler and runs it in another process.
 *
 *          The differential is over the IMAGE, not over selected fields. The
 *          host materialises a SysCtx, the bytes go to a program that knows
 *          nothing but `es_sys_*`, and what comes back is compared to what the
 *          interpreter produced from the identical starting bytes — memcmp, the
 *          whole world. A per-field check would pass while a system wrote one
 *          byte past a component, which is precisely the failure a contract made
 *          of offsets has.
 *
 *          Two more properties are asserted because they are what make this a
 *          contract rather than a convention: the object file has no undefined
 *          symbol besides the memory base (§6.5's empty import section, as far
 *          as a native build can show it), and the generated C compiles with no
 *          warning at all.
 *
 *          If no C compiler is on PATH the differential CANNOT run, and this
 *          file says so out loud rather than reporting green — a gate that never
 *          saw its subject is worse than a missing one, because it is counted.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { inlineSystem } from '../src/inline';
import { builtinShapes } from '../src/builtins';
import { AbiMemory, flushCommands, materialize, packLayout, planFor, runOnAbi } from '../src/abi';
import { CFLAGS, cSymbol, emitC, type CModule } from '../src/codegen';
import type { AbiLayout } from '../src/abi';
import type { EirSystem } from '../src/eir';
import type { Row } from '../src/interp';

import { moveSystem } from '../../examples/ecs-basics/src/systems/move';
import { driftSystem } from './fixtures/in-subset';
import { PROBE } from './probe';
import type { StubSystem } from './stubs/esengine';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURE = resolve(fileURLToPath(new URL('./fixtures/in-subset.ts', import.meta.url)));
const N = 24;
const FRAMES = 12;
/** Small enough that a frame is one cheap pipe, big enough for the world above. */
const IMAGE = 1 << 16;

// =============================================================================
// finding a C compiler
// =============================================================================

/**
 * clang first because it is what Stage 2 ships with — emcc is clang and the
 * aarch64 path is clang. gcc is accepted, and is arguably the better witness:
 * agreeing with a SECOND independent implementation of C says more than
 * agreeing with the one the lowering was written against.
 */
function findCC(): string | null {
    for (const cc of ['clang', 'gcc', 'cc']) {
        if (spawnSync(cc, ['--version'], { encoding: 'utf8' }).status === 0) return cc;
    }
    return null;
}

const CC = findCC();

/** The harness: linear memory in on stdin, linear memory out on stdout. */
const MAIN_C = `/* Test scaffolding, not compiler output. */
#include <stdio.h>
#include <stdlib.h>
#if defined(_WIN32)
#include <io.h>
#include <fcntl.h>
#endif
#include "estella_abi.h"

unsigned char *es_memory;

void ES_ENTRY(uint32_t ctx);

int main(int argc, char **argv) {
    long n;
    uint32_t ctx;
    if (argc != 3) { fprintf(stderr, "usage: run <bytes> <ctx>\\n"); return 2; }
    n = strtol(argv[1], NULL, 10);
    ctx = (uint32_t)strtoul(argv[2], NULL, 10);
    es_memory = (unsigned char *)malloc((size_t)n);
    if (!es_memory) return 3;
#if defined(_WIN32)
    /* Text mode would insert a 0x0d before every 0x0a in the image. */
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    if (fread(es_memory, 1, (size_t)n, stdin) != (size_t)n) return 4;
    ES_ENTRY(ctx);
    if (fwrite(es_memory, 1, (size_t)n, stdout) != (size_t)n) return 5;
    return 0;
}
`;

/** Build one executable per system; the entry symbol is a -D, so main is shared. */
function build(dir: string, cModule: CModule, symbol: string): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'estella_abi.h'), cModule.header);
    writeFileSync(join(dir, 'systems.c'), cModule.source);
    writeFileSync(join(dir, 'main.c'), MAIN_C);
    const exe = join(dir, `${symbol}${process.platform === 'win32' ? '.exe' : ''}`);
    const out = spawnSync(CC!, [
        ...CFLAGS, '-Wall', '-Wextra',
        `-DES_ENTRY=${symbol}`,
        '-o', exe,
        join(dir, 'main.c'), join(dir, 'systems.c'),
        '-lm',
    ], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`${CC} failed:\n${out.stderr}`);
    // A warning in generated code is a warning nobody will ever read, so the bar
    // is zero rather than "none that matter".
    expect(out.stderr.trim(), 'the generated C must compile without a warning').toBe('');
    return exe;
}

/** One call of the contract: materialise, run the compiled code, flush. */
function frameOfC(exe: string, mem: AbiMemory, sys: EirSystem): void {
    const call = materialize(mem, planFor(sys));
    const image = Buffer.from(mem.buffer);
    const out = execFileSync(exe, [String(image.length), String(call.ctx)], {
        input: image,
        maxBuffer: image.length * 2 + (1 << 16),
    });
    expect(out.length, 'the harness returned a different image').toBe(image.length);
    image.set(out);
    flushCommands(mem, call);
}

// =============================================================================
// the corpus: one shipped system, and the fixtures covering the rest of the subset
// =============================================================================

const shipped = lowerProgram([
    resolve(ROOT, 'examples/ecs-basics/src/systems/move.ts'),
    resolve(ROOT, 'examples/ecs-basics/src/components.ts'),
], builtinShapes());

const fixtures = lowerProgram([FIXTURE], builtinShapes());

function systemOf(result: typeof shipped, name: string): EirSystem {
    const sys = result.module.systems.find((s) => s.name === name);
    if (!sys) throw new Error(`no system '${name}': ${JSON.stringify(result.diagnostics)}`);
    expect(verifySystem(sys, result.module.comps, result.module.fns), name).toEqual([]);
    return inlineSystem(sys, result.module.fns);
}

/** Deterministic, and spread so every branch of every fixture is taken. */
function seed(i: number): Record<string, number> {
    return {
        tx: (i % 7) * 13 - 40, ty: (i % 5) * 9 - 20,
        dx: (i % 3) - 1, dy: ((i % 4) - 2) / 2,
        speed: 40 + (i % 6) * 15,
        rate: (i % 11) * 12,
    };
}

/** Stores round through f32 for an engine pool; a JS world that did not would
 *  drift from the image by construction rather than by bug. */
function f32Row(fields: Record<string, unknown>): Row {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== null && typeof v === 'object') { out[k] = f32Row(v as Record<string, unknown>); continue; }
        let held = Math.fround(v as number);
        Object.defineProperty(out, k, {
            enumerable: true,
            get: () => held,
            set: (n: number) => { held = Math.fround(n); },
        });
    }
    return out;
}

function transformRow(tx: number, ty: number): Row {
    return f32Row({
        position: { x: tx, y: ty, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 },
        worldRotation: { x: 0, y: 0, z: 0, w: 1 }, worldScale: { x: 1, y: 1, z: 1 },
    });
}

function movedWorld(layout: AbiLayout): AbiMemory {
    const mem = new AbiMemory(layout, IMAGE);
    mem.addResource('Time', { delta: 1 / 30 });
    for (let i = 1; i <= N; i++) {
        const s = seed(i);
        mem.addComponent('Transform', i, { 'position.x': s['tx']!, 'position.y': s['ty']! });
        mem.addComponent('Mover', i, { speed: s['speed']!, directionX: s['dx']!, directionY: s['dy']! });
    }
    return mem;
}

function fixtureWorld(layout: AbiLayout): AbiMemory {
    const mem = new AbiMemory(layout, IMAGE);
    mem.addResource('Time', { delta: 1 / 30, elapsed: 0 });
    for (let i = 1; i <= N; i++) {
        const s = seed(i);
        mem.addComponent('Transform', i, { 'position.x': s['tx']!, 'position.y': s['ty']! });
        mem.addComponent('FixtureDrift', i, { rate: s['rate']!, wrap: 100, enabled: i % 4 !== 0 });
        mem.addComponent('FixtureClamp', i, { lo: -50, hi: 50, push: 30 });
        // The probe values are the point of this component, not a default: they
        // are where libm and ECMAScript disagree.
        mem.addComponent('FixtureMathProbe', i, { v: PROBE[(i - 1) % PROBE.length]! });
    }
    return mem;
}

const same = (a: AbiMemory, b: AbiMemory): boolean =>
    Buffer.from(a.buffer).equals(Buffer.from(b.buffer));

// =============================================================================

describe('the emitted C says what the interpreter says', () => {
    it('reports whether this gate could run at all', () => {
        // Not a skip: a missing compiler means the differential did not happen,
        // and a suite that stays silent about that is reporting a green it did
        // not earn.
        if (CC) console.log(`[codegen] the differential ran against ${CC}`);
        else console.warn('[codegen] NO C COMPILER ON PATH — the differential did NOT run.');
        expect(true).toBe(true);
    });

    if (!CC) return;

    const tmp = mkdtempSync(join(tmpdir(), 'estella-aot-'));

    it('MoveSystem: the whole image agrees with the interpreter, and both with node', () => {
        const move = systemOf(shipped, 'MoveSystem');
        const layout = packLayout(shipped.module.comps);
        const exe = build(join(tmp, 'move'), emitC(shipped.module, layout, [move]), cSymbol('MoveSystem'));

        const byInterp = movedWorld(layout);
        const byC = movedWorld(layout);
        expect(same(byC, byInterp), 'the two runs did not start from the same bytes').toBe(true);

        // node, over the same file the compiler read — a retyped copy would only
        // ever agree with its own mistakes.
        const transforms = new Map<number, Row>();
        const movers = new Map<number, Row>();
        const entities: number[] = [];
        for (let i = 1; i <= N; i++) {
            const s = seed(i);
            entities.push(i);
            transforms.set(i, transformRow(s['tx']!, s['ty']!));
            movers.set(i, f32Row({ speed: s['speed']!, directionX: s['dx']!, directionY: s['dy']! }));
        }
        const time = { delta: 1 / 30 };
        const stub = (moveSystem as unknown as StubSystem).fn as unknown as (q: unknown, t: unknown) => void;

        for (let f = 0; f < FRAMES; f++) {
            runOnAbi(move, byInterp, layout, shipped.module.fns);
            frameOfC(exe, byC, move);
            stub({
                *[Symbol.iterator]() {
                    for (const e of entities) yield [e, transforms.get(e)!, movers.get(e)!];
                },
            }, time);

            for (let i = 1; i <= N; i++) {
                const want = transforms.get(i)!['position'] as Record<string, number>;
                expect(byC.read('Transform', i, 'position.x'), `frame ${f} entity ${i}`).toBe(want['x']);
                expect(byC.read('Transform', i, 'position.y'), `frame ${f} entity ${i}`).toBe(want['y']);
            }
        }

        // The whole image, not the fields this test thought to look at.
        expect(same(byC, byInterp), 'compiled and interpreted images differ somewhere').toBe(true);
        expect(same(byC, movedWorld(layout)), 'nothing moved, so agreeing proves nothing').toBe(false);
    });

    // Every feature the subset gained after MoveSystem, each in a system that
    // exercises it: branches and `&&`, ternaries and the exact half of Math,
    // folded module constants with a shadowing local, an inlined helper, and the
    // Math arguments where libm and ECMAScript give different answers.
    for (const name of ['FixtureDrift', 'FixtureClampSys', 'FixtureTuned', 'FixtureHelpers', 'FixtureMathOps']) {
        it(`${name}: the whole image agrees with the interpreter`, () => {
            const sys = systemOf(fixtures, name);
            const layout = packLayout(fixtures.module.comps);
            const exe = build(join(tmp, name), emitC(fixtures.module, layout, [sys]), cSymbol(name));

            const byInterp = fixtureWorld(layout);
            const byC = fixtureWorld(layout);
            for (let f = 0; f < FRAMES; f++) {
                runOnAbi(sys, byInterp, layout, fixtures.module.fns);
                frameOfC(exe, byC, sys);
                expect(same(byC, byInterp), `${name}: images differ at frame ${f}`).toBe(true);
            }
            expect(same(byC, fixtureWorld(layout)), `${name} changed nothing`).toBe(false);
        });
    }

    it('FixtureDrift also agrees with node, not only with the interpreter', () => {
        const drift = systemOf(fixtures, 'FixtureDrift');
        const layout = packLayout(fixtures.module.comps);
        const exe = build(join(tmp, 'drift-node'), emitC(fixtures.module, layout, [drift]),
            cSymbol('FixtureDrift'));

        const mem = fixtureWorld(layout);
        const transforms = new Map<number, Row>();
        const drifts = new Map<number, Row>();
        const entities: number[] = [];
        for (let i = 1; i <= N; i++) {
            const s = seed(i);
            entities.push(i);
            transforms.set(i, transformRow(s['tx']!, s['ty']!));
            // A defineComponent shape is host-stored, so f64 — no fround here.
            drifts.set(i, { rate: s['rate']!, wrap: 100, enabled: i % 4 !== 0 });
        }
        const time = { delta: 1 / 30, elapsed: 0 };
        const stub = (driftSystem as unknown as StubSystem).fn as unknown as (q: unknown, t: unknown) => void;

        for (let f = 0; f < FRAMES; f++) {
            frameOfC(exe, mem, drift);
            stub({
                *[Symbol.iterator]() {
                    for (const e of entities) yield [e, transforms.get(e)!, drifts.get(e)!];
                },
            }, time);
        }
        for (const e of entities) {
            const want = transforms.get(e)!['position'] as Record<string, number>;
            expect(mem.read('Transform', e, 'position.x'), `entity ${e}`).toBe(want['x']);
            expect(mem.read('Transform', e, 'position.y'), `entity ${e}`).toBe(want['y']);
        }
    });

    it('the object file has nothing to import but the memory it lives in', () => {
        const layout = packLayout(shipped.module.comps);
        const cModule = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        const dir = join(tmp, 'imports');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'estella_abi.h'), cModule.header);
        writeFileSync(join(dir, 'systems.c'), cModule.source);
        const obj = join(dir, 'systems.o');
        const out = spawnSync(CC!, [...CFLAGS, '-Wall', '-Wextra', '-c',
            join(dir, 'systems.c'), '-o', obj], { encoding: 'utf8' });
        expect(out.status, out.stderr).toBe(0);
        expect(out.stderr.trim()).toBe('');

        // §6.5 is about the wasm import section; natively the same property is
        // "no undefined symbol". `es_memory` is the linear memory itself, which
        // on wasm is not an import at all — it IS the module's memory.
        const nm = spawnSync('nm', [obj], { encoding: 'utf8' });
        if (nm.status !== 0) {
            console.warn('[codegen] nm unavailable — the undefined-symbol check did NOT run.');
            return;
        }
        const undef = nm.stdout.split(/\r?\n/)
            .filter((l) => /\s[Uu]\s/.test(l))
            .map((l) => l.trim().split(/\s+/).pop()!)
            .filter((s) => s !== 'es_memory');
        expect(undef, 'a compiled system may not call the engine').toEqual([]);
    });

    it('the handshake constant moves when the parameter order does', () => {
        const layout = packLayout(shipped.module.comps);
        const move = systemOf(shipped, 'MoveSystem');
        const a = emitC(shipped.module, layout, [move]);
        expect(a.source).toContain(`0x${a.hash}ULL`);

        // The same system with its parameters swapped reads the ctx tables in
        // the other order, so the loader has to refuse it. §2.5.
        const swapped: EirSystem = { ...move, params: [...move.params].reverse() };
        expect(emitC(shipped.module, layout, [swapped]).hash).not.toBe(a.hash);
    });

    it('a component field is one load at a constant offset', () => {
        const layout = packLayout(shipped.module.comps);
        const { source } = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        // §4.2's whole reason for existing, readable in the output itself.
        expect(source).toMatch(/es_f32\(\w+ \+ ES_OFF_Transform_position_x\)/);
        expect(source).toMatch(/#define ES_OFF_Transform_position_x \d+u/);
        // And the thing v0 had that v1 does not: a call back across the boundary.
        expect(source).not.toMatch(/\bes_abi_\w+\(/);
    });
});
