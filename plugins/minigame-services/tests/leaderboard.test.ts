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
  // No WebGL in a unit test — which is itself worth exercising: the service must
  // stay usable and just report texture 0.
  createCanvasTexture: () => null,
}));

const { LeaderboardAPI } = await import('../src/leaderboard');

beforeEach(() => {
  host.context = true;
  host.cloudStore = true;
  host.dpr = 2;
  host.sent = [];
  host.cloud = [];
  host.canvas = { width: 512, height: 512, getContext: () => null };
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
