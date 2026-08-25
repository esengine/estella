// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasm.test.ts
 * @brief   The emitted C, as the wasm it actually ships as.
 *
 * @details Everything else compiles it natively, which is a stand-in: the target
 *          the diagram puts first is Web, and two of the contract's claims are
 *          only checkable on the real thing.
 *
 *          §6.5 — "the import section must be empty" — has been asserted with
 *          `nm` on an object file, with a comment admitting that is as close as
 *          a native build gets. `WebAssembly.Module.imports()` is the actual
 *          question, and it is asked here.
 *
 *          §2.1.1 — an address is a pointer, and on wasm32 a pointer IS the
 *          offset — stops being an argument here and becomes a run: the same
 *          generated file, compiled by emcc, moving the same world to the same
 *          bytes as the interpreter.
 *
 *          Skipped, loudly, where emsdk is not installed. A gate that cannot see
 *          its subject must say so rather than report green.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { inlineSystem } from '../src/inline';
import { builtinShapes } from '../src/builtins';
import { AbiMemory, flushCommands, materialize, packLayout, planFor, runOnAbi } from '../src/abi';
import { CFLAGS, cSymbol, emitC } from '../src/codegen';
import type { AbiLayout } from '../src/abi';
import type { EirSystem } from '../src/eir';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const N = 24;
const FRAMES = 12;
/** Big enough for the world, small enough to stay a static array in the module. */
const IMAGE = 1 << 16;

/** emsdk lives in the repo, unpacked by `pnpm emsdk:setup`. */
function findEmcc(): string | null {
    const bat = join(ROOT, 'tools/emsdk/upstream/emscripten',
        process.platform === 'win32' ? 'emcc.bat' : 'emcc');
    return existsSync(bat) ? bat : null;
}

const EMCC = findEmcc();

/**
 * The module: the generated system, plus one static block for the world and a
 * way to ask where it landed. Nothing else — no runtime, no entry point.
 */
const SHELL_C = `/* Test scaffolding, not compiler output. */
#include "estella_abi.h"

unsigned char es_image[${IMAGE}];

/* On wasm32 an address IS an offset into linear memory, so this is both. */
unsigned int es_image_base(void) { return (unsigned int)(uintptr_t)es_image; }
`;

/** A module that DOES import something, so the check above is not vacuous. */
const PROBE_C = `extern void es_probe(void);
void es_call(void) { es_probe(); }
`;

interface Built {
    readonly bytes: Buffer;
    readonly symbol: string;
}

function build(dir: string, sys: EirSystem, layout: AbiLayout, module: Parameters<typeof emitC>[0]): Built {
    mkdirSync(dir, { recursive: true });
    const c = emitC(module, layout, [sys]);
    writeFileSync(join(dir, 'estella_abi.h'), c.header);
    writeFileSync(join(dir, 'estella_offsets.h'), c.offsets);
    writeFileSync(join(dir, 'systems.c'), c.source);
    writeFileSync(join(dir, 'shell.c'), SHELL_C);
    const out = join(dir, 'systems.wasm');
    const symbol = cSymbol(sys.name);
    const built = spawnSync(EMCC!, [
        ...CFLAGS, '-Wall', '-Wextra',
        // A bare module: no JS glue, no entry point, and therefore nothing that
        // could quietly add an import behind the property being tested.
        '--no-entry', '-sSTANDALONE_WASM', '-sERROR_ON_UNDEFINED_SYMBOLS=1',
        `-sEXPORTED_FUNCTIONS=_${symbol},_es_image_base`,
        '-o', out,
        join(dir, 'systems.c'), join(dir, 'shell.c'),
        // emcc ships as a .bat on Windows, which needs a shell to launch.
    ], { encoding: 'utf8', cwd: dir, shell: process.platform === 'win32' });
    if (built.status !== 0) throw new Error(`emcc failed:\n${built.stderr}`);
    expect(built.stderr.trim(), 'the generated C must compile to wasm without a warning').toBe('');
    return { bytes: readFileSync(out), symbol };
}

/**
 * Rebuild the ctx the TS host wrote, with the image's own offsets turned into
 * wasm addresses. Scaffolding: a real host materialises straight into linear
 * memory, and has no offsets to fix up.
 */
function relocate(mem: DataView, base: number, ctx: number, plan: ReturnType<typeof planFor>): number {
    const u32 = (at: number): number => mem.getUint32(at, true);
    const put = (at: number, v: number): void => mem.setUint32(at, v, true);
    const queries = u32(base + ctx);
    plan.queries.forEach((args, k) => {
        const rowsAt = queries + k * 8;
        const rows = u32(base + rowsAt);
        const count = u32(base + rowsAt + 4);
        const stride = 1 + args.length;
        for (let i = 0; i < count; i++) {
            for (let j = 1; j <= args.length; j++) {
                const slot = base + rows + (i * stride + j) * 4;
                put(slot, base + u32(slot));
            }
        }
        put(base + rowsAt, base + rows);
    });
    const res = u32(base + ctx + 4);
    for (let r = 0; r < plan.resources.length; r++) {
        put(base + res + r * 4, base + u32(base + res + r * 4));
    }
    put(base + ctx, base + queries);
    put(base + ctx + 4, base + res);
    put(base + ctx + 8, base + u32(base + ctx + 8));    // cmdBuf
    put(base + ctx + 16, base + u32(base + ctx + 16));  // cmdCount
    return base + ctx;
}

