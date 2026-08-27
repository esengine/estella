// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    exact-trig.test.ts
 * @brief   The two implementations of `exact.sin` are one implementation.
 *
 * @details The engine specifies trigonometry because ECMAScript does not, and
 *          a specification written twice is two specifications until something
 *          compares them. This compiles the C in the runtime header and holds
 *          it against the TypeScript, BIT for bit — not close, identical, since
 *          a differential pixel gate compares frames and one ulp is a pixel.
 *
 *          The arguments are chosen where the two could part: the tie in the
 *          range reduction, the quadrant boundaries, arguments large enough for
 *          Cody-Waite to lose digits (identically, which is the promise), and
 *          the values that are their own answer.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CFLAGS, RUNTIME_H } from '../src/codegen';
import { exact } from '../../sdk/src/math/exact';
import { findCC } from './hostCC';

const CC = findCC();

/** Where a range reduction, a quadrant choice or a polynomial could differ. */
function arguments_(): number[] {
    const out = [0, -0, 1e-300, -1e-300, 1e-8, -1e-8, 1, -1];
    const HALF_PI = Math.PI / 2;
    for (let q = -4; q <= 4; q++) {
        // Either side of every quadrant boundary, and the boundary itself.
        for (const d of [-1e-9, 0, 1e-9, -0.25, 0.25]) out.push(q * HALF_PI + d);
    }
    // The tie in `floor(x * 2/π + 0.5)`, which C and ECMAScript round apart.
    for (let k = -3; k <= 3; k++) out.push((k + 0.5) * HALF_PI);
    for (let i = -60; i <= 60; i++) out.push(i * 0.37);
    // Big enough that the two-step reduction loses digits — identically.
    for (const big of [1e6, -1e6, 12345.6789, -98765.4321, 1e10, -1e10]) out.push(big);
    return out;
}

const ARGS = arguments_();

/** The 64 bits of a double, which is what "identical" has to mean here. */
function bitsOf(x: number): string {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, x);
    return view.getBigUint64(0).toString(16).padStart(16, '0');
}

describe('the engine\'s trigonometry, on both sides of the compiler', () => {
    it('reports whether this gate could run at all', () => {
        if (!CC) console.warn('[exact-trig] NO C COMPILER — the comparison did NOT run.');
    });

    it.skipIf(!CC)('answers the same bits in C as in TypeScript', () => {
        const dir = mkdtempSync(join(tmpdir(), 'estella-trig-'));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'estella_abi.h'), RUNTIME_H);
        writeFileSync(join(dir, 'main.c'), [
            '#include <stdio.h>',
            '#include <string.h>',
            '#include "estella_abi.h"',
            'int main(void) {',
            `    static const double xs[] = { ${ARGS.map((x) => x.toExponential(20)).join(', ')} };`,
            '    for (unsigned i = 0; i < sizeof(xs) / sizeof(xs[0]); i++) {',
            '        double s = es_exact_sin(xs[i]);',
            '        double c = es_exact_cos(xs[i]);',
            '        unsigned long long sb, cb;',
            '        memcpy(&sb, &s, 8); memcpy(&cb, &c, 8);',
            '        printf("%016llx %016llx\\n", sb, cb);',
            '    }',
            '    return 0;',
            '}',
        ].join('\n'));

        const exe = join(dir, `trig${process.platform === 'win32' ? '.exe' : ''}`);
        const built = spawnSync(CC!, [...CFLAGS, '-Wall', '-Wextra', '-o', exe,
            join(dir, 'main.c'), '-lm'], { encoding: 'utf8' });
        expect(built.status, built.stderr).toBe(0);
        expect(built.stderr.trim()).toBe('');

        // The C program's stdout is text mode, so on Windows every line but the
        // last keeps a trailing CR — 186 of 187 arguments then read as divergent
        // while every digit matches.
        const lines = execFileSync(exe, { encoding: 'utf8' }).trim().split(/\r?\n/);
        expect(lines).toHaveLength(ARGS.length);
        const fromC = lines.map((l) => l.split(' '));
        const fromTs = ARGS.map((x) => [bitsOf(exact.sin(x)), bitsOf(exact.cos(x))]);
        // Compared as one array so a failure names the argument, not just a count.
        expect(ARGS.map((x, i) => [x, ...fromC[i]!]))
            .toEqual(ARGS.map((x, i) => [x, ...fromTs[i]!]));
    });

    it('stays within an ulp or so of the host Math, which is a sanity check not a contract', () => {
        // Determinism is the promise; being WRONG would still be a bug, and a
        // polynomial with a typo in it is exactly what this notices.
        let worst = 0;
        for (const x of ARGS) {
            if (!Number.isFinite(x) || Math.abs(x) > 1e5) continue;
            worst = Math.max(worst, Math.abs(exact.sin(x) - Math.sin(x)),
                Math.abs(exact.cos(x) - Math.cos(x)));
        }
        expect(worst).toBeLessThan(1e-12);
    });
});
