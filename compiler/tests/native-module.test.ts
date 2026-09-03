// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    native-module.test.ts
 * @brief   The same C, built as a library a native host can load.
 *
 * @details The wasm road is gated end to end and the C++ dispatch half is gated
 *          against a real Registry (tests/aot/test_aot_host.cpp). Between them
 *          sits the step nothing exercised: taking the emitted C to the HOST
 *          compiler with the flags a loadable module needs, at the width where
 *          an address is a pointer rather than an offset into one block.
 *
 *          What it pins is the part that can silently be wrong: that the module
 *          links with no undefined symbol (the C calls only what the header
 *          defines `static inline`, and a libc call would appear here), that the
 *          promised systems are exported under the names the manifest hands a
 *          loader, and that the wider address changes the handshake — a 32-bit
 *          artifact loading into a 64-bit host reads every row at half a
 *          pointer.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lowerProgram } from '../src/frontend';
import { verifySystem } from '../src/verify';
import { inlineSystem } from '../src/inline';
import { builtinShapes } from '../src/builtins';
import { packLayout } from '../src/abi';
import { CFLAGS, cSymbol, emitC } from '../src/codegen';
import { nativeLinkFlags, findHostCC, nativeModuleExt } from '../src/hostCC';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CC = findHostCC();

/** The example that carries the marker: a real system, not a fixture written
 *  to compile. */
const SOURCES = [
    join(ROOT, 'examples/ecs-basics/src/components.ts'),
    join(ROOT, 'examples/ecs-basics/src/systems/move.ts'),
];

const lowered = lowerProgram(SOURCES, builtinShapes());
const move = lowered.module.systems.find((s) => s.name === 'MoveSystem');

describe('the compiled systems, as a module a native host loads', () => {
    it('lowers the system the module is built from', () => {
        expect(move, 'MoveSystem never lowered').toBeDefined();
        expect(verifySystem(move!, lowered.module.comps, lowered.module.fns)).toEqual([]);
    });

    it.skipIf(!CC)('links with no undefined symbol, and exports what the manifest names', () => {
        const layout = packLayout(lowered.module.comps);
        const c = emitC(lowered.module, layout, [inlineSystem(move!, lowered.module.fns)], 8);

        const dir = mkdtempSync(join(tmpdir(), 'estella-native-'));
        writeFileSync(join(dir, 'estella_abi.h'), c.header);
        writeFileSync(join(dir, 'estella_offsets.h'), c.offsets);
        writeFileSync(join(dir, 'systems.c'), c.source);
        // The declarations are the DATA half. A wasm module must not carry them
        // (its data section would sit at an address the engine owns); a library
        // loaded into the host's own process is exactly who does.
        writeFileSync(join(dir, 'systems_decl.c'), c.decls);

        const out = join(dir, `systems${nativeModuleExt()}`);
        const built = spawnSync(CC!, [
            ...CFLAGS, '-Wall', '-Wextra', ...nativeLinkFlags(),
            '-o', out, join(dir, 'systems.c'), join(dir, 'systems_decl.c'),
        ], { encoding: 'utf8', cwd: dir });

        expect(built.status, built.stderr).toBe(0);
        // A warning here is a contract problem, not style: every one this C can
        // produce is about a type or a conversion the lowering chose.
        expect(built.stderr.trim()).toBe('');
        expect(existsSync(out)).toBe(true);

        // The symbol a loader asks for by name. Read out of the built file rather
        // than assumed, because "it compiled" and "it exports that" are two
        // claims and only the second is what a host depends on.
        const want = cSymbol(move!.name);
        expect(symbolsOf(out)).toContain(want);
    });

    it('the wider address is in the handshake, so the two artifacts cannot be swapped', () => {
        const layout = packLayout(lowered.module.comps);
        const sys = [inlineSystem(move!, lowered.module.fns)];
        const asOffsets = emitC(lowered.module, layout, sys, 4);
        const asPointers = emitC(lowered.module, layout, sys, 8);

        // The C is the same file: the width is a typedef the building compiler
        // picks, which is why one source serves both hosts.
        expect(asPointers.source).toBe(asOffsets.source);
        // The digest is not, which is what refuses the wrong one at load.
        expect(asPointers.handshake.engineAbi).not.toBe(asOffsets.handshake.engineAbi);
        // And the project's own shapes are the contract, so they do NOT move.
        expect(asPointers.handshake.projectShapes).toBe(asOffsets.handshake.projectShapes);
    });
});

/**
 * Exported function names in a built module.
 *
 * Three formats and one tool each; an unknown platform returns null rather than
 * an empty list, so "no symbols" can never read as "the symbol is missing".
 */
function symbolsOf(file: string): string[] {
    const run = (cmd: string, args: string[]): string | null => {
        const r = spawnSync(cmd, args, { encoding: 'utf8' });
        return r.status === 0 ? r.stdout : null;
    };
    // nm reads ELF, Mach-O and, with binutils on Windows, PE too.
    const nm = run('nm', ['-g', '--defined-only', file]) ?? run('nm', ['-g', file]);
    if (nm !== null) {
        return nm.split(/\r?\n/)
            .map((l) => l.trim().split(/\s+/).pop() ?? '')
            .map((s) => (s.startsWith('_') ? s.slice(1) : s))
            .filter(Boolean);
    }
    const dumpbin = run('dumpbin', ['/exports', file]);
    if (dumpbin !== null) {
        return dumpbin.split(/\r?\n/).map((l) => l.trim().split(/\s+/).pop() ?? '').filter(Boolean);
    }
    throw new Error('no symbol reader (nm or dumpbin) — this gate cannot say what the module exports');
}
