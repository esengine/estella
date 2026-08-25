// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    codegen.test.ts
 * @brief   The compiled code and the interpreter must produce the SAME BYTES.
 *
 * @details Up to here every test has compared an interpreter against node; both are
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
 *          symbol besides the memory base — the empty import section, as far as
 *          a native build can show it — and the generated C compiles with no
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
import { abiHashFor } from '../src/abi';
import type { AbiLayout } from '../src/abi';
import { F64, type EirSystem } from '../src/eir';
import type { Row } from '../src/interp';

import { moveSystem } from '../../examples/ecs-basics/src/systems/move';
import { driftSystem, gateSystem } from './fixtures/in-subset';
import { PROBE } from './probe';
import { builtinShapes as shapesForPins } from '../src/builtins';
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
 *
 * The candidate has to BUILD something, not merely answer `--version`. emsdk's
 * clang shadows the system one on PATH, reports `Target: unknown`, and answers
 * `--version` with 0 while refusing every host compile — so the wrong probe
 * reddens this differential on exactly the machines that can run AOT.
 */
function findCC(): string | null {
    const dir = mkdtempSync(join(tmpdir(), 'estella-cc-'));
    const src = join(dir, 'probe.c');
    writeFileSync(src, 'int main(void) { return 0; }\n');
    for (const cc of ['clang', 'gcc', 'cc']) {
        const out = spawnSync(cc, ['-std=c11', '-o', join(dir, `probe-${cc}`), src], { encoding: 'utf8' });
        if (out.status === 0) return cc;
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

#if defined(ES_ADDR_BASE)
unsigned char *es_memory;
#endif

void ES_ENTRY(es_addr_t ctx);

static unsigned char *img;

#if !defined(ES_ADDR_BASE)
static uint32_t rd32(uint32_t off) { uint32_t v; memcpy(&v, img + off, 4); return v; }

/*
 * The other address model: the image carries a ctx of OFFSETS, and this rebuilds
 * it out of real pointers. Every write the system makes still lands inside the
 * image, which is what makes the two models comparable byte for byte.
 */
static es_addr_t at(uint32_t off) { return (es_addr_t)(uintptr_t)(img + off); }

static es_addr_t relocate(uint32_t ctxOff, int nq, const int *comps, int nres) {
    static EsSysCtx c;
    EsQueryRows *qs = (EsQueryRows *)calloc((size_t)(nq > 0 ? nq : 1), sizeof(EsQueryRows));
    es_addr_t *res = (es_addr_t *)calloc((size_t)(nres > 0 ? nres : 1), sizeof(es_addr_t));
    uint32_t qOff = rd32(ctxOff);
    uint32_t rOff = rd32(ctxOff + 4u);
    int k, j;
    for (k = 0; k < nq; ++k) {
        uint32_t rowsOff = rd32(qOff + (uint32_t)(k * 2) * 4u);
        uint32_t count = rd32(qOff + (uint32_t)(k * 2 + 1) * 4u);
        uint32_t stride = (uint32_t)comps[k] + 1u;
        uint32_t n = count * stride, i;
        es_addr_t *rows = (es_addr_t *)calloc(n > 0 ? n : 1, sizeof(es_addr_t));
        for (i = 0; i < n; ++i) {
            uint32_t w = rd32(rowsOff + i * 4u);
            /* Slot 0 of a row is an entity id, not an address. */
            rows[i] = (i % stride == 0u) ? (es_addr_t)w : at(w);
        }
        qs[k].rows = (es_addr_t)(uintptr_t)rows;
        qs[k].count = count;
    }
    for (j = 0; j < nres; ++j) res[j] = at(rd32(rOff + (uint32_t)j * 4u));
    c.queries = (es_addr_t)(uintptr_t)qs;
    c.resources = (es_addr_t)(uintptr_t)res;
    c.cmdBuf = at(rd32(ctxOff + 8u));
    c.cmdCap = rd32(ctxOff + 12u);
    c.cmdCount = at(rd32(ctxOff + 16u));
    c.events = 0;
    return (es_addr_t)(uintptr_t)&c;
}
#endif

int main(int argc, char **argv) {
    long n;
    uint32_t ctxOff;
    int nq, nres, i;
    int comps[16];
    if (argc < 5) { fprintf(stderr, "usage: run <bytes> <ctx> <nres> <nq> [comps...]\\n"); return 2; }
    n = strtol(argv[1], NULL, 10);
    ctxOff = (uint32_t)strtoul(argv[2], NULL, 10);
    nres = (int)strtol(argv[3], NULL, 10);
    nq = (int)strtol(argv[4], NULL, 10);
    if (nq > 16 || argc < 5 + nq) { fprintf(stderr, "too many queries\\n"); return 6; }
    for (i = 0; i < nq; ++i) comps[i] = (int)strtol(argv[5 + i], NULL, 10);
    img = (unsigned char *)malloc((size_t)n);
    if (!img) return 3;
#if defined(_WIN32)
    /* Text mode would insert a 0x0d before every 0x0a in the image. */
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    if (fread(img, 1, (size_t)n, stdin) != (size_t)n) return 4;
#if defined(ES_ADDR_BASE)
    es_memory = img;
    (void)nres; (void)nq; (void)comps;
    ES_ENTRY((es_addr_t)ctxOff);
#else
    ES_ENTRY(relocate(ctxOff, nq, comps, nres));
#endif
    if (fwrite(img, 1, (size_t)n, stdout) != (size_t)n) return 5;
    return 0;
}
`;

/**
 * One executable per system. The entry symbol is a -D so main is shared, and so
 * is the address model: `offset` is a host that owns one block (a wasm2c
 * deployment), `pointer` is one that hands over real addresses (the C++
 * engine). Same generated source, compiled twice.
 */
type Addressing = 'offset' | 'pointer';

function build(dir: string, cModule: CModule, symbol: string, how: Addressing = 'offset'): string {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'estella_abi.h'), cModule.header);
    writeFileSync(join(dir, 'estella_offsets.h'), cModule.offsets);
    writeFileSync(join(dir, 'systems.c'), cModule.source);
    writeFileSync(join(dir, 'main.c'), MAIN_C);
    const exe = join(dir, `${symbol}${process.platform === 'win32' ? '.exe' : ''}`);
    const out = spawnSync(CC!, [
        ...CFLAGS, '-Wall', '-Wextra',
        ...(how === 'offset' ? ['-DES_ADDR_BASE'] : []),
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
    const plan = planFor(sys);
    const call = materialize(mem, plan);
    const image = Buffer.from(mem.buffer);
    // The shape of the ctx, which a pointer-addressing host needs in order to
    // rebuild it. A real host knows this from the system it is calling.
    const shape = [
        String(plan.resources.length),
        String(plan.queries.length),
        ...plan.queries.map((q) => String(q.length)),
    ];
    const out = execFileSync(exe, [String(image.length), String(call.ctx), ...shape], {
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
    // A service, mirrored: the same two answers the interpreter's fake object
    // gives, placed the way a host places them.
    mem.addResource('Input', {});
    mem.setResourceBit('Input', 'isKeyDown', 'KeyW', true);
    mem.setResourceBit('Input', 'isKeyPressed', 'Space', true);
    for (let i = 1; i <= N; i++) {
        const s = seed(i);
        mem.addComponent('Transform', i, { 'position.x': s['tx']!, 'position.y': s['ty']! });
        mem.addComponent('FixtureDrift', i, { rate: s['rate']!, wrap: 100, enabled: i % 4 !== 0 });
        mem.addComponent('FixtureClamp', i, { lo: -50, hi: 50, push: 30 });
        // The probe values are the point of this component, not a default: they
        // are where libm and ECMAScript disagree.
        mem.addComponent('FixtureMathProbe', i, { v: PROBE[(i - 1) % PROBE.length]! });
        // An ENGINE component, so these land at EHT's offsets and encodings:
        // fov at byte 4 (a repack would say 1) and isActive as one byte at 24.
        mem.addComponent('Camera', i, {
            fov: 40 + (i % 9) * 8, orthoSize: 1 + (i % 5), aspectRatio: 1.25 + (i % 3) * 0.5,
            isActive: i % 3 !== 0,
        });
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

    // Every feature the subset gained after MoveSystem: branches and `&&`,
    // ternaries, folded module constants with a shadowing local, an inlined
    // helper, and the Math arguments where libm and ECMAScript disagree.
    for (const name of ['FixtureDrift', 'FixtureClampSys', 'FixtureTuned', 'FixtureHelpers',
        'FixtureMathOps', 'FixtureCamera', 'FixtureGate']) {
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

    /**
     * The one comparison that judges the MIRROR. Everything else has both sides
     * reading bits; here the C reads a bit and node calls the method, so they
     * agree only if the host placed the answer where the compiler expects it.
     */
    it('FixtureGate: a bit the host set answers what the method answers', () => {
        const gate = systemOf(fixtures, 'FixtureGate');
        const layout = packLayout(fixtures.module.comps);
        const exe = build(join(tmp, 'gate-node'), emitC(fixtures.module, layout, [gate]), cSymbol('FixtureGate'));

        const mem = fixtureWorld(layout);
        const drifts = new Map<number, Row>();
        const entities: number[] = [];
        for (let i = 1; i <= N; i++) {
            entities.push(i);
            drifts.set(i, { rate: seed(i)['rate']!, wrap: 100, enabled: i % 4 !== 0 });
        }
        // The object the bits were mirrored FROM, answering by method.
        const input = { isKeyDown: (k: string) => k === 'KeyW', isKeyPressed: (k: string) => k === 'Space' };
        const stub = (gateSystem as unknown as StubSystem).fn as unknown as (q: unknown, i: unknown) => void;

        for (let f = 0; f < FRAMES; f++) {
            frameOfC(exe, mem, gate);
            stub({
                *[Symbol.iterator]() { for (const e of entities) yield [e, drifts.get(e)!]; },
            }, input);
        }
        for (const e of entities) {
            expect([e, mem.read('FixtureDrift', e, 'rate')])
                .toEqual([e, (drifts.get(e)! as { rate: number }).rate]);
        }
        // With the key up neither side moves, which is the `return` arriving in
        // both — and it is a different assertion from "they agree".
        expect(entities.some((e) => (drifts.get(e)! as { rate: number }).rate !== seed(e)['rate']!)).toBe(true);
    });

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

    it('an offset comes from EHT, and a repack cannot guess it', () => {
        // Most engine layouts ARE dense once alignment is applied, which is why
        // a repack agreed for so long. These four have a member EHT does not
        // expose in front, so a repack reads into it.
        const shapes = shapesForPins();
        const at = (comp: string, path: string): number | null =>
            shapes.get(comp)!.fields.get(path)!.offset;
        expect(at('BitmapText', 'color.r'), 'a repack would say 0').toBe(12);
        expect(at('DragonBonesAnimation', 'timeScale'), 'a repack would say 0').toBe(48);
        expect(at('SpineAnimation', 'timeScale'), 'a repack would say 0').toBe(48);
        expect(at('UINode', 'alignSelf'), 'a repack would say 73').toBe(76);
    });

    it('a bool is one byte, and an integer leaf is refused rather than guessed', () => {
        const layout = packLayout(fixtures.module.comps);
        const cam = layout.comps.get('Camera')!;
        expect(cam.leaves.get('isActive')!.byteOffset).toBe(24);
        expect(cam.leaves.get('isActive')!.enc).toBe('bool8');
        expect(cam.leaves.get('priority')!.enc).toBe('i32');

        const { source } = emitC(fixtures.module, layout, [systemOf(fixtures, 'FixtureCamera')]);
        expect(emitC(fixtures.module, layout, [systemOf(fixtures, 'FixtureCamera')]).offsets)
            .toContain('#define ES_OFF_Camera_isActive 24u');
        // One byte. Read as a float it would take three bytes of `priority` with
        // it, and produce a number rather than an error.
        expect(source).toMatch(/es_bool\(\w+ \+ ES_OFF_Camera_isActive\)/);
        expect(source).toMatch(/es_set_bool\(\w+ \+ ES_OFF_Camera_isActive/);
    });

    it('the same source addressed as pointers gives the same image', () => {
        // Why the address is a machine property: the C++ engine hands over
        // 64-bit component pointers, which no 32-bit offset can name. Compiling
        // the SAME file both ways makes that claim checkable.
        const move = systemOf(shipped, 'MoveSystem');
        const layout = packLayout(shipped.module.comps);
        const c = emitC(shipped.module, layout, [move]);
        const byOffset = build(join(tmp, 'addr-off'), c, cSymbol('MoveSystem'), 'offset');
        const byPointer = build(join(tmp, 'addr-ptr'), c, cSymbol('MoveSystem'), 'pointer');

        const a = movedWorld(layout);
        const b = movedWorld(layout);
        for (let f = 0; f < FRAMES; f++) {
            frameOfC(byOffset, a, move);
            frameOfC(byPointer, b, move);
            expect(same(a, b), `address models diverged at frame ${f}`).toBe(true);
        }
        expect(same(a, movedWorld(layout)), 'nothing moved, so agreeing proves nothing').toBe(false);
    });

    it('the object file has nothing to import but the memory it lives in', () => {
        const layout = packLayout(shipped.module.comps);
        const cModule = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        const dir = join(tmp, 'imports');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'estella_abi.h'), cModule.header);
        writeFileSync(join(dir, 'estella_offsets.h'), cModule.offsets);
        writeFileSync(join(dir, 'systems.c'), cModule.source);
        const obj = join(dir, 'systems.o');
        const out = spawnSync(CC!, [...CFLAGS, '-Wall', '-Wextra', '-c',
            join(dir, 'systems.c'), '-o', obj], { encoding: 'utf8' });
        expect(out.status, out.stderr).toBe(0);
        expect(out.stderr.trim()).toBe('');

        // The contract is about the wasm import section; natively the same
        // property is "no undefined symbol". `es_memory` is the linear memory itself, which
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
        // Compiled WITHOUT ES_ADDR_BASE, so there is not even a memory base to
        // resolve: an address is a pointer and the object file is closed.
        expect(undef, 'a compiled system may not call the engine').toEqual([]);
    });

    it('the artifact carries what it baked in about the engine', () => {
        const layout = packLayout(shipped.module.comps);
        const c = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        expect(c.decls).toContain(`#define ES_ABI_ENGINE_DIGEST 0x${c.handshake.engineAbi}ULL`);
        expect(c.handshake.engineAbi).toMatch(/^[0-9a-f]{16}$/);
        expect(c.handshake.projectShapes).toMatch(/^[0-9a-f]{16}$/);
    });

    it('the project digest follows the shapes the systems NAME, and only those', () => {
        const layout = packLayout(shipped.module.comps);
        const move = systemOf(shipped, 'MoveSystem');
        const before = emitC(shipped.module, layout, [move]).handshake;

        // A component nobody compiled against must not invalidate the module.
        const extra = new Map(shipped.module.comps);
        extra.set('Unrelated', {
            name: 'Unrelated', storage: 'host',
            fields: new Map([['x', { type: F64, enc: 'f64', offset: null } as const]]),
        });
        const widened = emitC({ ...shipped.module, comps: extra }, packLayout(extra), [move]);
        expect(widened.handshake.projectShapes).toBe(before.projectShapes);

        // A component it DOES name, with a field added, must.
        const changed = new Map(shipped.module.comps);
        const mover = changed.get('Mover')!;
        changed.set('Mover', {
            ...mover,
            fields: new Map([...mover.fields, ['drag', { type: F64, enc: 'f64', offset: null } as const]]),
        });
        const moved = emitC({ ...shipped.module, comps: changed }, packLayout(changed), [move]);
        expect(moved.handshake.projectShapes).not.toBe(before.projectShapes);
    });

    it('parameter order is in the MANIFEST, which is why it is not in a digest', () => {
        // A digest could only say "something moved". The order is what the host
        // follows when it fills the ctx, so it is carried rather than compared.
        const layout = packLayout(shipped.module.comps);
        const { decls } = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        expect(decls).toContain('{ "Transform", "Mover" }');
        expect(decls).toContain('{ "Time" }');
    });

    it('what the artifact exports is what a host computes, at both widths', () => {
        // The C compiler folds it out of the contract hash and its own
        // sizeof(es_addr_t), so ask one for both widths and compare against the
        // TS side a loader would use.
        const layout = packLayout(shipped.module.comps);
        const c = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        const dir = join(tmp, 'handshake');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'estella_abi.h'), c.header);
        writeFileSync(join(dir, 'estella_offsets.h'), c.offsets);
        writeFileSync(join(dir, 'systems.c'), c.source);
        writeFileSync(join(dir, 'systems_decl.c'), c.decls);
        writeFileSync(join(dir, 'main.c'), [
            '#include <stdio.h>',
            '#include "estella_abi.h"',
            'extern const uint64_t es_abi_hash;',
            '#if defined(ES_ADDR_BASE)',
            'unsigned char *es_memory;',
            '#endif',
            'int main(void) {',
            '    printf("%016llx %d\\n", (unsigned long long)es_abi_hash, (int)sizeof(es_addr_t));',
            '    return 0;',
            '}',
        ].join('\n'));

        for (const [flags, bytes] of [[['-DES_ADDR_BASE'], 4], [[], 8]] as const) {
            const exe = join(dir, `h${bytes}${process.platform === 'win32' ? '.exe' : ''}`);
            const built = spawnSync(CC!, [...CFLAGS, '-Wall', '-Wextra', ...flags, '-o', exe,
                join(dir, 'main.c'), join(dir, 'systems.c'), join(dir, 'systems_decl.c'), '-lm'],
                { encoding: 'utf8' });
            expect(built.status, built.stderr).toBe(0);
            expect(built.stderr.trim()).toBe('');
            const [got, width] = execFileSync(exe, { encoding: 'utf8' }).trim().split(' ');
            // 8 only where the platform's pointers are; a 32-bit host would say 4
            // and the assertion below would then be about the width it really has.
            expect(abiHashFor(c.handshake.engineAbi, Number(width) as 4 | 8)).toBe(got);
            if (flags.length > 0) expect(Number(width)).toBe(bytes);
        }
    });

    it('a component field is one load at a constant offset', () => {
        const layout = packLayout(shipped.module.comps);
        const { source } = emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]);
        // EIR's whole reason for existing, readable in the output itself.
        expect(source).toMatch(/es_f32\(\w+ \+ ES_OFF_Transform_position_x\)/);
        expect(emitC(shipped.module, layout, [systemOf(shipped, 'MoveSystem')]).offsets)
            .toMatch(/#define ES_OFF_Transform_position_x \d+u/);
        // And the thing v0 had that v1 does not: a call back across the boundary.
        expect(source).not.toMatch(/\bes_abi_\w+\(/);
    });
});
