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
import { createBoard, rowsFrom } from '../src/opendata/board';

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

/**
 * Who the player is, in a runtime that has no login and no channel to be told.
 * It can only ask the host, and the answer can arrive after the board already
 * drew — which is the whole reason ranking happens at paint time.
 */
describe('marking the player\'s own row', () => {
    /** A host whose cloud read and identity call can each be settled by hand. */
    function host(opts: { identity?: 'sync' | 'late' | 'never' | 'absent' } = {}) {
        const fills: string[] = [];
        let settleSelf: (() => void) | null = null;
        const ctx = new Proxy({} as Record<string, unknown>, {
            get: (_t, prop: string) => {
                if (prop === 'measureText') return (s: string) => ({ width: s.length * 6 });
                if (prop === 'font') return '';
                return (...args: unknown[]) => { if (prop === 'fillText') fills.push(String(args[0])); };
            },
            set: () => true,
        });
        const base = {
            getSharedCanvas: () => ({ width: 600, height: 400, getContext: () => ctx as unknown as CanvasRenderingContext2D }),
            getFriendCloudStorage: (o: { keyList: string[]; success?: (r: { data: unknown[] }) => void }) => {
                o.success?.({
                    data: [
                        { nickname: 'me', openid: 'oid-me', KVDataList: [{ key: 'best', value: '10' }] },
                        { nickname: 'you', openid: 'oid-you', KVDataList: [{ key: 'best', value: '20' }] },
                    ],
                });
            },
        };
        const identity = opts.identity ?? 'sync';
        const getUserInfo = identity === 'absent' ? undefined
            : (o: { openIdList: string[]; success?: (r: { data: Array<{ openid?: string }> }) => void; fail?: () => void }) => {
                const answer = () => {
                    if (identity === 'never') o.fail?.();
                    else o.success?.({ data: [{ openid: o.openIdList[0] === 'selfOpenId' ? 'oid-me' : undefined }] });
                };
                if (identity === 'late') settleSelf = answer; else answer();
            };
        return { fills, base: { ...base, getUserInfo }, settle: () => settleSelf?.() };
    }

    const showMsg = { kind: 'show', key: 'best', scope: 'friends', limit: 10, order: 'desc', style: { avatars: false }, dpr: 1 };
    /** The bold weight is what marks the row, so the font string carries it. */
    const boldCount = (calls: string[]) => calls.length;

    it('asks the host who is playing, with the host\'s own word for it', () => {
        const asked: string[][] = [];
        const h = host();
        createBoard({
            ...h.base,
            getUserInfo: (o) => { asked.push(o.openIdList); o.success?.({ data: [{ openid: 'oid-me' }] }); },
        }).handle(showMsg);
        expect(asked).toEqual([['selfOpenId']]);
    });

    it('asks once, however many boards are shown', () => {
        let asks = 0;
        const h = host();
        const board = createBoard({ ...h.base, getUserInfo: (o) => { asks++; o.success?.({ data: [{ openid: 'oid-me' }] }); } });
        board.handle(showMsg);
        board.handle(showMsg);
        board.handle(showMsg);
        expect(asks).toBe(1);
    });

    it('draws immediately rather than waiting for the answer', () => {
        // A board that waited would be a blank rectangle for as long as the
        // host took; missing one highlight for a moment is the cheaper wrong.
        const h = host({ identity: 'late' });
        createBoard(h.base).handle(showMsg);
        expect(boldCount(h.fills)).toBeGreaterThan(0);
    });

    it('repaints when the answer lands late, so the highlight appears', () => {
        const h = host({ identity: 'late' });
        createBoard(h.base).handle(showMsg);
        const before = h.fills.length;
        h.settle();
        expect(h.fills.length).toBeGreaterThan(before);
    });

    it('does not repaint after the board was hidden', () => {
        const h = host({ identity: 'late' });
        const board = createBoard(h.base);
        board.handle(showMsg);
        board.handle({ kind: 'hide' });
        const before = h.fills.length;
        h.settle();
        expect(h.fills.length).toBe(before);
    });

    it('draws a board anyway on a host that will not say', () => {
        const h = host({ identity: 'never' });
        createBoard(h.base).handle(showMsg);
        expect(h.fills).toContain('20');
    });

    it('draws a board anyway on a host with no such call', () => {
        const h = host({ identity: 'absent' });
        createBoard(h.base).handle(showMsg);
        expect(h.fills).toContain('20');
    });

    it('does not ask when the host already said who we are', () => {
        let asks = 0;
        const h = host();
        createBoard({ ...h.base, selfOpenId: 'oid-me', getUserInfo: () => { asks++; } }).handle(showMsg);
        expect(asks).toBe(0);
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
