// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The open data context surface over a fake host global: the one-way
 *        message channel, the shared canvas as a texture source, the cloud rows
 *        a player may write, and — the part that matters most — what "this host
 *        has no context" looks like from every angle a caller can ask.
 */
import { describe, it, expect } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { setPlatform, platformCanOpenData, platformOpenDataPostMessage } from '../src/platform/base';
import type {
    MiniGameGlobal, MiniGameProfile, MiniGameCanvas, MiniGameOpenDataContext, MiniGameKVData,
} from '../src/platform/minigame/api';

const canvas = (): MiniGameCanvas => ({ width: 512, height: 512, getContext: () => ({}) });

function adapterOver(globalPatch: Partial<MiniGameGlobal>): MiniGamePlatformAdapter {
    const profile: MiniGameProfile = {
        id: 'wechat',
        hostLabel: 'Test',
        global: {
            getSystemInfoSync: () => ({ pixelRatio: 1, screenWidth: 1, screenHeight: 1, platform: 'devtools', language: 'zh_CN' }),
            ...globalPatch,
        } as unknown as MiniGameGlobal,
    };
    return new MiniGamePlatformAdapter(profile);
}

/** A host with a context, recording what the main domain sent it. */
function hostWithContext(): { patch: Partial<MiniGameGlobal>; sent: Record<string, unknown>[]; asks: () => number } {
    const sent: Record<string, unknown>[] = [];
    const ctx: MiniGameOpenDataContext = {
        postMessage: (m) => { sent.push(m); },
        canvas: canvas(),
    };
    let asks = 0;
    return {
        sent,
        asks: () => asks,
        patch: { getOpenDataContext: () => { asks++; return ctx; } },
    };
}

describe('mini-game open data context', () => {
    it('sends the main domain\'s messages into the context', () => {
        const host = hostWithContext();
        adapterOver(host.patch).openDataPostMessage({ kind: 'show', rows: 10 });
        expect(host.sent).toEqual([{ kind: 'show', rows: 10 }]);
    });

    it('hands out the shared canvas for the main domain to sample', () => {
        const host = hostWithContext();
        expect(adapterOver(host.patch).openDataCanvas()).toMatchObject({ width: 512, height: 512 });
    });

    it('resolves the context once, however many times it is used', () => {
        const host = hostWithContext();
        const adapter = adapterOver(host.patch);
        adapter.openDataCanvas();
        adapter.openDataPostMessage({ a: 1 });
        adapter.openDataPostMessage({ b: 2 });
        expect(host.asks()).toBe(1);
    });

    it('reads a host without the capability as absent, not as an error', () => {
        const adapter = adapterOver({});
        expect(adapter.openDataCanvas()).toBeNull();
        expect(() => adapter.openDataPostMessage({ a: 1 })).not.toThrow();
    });

    it('reads a THROWN context as absent, and does not ask twice', () => {
        // A package that declares no context directory does not answer null —
        // the host throws. Asking again would throw again, to no one's benefit.
        let asks = 0;
        const adapter = adapterOver({
            getOpenDataContext: () => { asks++; throw new Error('no such context'); },
        });
        expect(adapter.openDataCanvas()).toBeNull();
        expect(adapter.openDataCanvas()).toBeNull();
        expect(asks).toBe(1);
    });

    it('writes the player\'s own rows in the host\'s KV shape', () => {
        const written: MiniGameKVData[][] = [];
        const adapter = adapterOver({
            setUserCloudStorage: (opts: { KVDataList: MiniGameKVData[] }) => { written.push(opts.KVDataList); },
        });
        expect(adapter.setCloudKeyValues({ score: '4200', level: '7' })).toBe(true);
        expect(written).toEqual([[{ key: 'score', value: '4200' }, { key: 'level', value: '7' }]]);
    });

    it('says so when there was no store to write to', () => {
        expect(adapterOver({}).setCloudKeyValues({ score: '1' })).toBe(false);
    });
});

describe('platformCanOpenData', () => {
    // The family is ONE adapter, so every vendor DEFINES these methods —
    // presence cannot be the probe the way it is for share. The honest answer
    // is whether a canvas actually comes back, the same null-answer contract
    // the ad path uses.
    it('is false on a family adapter whose host has no context', () => {
        setPlatform(adapterOver({}));
        expect(platformCanOpenData()).toBe(false);
        // And a send reports that it went nowhere, rather than the `true` that
        // method presence alone would have answered.
        expect(platformOpenDataPostMessage({ a: 1 })).toBe(false);
    });

    it('is true only when the host hands back a canvas', () => {
        setPlatform(adapterOver(hostWithContext().patch));
        expect(platformCanOpenData()).toBe(true);
    });
});
