// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  PlayRealm warm re-Play + project-switch reset: a warm re-Play rebuilds
 *        the project scripts BEFORE handing the realm the new scene (fsWatch
 *        only rebuilds while playing, so Stop→edit→Play replayed stale code),
 *        and reset() forces the next Play down the cold restage path so a realm
 *        warmed for project A never serves project B. DOM is stubbed (node env).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PlayRealmInstance } from '@/engine/PlayRealm';
import { PLAY_PROTOCOL_VERSION } from '@/engine/playProtocol';
import type { PlayPayload, PlayInbound } from '@/engine/playProtocol';

interface FakeIframe {
  title: string;
  style: Record<string, string>;
  src: string;
  isConnected: boolean;
  parentElement: null;
  contentWindow: { postMessage: ReturnType<typeof vi.fn>; focus: () => void };
  focus: () => void;
}

const makeIframe = (): FakeIframe => ({
  title: '',
  style: {},
  src: '',
  isConnected: true,
  parentElement: null,
  contentWindow: { postMessage: vi.fn(), focus: () => {} },
  focus: () => {},
});

const payload = (): PlayPayload =>
  ({ sceneData: { version: '1.0', name: 's', entities: [] }, assetManifest: {} }) as unknown as PlayPayload;

let iframe: FakeIframe;
let preparePlayRealm: ReturnType<typeof vi.fn>;
let buildScripts: ReturnType<typeof vi.fn>;
// Ordered log of the interesting effects, to assert rebuild-before-init.
let events: string[];

beforeEach(() => {
  iframe = makeIframe();
  events = [];
  preparePlayRealm = vi.fn(async () => {
    events.push('prepare');
    return { ok: true, hostPath: '.esengine/play/play.html', errors: [] };
  });
  buildScripts = vi.fn(async () => {
    events.push('buildScripts');
    return { ok: true, outputPath: 'x', errors: [], warnings: [] };
  });
  iframe.contentWindow.postMessage.mockImplementation((msg: { type?: string }) => {
    events.push(msg?.type ?? '?');
  });
  (globalThis as { document?: unknown }).document = { createElement: () => iframe };
  (globalThis as { window?: unknown }).window = {
    estella: { project: { preparePlayRealm, buildScripts } },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
});

const deliver = (realm: PlayRealmInstance, data: PlayInbound): void => {
  (realm as unknown as { onMessage: (e: { source: unknown; data: PlayInbound }) => void }).onMessage({
    source: iframe.contentWindow,
    data,
  });
};

/** Cold-boot a realm to ready (→ warm) via the normal hello/ready handshake. */
async function playToReady(realm: PlayRealmInstance): Promise<void> {
  await realm.start(payload());
  deliver(realm, { type: 'estella:play:hello', protocolVersion: PLAY_PROTOCOL_VERSION });
  deliver(realm, { type: 'estella:play:ready' });
}

describe('PlayRealm warm re-Play', () => {
  it('cold Play stages the realm (which builds scripts); warm path is not taken', async () => {
    const realm = new PlayRealmInstance(0);
    await playToReady(realm);
    expect(preparePlayRealm).toHaveBeenCalledTimes(1);
    expect(buildScripts).not.toHaveBeenCalled(); // cold path builds inside preparePlayRealm
    expect(realm.getSnapshot().ready).toBe(true);
  });

  it('re-Play after Stop rebuilds project scripts BEFORE posting init', async () => {
    const realm = new PlayRealmInstance(0);
    await playToReady(realm);
    realm.stop();
    events.length = 0;

    await realm.start(payload()); // warm: engine kept alive, no hello round-trip
    expect(preparePlayRealm).toHaveBeenCalledTimes(1); // no restage
    expect(buildScripts).toHaveBeenCalledTimes(1); // fresh bundle for the edited code
    const initAt = events.indexOf('estella:play:init');
    expect(initAt).toBeGreaterThan(events.indexOf('buildScripts')); // rebuild first
  });

  it('a failing rebuild still plays (last-good bundle)', async () => {
    const realm = new PlayRealmInstance(0);
    await playToReady(realm);
    realm.stop();
    buildScripts.mockRejectedValueOnce(new Error('esbuild wedged'));

    await realm.start(payload());
    expect(iframe.contentWindow.postMessage.mock.calls.some((c) => c[0]?.type === 'estella:play:init')).toBe(true);
    expect(realm.getSnapshot().error).toBeNull();
  });

  it('reset() drops warmth: the next Play cold-restages for the (new) project', async () => {
    const realm = new PlayRealmInstance(0);
    await playToReady(realm);
    realm.stop();
    realm.reset();
    expect(iframe.src).toBe('about:blank'); // the old project realm is released

    await realm.start(payload());
    expect(preparePlayRealm).toHaveBeenCalledTimes(2); // restaged, not the warm handover
  });
});
