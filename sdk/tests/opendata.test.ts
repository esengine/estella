// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The built-in leaderboard, and the boundary it lives behind.
 *
 * The open data context is a second JS runtime with no WebGL, no wasm and
 * almost none of the host API. The cost of forgetting that is not a compile
 * error — it is a package that builds, ships, and fails on a device — so the
 * boundary is a test rather than a comment at the top of the file.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { rowsFrom } from '../src/opendata/board';

const DIR = path.join(__dirname, '..', 'src', 'opendata');

/**
 * The file with its comments removed.
 *
 * The guard below is about what the CODE reaches for, and these files talk at
 * length about the capabilities this runtime does not have — so a guard reading
 * the prose fails on the sentence explaining why it exists. Crude on purpose: a
 * `//` inside a string literal would be over-stripped, which can only make the
 * guard miss something, never invent a violation.
 */
const code = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the boundary', () => {
    const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

    it('has files to check', () => {
        // A guard that silently checks nothing is worse than no guard.
        expect(sources.length).toBeGreaterThan(0);
    });

    it.each(sources)('%s imports nothing from outside this folder', (file) => {
        const src = readFileSync(path.join(DIR, file), 'utf8');
        const imports = [...src.matchAll(/^\s*import\s+(?:type\s+)?[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
        for (const from of imports) {
            // The boundary is the FOLDER, not the import kind: files in here are
            // bundled together into the one file that ships to the context, so a
            // sibling costs nothing. What must never happen is an import that
            // leaves — `../` or a package name is the engine arriving in a
            // runtime that cannot run it.
            expect(
                from.startsWith('./') && !from.includes('..'),
                `${file} imports "${from}" — the open data context has no engine to import`,
            ).toBe(true);
            expect(
                existsSync(path.join(DIR, `${from.slice(2)}.ts`)),
                `${file} imports "${from}", which is not a file in this folder`,
            ).toBe(true);
        }
    });

    it.each(sources)('%s touches no browser or engine global', (file) => {
        const src = code(readFileSync(path.join(DIR, file), 'utf8'));
        // `document`/`window` do not exist there; WebGL and wasm are the two
        // capabilities the runtime is defined by NOT having.
        for (const banned of ['document.', 'window.', 'WebGL', 'WebAssembly', 'requestAnimationFrame']) {
            expect(src.includes(banned), `${file} uses \`${banned}\`, which the open data context does not have`).toBe(false);
        }
    });
});

describe('rowsFrom', () => {
    const p = (nickname: string, score?: string, openid?: string, avatarUrl?: string) => ({
        nickname, openid, avatarUrl,
        KVDataList: score === undefined ? [] : [{ key: 'best', value: score }],
    });

    it('ranks descending by default, from 1', () => {
        const rows = rowsFrom([p('a', '10'), p('b', '30'), p('c', '20')], 'best', 'desc', 10);
        expect(rows.map((r) => [r.rank, r.name, r.score])).toEqual([[1, 'b', 30], [2, 'c', 20], [3, 'a', 10]]);
    });

    it('ranks ascending for a best time', () => {
        const rows = rowsFrom([p('a', '10'), p('b', '30')], 'best', 'asc', 10);
        expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
    });

    it('drops a friend who has never played rather than ranking them last', () => {
        // Zero is a score someone earned; absent is not a score at all, and
        // showing it as 0 puts people on a board they were never on.
        const rows = rowsFrom([p('a', '10'), p('never'), p('b', '0')], 'best', 'desc', 10);
        expect(rows.map((r) => r.name)).toEqual(['a', 'b']);
    });

    it('drops a value that is not a number', () => {
        const rows = rowsFrom([p('a', 'not-a-score'), p('b', '5')], 'best', 'desc', 10);
        expect(rows.map((r) => r.name)).toEqual(['b']);
    });

    it('reads only the key it was asked for', () => {
        const other = { nickname: 'a', KVDataList: [{ key: 'coins', value: '999' }] };
        expect(rowsFrom([other, p('b', '1')], 'best', 'desc', 10).map((r) => r.name)).toEqual(['b']);
    });

    it('trims to the limit — the canvas is a fixed size and cannot scroll', () => {
        const many = Array.from({ length: 40 }, (_, i) => p(`p${i}`, String(i)));
        expect(rowsFrom(many, 'best', 'desc', 5)).toHaveLength(5);
    });

    it('takes a limit of zero literally, and a negative one as zero', () => {
        expect(rowsFrom([p('a', '1')], 'best', 'desc', 0)).toEqual([]);
        expect(rowsFrom([p('a', '1')], 'best', 'desc', -3)).toEqual([]);
    });

    it('marks the player themselves, and only on an openid match', () => {
        const rows = rowsFrom([p('me', '9', 'oid-1'), p('them', '8', 'oid-2')], 'best', 'desc', 10, 'oid-1');
        expect(rows.map((r) => [r.name, r.self])).toEqual([['me', true], ['them', false]]);
    });

    it('marks nobody when the host did not say who we are', () => {
        const rows = rowsFrom([p('a', '9', 'oid-1')], 'best', 'desc', 10, undefined);
        expect(rows.every((r) => !r.self)).toBe(true);
    });

    it('survives a host that answers with nothing', () => {
        expect(rowsFrom([], 'best', 'desc', 10)).toEqual([]);
    });
});
