// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    abi-structs.test.ts
 * @brief   A struct a host addresses by WORD is a compatibility fact, and this
 *          is what makes it impossible to change one quietly.
 *
 * @details `EsEventOut` shipped for as long as it existed with none of the three
 *          things its siblings had: no word count in `abiDigest.ts`, no
 *          `es_check_` in the C header, no term in the engine digest. The number
 *          three was written once in the runtime (`AotContext`) and again in the
 *          differential host (`abi.ts`), so a fourth field appended by either
 *          would have been a header the other kept stepping over — and nothing
 *          in the ABI compatibility system knew a fact lived there at all.
 *
 *          Two halves, because two different things can go wrong:
 *
 *          - **The C says no.** Every check is sabotaged in both directions, a
 *            field added and a field dropped, and the compiler must name THAT
 *            check. A control compile first, so a red means the sabotage and
 *            not the harness.
 *          - **Nothing new slips in uncovered.** The ground is the header's
 *            all-address structs; the claim is the digest's sizes line. A
 *            future struct with neither is a finding here rather than a silence
 *            for however long it takes someone to append a field to it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CFLAGS, RUNTIME_H } from '../src/codegen';
import { findHostCC } from '../src/hostCC';
import {
    CMD_WORDS, EVENT_OUT_WORDS, QUERYROWS_WORDS, SYSCTX_WORDS, engineAbiParts,
} from '../../sdk/src/ecs/aot/abiDigest';

const CC = findHostCC();

/**
 * The header with one line ending. The sources it is written in are CRLF on
 * this platform and every anchor below is a newline; LF is what the emitted
 * artifact carries anyway.
 */
const HEADER = RUNTIME_H.split('\r\n').join('\n');

/** The four the header declares a check for, and the word count each claims. */
const CHECKED = [
    { struct: 'EsSysCtx', check: 'es_check_sysctx', term: `sysctx=${SYSCTX_WORDS}` },
    { struct: 'EsQueryRows', check: 'es_check_rows', term: `rows=${QUERYROWS_WORDS}` },
    { struct: 'EsCmd', check: 'es_check_cmd', term: `cmd=${CMD_WORDS}` },
    { struct: 'EsEventOut', check: 'es_check_eventout', term: `eventout=${EVENT_OUT_WORDS}` },
] as const;

/** `typedef struct EsFoo { ... } EsFoo;` -> its body, as the header wrote it. */
function bodyOf(struct: string): string {
    const open = `typedef struct ${struct} {\n`;
    const close = `\n} ${struct};`;
    const at = HEADER.indexOf(open);
    const end = at < 0 ? -1 : HEADER.indexOf(close, at);
    if (end < 0) throw new Error(`${struct} not found in the contract header`);
    return HEADER.slice(at + open.length, end);
}

/** Compile a TU that only includes the header; nothing runs, the check is static. */
function compile(header: string): { status: number | null; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), 'estella-abi-struct-'));
    writeFileSync(join(dir, 'estella_abi.h'), header);
    writeFileSync(join(dir, 'main.c'), '#include "estella_abi.h"\nint main(void) { return 0; }\n');
    const exe = join(dir, `probe${process.platform === 'win32' ? '.exe' : ''}`);
    const r = spawnSync(CC!, [...CFLAGS, '-o', exe, join(dir, 'main.c'), '-lm'], { encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr ?? '' };
}

describe('a word-addressed ABI struct cannot change quietly', () => {
    it('reports whether this gate could run at all', () => {
        if (!CC) console.warn('[abi-structs] NO C COMPILER — the sabotage did NOT run.');
    });

    it.skipIf(!CC)('compiles as shipped, so a red below is the sabotage', () => {
        const built = compile(HEADER);
        expect(built.status, built.stderr).toBe(0);
    });

    for (const { struct, check } of CHECKED) {
        it.skipIf(!CC)(`${check} refuses a field appended to ${struct}`, () => {
            const body = bodyOf(struct);
            const wider = HEADER.replace(body, `${body}\n    uint32_t es_sabotage;`);
            expect(wider).not.toBe(HEADER);
            const built = compile(wider);
            expect(built.status, 'a wider struct compiled').not.toBe(0);
            // Naming the check rules out a red for some unrelated reason.
            expect(built.stderr).toContain(check);
        });

        it.skipIf(!CC)(`${check} refuses a field dropped from ${struct}`, () => {
            const body = bodyOf(struct);
            const narrower = HEADER.replace(body, body.split('\n').slice(1).join('\n'));
            expect(narrower).not.toBe(HEADER);
            const built = compile(narrower);
            expect(built.status, 'a narrower struct compiled').not.toBe(0);
            expect(built.stderr).toContain(check);
        });
    }
});

describe('what the engine handshake is taken of', () => {
    const parts = engineAbiParts(4).join('\n');

    for (const { struct, term } of CHECKED) {
        it(`covers ${struct}, so widening it invalidates a built module`, () => {
            expect(parts).toContain(term);
        });
    }

    /**
     * Ground against claim: a struct of nothing but addresses is one a host
     * walks by word, so its width is a compatibility fact and the digest owes it
     * a term. `EsCmd` is the exception — four `uint32_t` at every address width,
     * which is why its check is the only one not against `sizeof(es_addr_t)`.
     */
    it('and every all-address struct in the header is one of them', () => {
        const all = [...HEADER.matchAll(/typedef struct (Es\w+) \{\n([\s\S]*?)\n\} \1;/g)];
        expect(all.length).toBeGreaterThanOrEqual(CHECKED.length);
        const byWord = all
            .filter(([, , body]) => body!.split('\n').every(
                (line) => /^\s*es_addr_t \w+;\s*$/.test(line.replace(/\/\*[\s\S]*?\*\//g, '')),
            ))
            .map(([, name]) => name!);
        expect(byWord.sort()).toEqual(
            CHECKED.filter((c) => c.struct !== 'EsCmd').map((c) => c.struct).sort(),
        );
    });
});
