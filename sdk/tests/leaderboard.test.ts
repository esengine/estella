// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The leaderboard façade over a fake host.
 *
 * What is worth pinning here is the shape the host forces: `show` is a request
 * with no answer, the rows never come back, and a platform without a context
 * says so instead of pretending. Drawing is the other runtime's job and is
 * tested in opendata.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LeaderboardAPI, createLocalLeaderboard } from '../src/services/leaderboard';
import { setPlatform } from '../src/platform/base';
import type { PlatformAdapter } from '../src/platform/types';

/** A platform with — or without — an open data context. */
function platform(over: Partial<PlatformAdapter> = {}): {
    sent: Record<string, unknown>[];
    cloud: Array<Readonly<Record<string, string>>>;
} {
    const sent: Record<string, unknown>[] = [];
    const cloud: Array<Readonly<Record<string, string>>> = [];
    setPlatform({
        name: 'wechat',
        family: 'minigame',
        devicePixelRatio: () => 2,
        openDataPostMessage: (m: Record<string, unknown>) => { sent.push(m); },
        openDataCanvas: () => ({ width: 512, height: 512, getContext: () => null }),
        createCanvas: (w: number, h: number) => ({ width: w, height: h, getContext: () => null }),
        setCloudKeyValues: (kv: Readonly<Record<string, string>>) => { cloud.push(kv); return true; },
        ...over,
    } as unknown as PlatformAdapter);
    return { sent, cloud };
}

// No wasm module in a unit test, so no texture is ever created — which is
// itself worth exercising: the service must stay usable and just report 0.
const api = (): LeaderboardAPI => new LeaderboardAPI(() => null);

describe('Leaderboard.available', () => {
    beforeEach(() => { vi.restoreAllMocks(); });

    it('is true where the host hands back a canvas', () => {
        platform();
        expect(api().available).toBe(true);
    });

    it('is false where the package declares no context', () => {
        platform({ openDataCanvas: () => null });
        expect(api().available).toBe(false);
    });

    it('is false on a platform with no such capability at all', () => {
        platform({ openDataPostMessage: undefined, openDataCanvas: undefined });
        expect(api().available).toBe(false);
    });
});

describe('submit', () => {
    it('writes the score under the default key', () => {
        const { cloud } = platform();
        expect(api().submit(4200)).toBe(true);
        expect(cloud).toEqual([{ 'es.score': '4200' }]);
    });

    it('carries extra rows alongside, without letting them shadow the score', () => {
        const { cloud } = platform();
        api().submit(7, { extra: { level: '3', 'es.score': '0' } });
        expect(cloud[0]).toEqual({ level: '3', 'es.score': '7' });
    });

    it('says so when there was nowhere to write', () => {
        platform({ setCloudKeyValues: undefined });
        expect(api().submit(1)).toBe(false);
    });

    it('remembers the key it wrote, so show reads the same one', () => {
        const { sent } = platform();
        const l = api();
        l.submit(10, { key: 'best.time' });
        l.show();
        expect(sent[0]).toMatchObject({ key: 'best.time' });
    });
});

describe('show / hide', () => {
    it('asks the context to draw, with the defaults spelled out', () => {
        const { sent } = platform();
        expect(api().show()).toBe(true);
        expect(sent).toEqual([{
            kind: 'show', key: 'es.score', scope: 'friends', limit: 20, order: 'desc', style: {}, dpr: 2,
        }]);
    });

    it('passes the caller\'s choices through', () => {
        const { sent } = platform();
        api().show({ key: 'k', scope: 'group', limit: 5, order: 'asc', style: { color: '#f00' } });
        expect(sent[0]).toMatchObject({ key: 'k', scope: 'group', limit: 5, order: 'asc', style: { color: '#f00' } });
    });

    it('carries the device pixel ratio, which that runtime cannot ask for', () => {
        const { sent } = platform({ devicePixelRatio: () => 3 });
        api().show();
        expect(sent[0]).toMatchObject({ dpr: 3 });
    });

    it('is false, and sends nothing, where there is no context', () => {
        const { sent } = platform({ openDataCanvas: () => null });
        expect(api().show()).toBe(false);
        expect(sent).toEqual([]);
    });

    it('tracks whether the board is up', () => {
        platform();
        const l = api();
        expect(l.visible).toBe(false);
        l.show();
        expect(l.visible).toBe(true);
        l.hide();
        expect(l.visible).toBe(false);
    });

    it('hide is a no-op when nothing was shown — not a stray message', () => {
        const { sent } = platform();
        api().hide();
        expect(sent).toEqual([]);
    });

    it('tells the context to clear', () => {
        const { sent } = platform();
        const l = api();
        l.show();
        l.hide();
        expect(sent[1]).toEqual({ kind: 'hide' });
    });
});

