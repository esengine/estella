// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    wasm-environment.test.ts — a skip has to mean "not applicable".
 *
 * @details It also meant "I could not reach the thing this needs", and the two
 *          read identically in a summary: one invocation reported 5110 passed
 *          and 309 skipped with no failures, while 43 suites had not run.
 *
 *          So the corpus is decided in ONE place. These hold that place to it:
 *          every suite asks the shared helper rather than deciding for itself
 *          from the filesystem, and a run with no engine build has to say so
 *          instead of being inferred into.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HAS_WASM, NO_WASM_MODE, SIDE_MODULES, WASM_DIR, hasSideModule } from './helpers/loadWasm';

const TESTS = __dirname;

describe('what decides whether the boundary suites run', () => {
    it('is a declaration, not a guess about the filesystem', () => {
        expect(HAS_WASM).toBe(!NO_WASM_MODE);
    });

    it('turns the whole corpus off with one flag', () => {
        for (const name of SIDE_MODULES) {
            if (NO_WASM_MODE) expect(hasSideModule(name), `${name} survived no-wasm mode`).toBe(false);
            else expect(hasSideModule(name)).toBe(existsSync(resolve(WASM_DIR, `${name}.wasm`)));
        }
    });

    it('is asked by every suite, rather than re-decided by each one', () => {
        // A suite computing its own `existsSync(<module>.wasm)` is out of reach
        // of both the declared profile and any central guarantee.
        const offenders: string[] = [];
        for (const file of readdirSync(TESTS)) {
            if (!file.endsWith('.test.ts') || file === 'wasm-environment.test.ts') continue;
            const text = readFileSync(resolve(TESTS, file), 'utf8');
            for (const m of text.matchAll(/existsSync\(\s*([A-Za-z0-9_]+)\s*\)/g)) {
                const declared = new RegExp(`const ${m[1]}\\b[^\\n]*\\.wasm`).test(text);
                if (declared) offenders.push(`${file} → existsSync(${m[1]})`);
            }
        }
        expect(offenders, 'a suite decides for itself whether the engine is available')
            .toEqual([]);
    });
});