const shipped = lowerProgram([
    resolve(ROOT, 'examples/ecs-basics/src/systems/move.ts'),
    resolve(ROOT, 'examples/ecs-basics/src/components.ts'),
], builtinShapes());

function movedWorld(layout: AbiLayout): AbiMemory {
    const mem = new AbiMemory(layout, IMAGE);
    mem.addResource('Time', { delta: 1 / 30 });
    for (let i = 1; i <= N; i++) {
        mem.addComponent('Transform', i, {
            'position.x': (i % 7) * 13 - 40, 'position.y': (i % 5) * 9 - 20,
        });
        mem.addComponent('Mover', i, {
            speed: 40 + (i % 6) * 15, directionX: (i % 3) - 1, directionY: ((i % 4) - 2) / 2,
        });
    }
    return mem;
}

describe('the emitted C as wasm', () => {
    it('reports whether this gate could run at all', () => {
        if (EMCC) console.log(`[wasm] built with ${EMCC}`);
        else console.warn('[wasm] NO EMSDK — the wasm checks did NOT run (pnpm emsdk:setup).');
        expect(true).toBe(true);
    });

    if (!EMCC) return;

    const tmp = mkdtempSync(join(tmpdir(), 'estella-wasm-'));
    const layout = packLayout(shipped.module.comps);
    const move = shipped.module.systems.find((s) => s.name === 'MoveSystem')!;
    expect(verifySystem(move, shipped.module.comps, shipped.module.fns)).toEqual([]);
    const sys = inlineSystem(move, shipped.module.fns);
    const built = build(join(tmp, 'move'), sys, layout, shipped.module);

    it('imports nothing at all — §6.5, asked of the wasm itself', () => {
        const imports = new WebAssembly.Module(built.bytes as unknown as BufferSource);
        // Not "no imports that matter": none. The contract has no call to make,
        // so the section is empty by construction rather than by trimming.
        expect(WebAssembly.Module.imports(imports)).toEqual([]);
    });

    it('and that check has teeth: a module that DOES import one says so', () => {
        // Otherwise "no imports" could just mean the assertion cannot see any.
        const dir = join(tmp, 'control');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'probe.c'), PROBE_C);
        const out = join(dir, 'probe.wasm');
        const made = spawnSync(EMCC!, [
            '-O2', '--no-entry', '-sSTANDALONE_WASM', '-sERROR_ON_UNDEFINED_SYMBOLS=0',
            '-sEXPORTED_FUNCTIONS=_es_call', '-o', out, join(dir, 'probe.c'),
        ], { encoding: 'utf8', cwd: dir, shell: process.platform === 'win32' });
        expect(made.status, made.stderr).toBe(0);
        const names = WebAssembly.Module
            .imports(new WebAssembly.Module(readFileSync(out) as unknown as BufferSource))
            .map((i) => i.name);
        expect(names).toContain('es_probe');
    });

    it('exports the system, and its own memory', () => {
        const exports = WebAssembly.Module.exports(
            new WebAssembly.Module(built.bytes as unknown as BufferSource));
        const names = exports.map((e) => e.name);
        expect(names).toContain(built.symbol);
        expect(names).toContain('memory');
    });

    it('moves the world to the same bytes the interpreter does', async () => {
        const instance = await WebAssembly.instantiate(
            new WebAssembly.Module(built.bytes as unknown as BufferSource), {});
        const api = instance.exports as unknown as {
            memory: WebAssembly.Memory;
            es_image_base: () => number;
            [k: string]: unknown;
        };
        const run = api[built.symbol] as (ctx: number) => void;
        const base = api.es_image_base();
        expect(base).toBeGreaterThan(0);

        const byInterp = movedWorld(layout);
        const byWasm = movedWorld(layout);
        const plan = planFor(sys);

        for (let f = 0; f < FRAMES; f++) {
            runOnAbi(sys, byInterp, layout, shipped.module.fns);

            const call = materialize(byWasm, plan);
            const heap = new Uint8Array(api.memory.buffer);
            heap.set(new Uint8Array(byWasm.buffer), base);
            run(relocate(new DataView(api.memory.buffer), base, call.ctx, plan));
            // Back out of linear memory, so the comparison is over the world the
            // wasm actually wrote rather than the one handed to it.
            new Uint8Array(byWasm.buffer).set(heap.subarray(base, base + IMAGE));
            flushCommands(byWasm, call);

            for (let i = 1; i <= N; i++) {
                expect(byWasm.read('Transform', i, 'position.x'), `frame ${f} entity ${i}`)
                    .toBe(byInterp.read('Transform', i, 'position.x'));
            }
        }
        expect(byWasm.read('Transform', 3, 'position.x'),
            'nothing moved, so agreeing proves nothing')
            .not.toBe(movedWorld(layout).read('Transform', 3, 'position.x'));
    });
});