/**
 * The rehearsal board. Its value is entirely in being the SAME renderer that
 * ships inside the open data context — an approximation drawn here would tell
 * you nothing about what appears on a phone — so what these pin is that it
 * really does draw, and that it stands in for the platform everywhere.
 */
describe('the local board', () => {
    /** A 2D context that records what was drawn on it. */
    function recordingCanvas() {
        const calls: Array<{ op: string; args: unknown[] }> = [];
        const ctx = new Proxy({} as Record<string, unknown>, {
            get: (_t, prop: string) => {
                if (prop === 'measureText') return (s: string) => ({ width: s.length * 7 });
                if (prop === 'canvas') return undefined;
                return (...args: unknown[]) => { calls.push({ op: prop, args }); };
            },
            set: () => true,
        });
        return { calls, ctx };
    }

    it('draws the rows through the engine\'s own renderer', () => {
        const rec = recordingCanvas();
        platform({
            // No open data context here at all — the provider is the whole board.
            openDataPostMessage: undefined,
            openDataCanvas: undefined,
            // 1:1, and wide enough that nothing is clipped: the clipping rule has
            // its own test, and letting it fire here would only make this one
            // assert the wrong thing.
            devicePixelRatio: () => 1,
            createCanvas: (w: number, h: number) => ({ width: w, height: h, getContext: () => rec.ctx }),
        });
        const l = api();
        l.setProvider(createLocalLeaderboard({ width: 640 }));
        expect(l.available).toBe(true);
        expect(l.show()).toBe(true);

        const texts = rec.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
        // The invented friends, ranked — and the one who never played is absent,
        // the same rule the shipped board follows because it IS that board.
        expect(texts).toContain('Player One');
        expect(texts).toContain('18400');
        expect(texts).not.toContain('Never Played');
    });

    it('re-keys the invented rows to whatever key the game asked for', () => {
        // A game with its own key would otherwise rehearse against an empty
        // board and reasonably read that as "this is broken".
        const rec = recordingCanvas();
        platform({
            devicePixelRatio: () => 1,
            createCanvas: (w: number, h: number) => ({ width: w, height: h, getContext: () => rec.ctx }),
        });
        const l = api();
        l.setProvider(createLocalLeaderboard({ width: 640 }));
        l.show({ key: 'my.own.key' });
        expect(rec.calls.some((c) => c.op === 'fillText' && c.args[0] === '18400')).toBe(true);
    });

    it('answers `available` where the platform cannot', () => {
        platform({ openDataPostMessage: undefined, openDataCanvas: undefined });
        const l = api();
        expect(l.available).toBe(false);
        l.setProvider(createLocalLeaderboard());
        expect(l.available).toBe(true);
        l.setProvider(null);
        expect(l.available).toBe(false);
    });

    it('clears the board when the provider is swapped out', () => {
        platform();
        const l = api();
        l.setProvider(createLocalLeaderboard());
        l.show();
        expect(l.visible).toBe(true);
        // The canvas behind the texture is going away with the provider.
        l.setProvider(null);
        expect(l.visible).toBe(false);
        expect(l.texture).toBe(0);
    });
});

describe('the texture', () => {
    it('is 0 until there is one, and the service still works', () => {
        platform();
        const l = api();
        expect(l.texture).toBe(0);
        expect(l.show()).toBe(true);   // no WebGL2 here; the request still goes
        expect(l.texture).toBe(0);
        expect(() => l.sample()).not.toThrow();
    });

    it('samples nothing while the board is down', () => {
        platform();
        const l = api();
        // Nothing to assert but the absence of a throw and of a canvas read —
        // the point is that the per-frame system costs one boolean.
        expect(() => l.sample()).not.toThrow();
        expect(l.visible).toBe(false);
    });
});
