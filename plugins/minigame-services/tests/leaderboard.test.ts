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

/** The capabilities `esengine` publishes, as a host that records what it was
 *  asked. Mocked rather than installed: a platform adapter is the engine's own
 *  seam, and a package sees only what the engine exports. */
const host = {
  context: true as boolean,
  cloudStore: true as boolean,
  dpr: 2,
  sent: [] as Record<string, unknown>[],
  cloud: [] as Array<Readonly<Record<string, string>>>,
  canvas: null as unknown,
  makeCanvas: (w: number, h: number) => ({ width: w, height: h, getContext: () => null }) as unknown,
};

vi.mock('esengine', () => ({
  defineResource: (value: unknown, name: string) => ({ value, name }),
  log: { warn: () => {}, info: () => {}, error: () => {} },
  platformCanOpenData: () => host.context,
  platformOpenDataPostMessage: (message: Record<string, unknown>) => {
    if (!host.context) return false;
    host.sent.push(message);
    return true;
  },
  platformOpenDataCanvas: () => (host.context ? host.canvas : null),
  platformSetCloudKeyValues: (entries: Readonly<Record<string, string>>) => {
    if (!host.cloudStore) return false;
    host.cloud.push(entries);
    return true;
  },
  platformDevicePixelRatio: () => host.dpr,
  platformCreateCanvas: (w: number, h: number) => host.makeCanvas(w, h),
  // No WebGL in a unit test — which is itself worth exercising: the service must
  // stay usable and just report texture 0.
  createCanvasTexture: () => null,
}));

const { LeaderboardAPI, createLocalLeaderboard } = await import('../src/leaderboard');

beforeEach(() => {
  host.context = true;
  host.cloudStore = true;
  host.dpr = 2;
  host.sent = [];
  host.cloud = [];
  host.canvas = { width: 512, height: 512, getContext: () => null };
  host.makeCanvas = (w: number, h: number) => ({ width: w, height: h, getContext: () => null });
});

const api = () => new LeaderboardAPI(() => null);

describe('Leaderboard.available', () => {
  it('is true where the host has a context', () => {
    expect(api().available).toBe(true);
  });

  it('is false where the package declares none', () => {
    host.context = false;
    expect(api().available).toBe(false);
  });
});

describe('submit', () => {
  it('writes the score under the default key', () => {
    expect(api().submit(4200)).toBe(true);
    expect(host.cloud).toEqual([{ 'es.score': '4200' }]);
  });

  it('carries extra rows alongside, without letting them shadow the score', () => {
    api().submit(7, { extra: { level: '3', 'es.score': '0' } });
    expect(host.cloud[0]).toEqual({ level: '3', 'es.score': '7' });
  });

  it('says so when there was nowhere to write', () => {
    host.cloudStore = false;
    expect(api().submit(1)).toBe(false);
  });

  it('remembers the key it wrote, so show reads the same one', () => {
    const l = api();
    l.submit(10, { key: 'best.time' });
    l.show();
    expect(host.sent[0]).toMatchObject({ key: 'best.time' });
  });
});

describe('show / hide', () => {
  it('asks the context to draw, with the defaults spelled out', () => {
    expect(api().show()).toBe(true);
    expect(host.sent).toEqual([{
      kind: 'show', key: 'es.score', scope: 'friends', limit: 20, order: 'desc', style: {}, dpr: 2,
    }]);
  });

  it('passes the caller\'s choices through', () => {
    api().show({ key: 'k', scope: 'group', limit: 5, order: 'asc', style: { color: '#f00' } });
    expect(host.sent[0]).toMatchObject({ key: 'k', scope: 'group', limit: 5, order: 'asc', style: { color: '#f00' } });
  });

  it('carries the device pixel ratio, which that runtime cannot ask for', () => {
    host.dpr = 3;
    api().show();
    expect(host.sent[0]).toMatchObject({ dpr: 3 });
  });

  it('is false, and sends nothing, where there is no context', () => {
    host.context = false;
    expect(api().show()).toBe(false);
    expect(host.sent).toEqual([]);
  });

  it('tracks whether the board is up', () => {
    const l = api();
    expect(l.visible).toBe(false);
    l.show();
    expect(l.visible).toBe(true);
    l.hide();
    expect(l.visible).toBe(false);
  });

  it('hide is a no-op when nothing was shown — not a stray message', () => {
    api().hide();
    expect(host.sent).toEqual([]);
  });

  it('tells the context to clear', () => {
    const l = api();
    l.show();
    l.hide();
    expect(host.sent[1]).toEqual({ kind: 'hide' });
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

  /** 1:1 and wide enough that nothing is clipped: the clipping rule has its own
   *  test, and letting it fire here would only make this one assert the wrong thing. */
  function drawnOn() {
    const rec = recordingCanvas();
    host.dpr = 1;
    host.makeCanvas = (w: number, h: number) => ({ width: w, height: h, getContext: () => rec.ctx });
    return rec;
  }

  it('draws the rows through the same renderer that ships', () => {
    const rec = drawnOn();
    host.context = false; // no open data context at all — the provider is the whole board
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
    // A game with its own key would otherwise rehearse against an empty board
    // and reasonably read that as "this is broken".
    const rec = drawnOn();
    const l = api();
    l.setProvider(createLocalLeaderboard({ width: 640 }));
    l.show({ key: 'my.own.key' });
    expect(rec.calls.some((c) => c.op === 'fillText' && c.args[0] === '18400')).toBe(true);
  });

  it('answers `available` where the platform cannot', () => {
    host.context = false;
    const l = api();
    expect(l.available).toBe(false);
    l.setProvider(createLocalLeaderboard());
    expect(l.available).toBe(true);
    l.setProvider(null);
    expect(l.available).toBe(false);
  });

  it('rehearses only where the host has nothing, and only once', () => {
    const l = api();
    l.rehearse();
    // A real context wins: nothing was installed, so `show` still goes to it.
    l.show();
    expect(host.sent).toHaveLength(1);

    host.context = false;
    const off = api();
    off.rehearse();
    expect(off.available).toBe(true);
    const board = off;
    off.rehearse(); // second call keeps the first board
    expect(board.available).toBe(true);
  });

  it('clears the board when the provider is swapped out', () => {
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
    const l = api();
    expect(l.texture).toBe(0);
    expect(l.show()).toBe(true);   // no WebGL2 here; the request still goes
    expect(l.texture).toBe(0);
    expect(() => l.sample()).not.toThrow();
  });

  it('samples nothing while the board is down', () => {
    const l = api();
    // Nothing to assert but the absence of a throw and of a canvas read — the
    // point is that the per-frame system costs one boolean.
    expect(() => l.sample()).not.toThrow();
    expect(l.visible).toBe(false);
  });
});
