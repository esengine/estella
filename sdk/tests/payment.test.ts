// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  In-game purchase, and the device it is not allowed on.
 *
 * The thing worth pinning is the permission: the call exists on an iPhone and
 * the platform refuses it, so `available` has to answer for the DEVICE. A shop
 * that read the API's existence would open and then fail at the tap.
 */
import { describe, it, expect } from 'vitest';
import { platformCanPay, platformRequestPayment } from '../src/platform';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { setPlatform } from '../src/platform/base';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame/api';
import type { PlatformAdapter } from '../src/platform/types';

type PayOpts = Parameters<NonNullable<MiniGameGlobal['requestMidasPayment']>>[0];

/** The service façade these rules are read through lives in
 *  estella-plugin-minigame-services; what is pinned here is the ADAPTER under it. */
const api = { get available() { return platformCanPay(); }, request: platformRequestPayment };

function host(opts: { where?: string; pay?: (o: PayOpts) => void } = {}): {
    api: typeof api; calls: PayOpts[];
} {
    const calls: PayOpts[] = [];
    const profile: MiniGameProfile = {
        id: 'wechat',
        hostLabel: 'Test',
        global: {
            getSystemInfoSync: () => ({ pixelRatio: 1, platform: opts.where ?? 'android' }),
            ...(opts.pay === undefined
                ? { requestMidasPayment: (o: PayOpts) => { calls.push(o); o.success?.(); } }
                : { requestMidasPayment: (o: PayOpts) => { calls.push(o); opts.pay!(o); } }),
        } as unknown as MiniGameGlobal,
    };
    setPlatform(new MiniGamePlatformAdapter(profile));
    return { api, calls };
}

/** A mini-game host with no purchase API at all. */
function hostWithoutPay(): typeof api {
    setPlatform(new MiniGamePlatformAdapter({
        id: 'wechat', hostLabel: 'Test',
        global: { getSystemInfoSync: () => ({ platform: 'android' }) } as unknown as MiniGameGlobal,
    }));
    return api;
}

describe('available', () => {
    it('is true on Android, where buying is permitted', () => {
        expect(host({ where: 'android' }).api.available).toBe(true);
    });

    it('is FALSE on iOS, where the call exists and the platform refuses it', () => {
        // The whole reason this is a capability and not a try-and-see.
        expect(host({ where: 'ios' }).api.available).toBe(false);
    });

    it('is true in devtools, which is where a purchase flow gets built', () => {
        expect(host({ where: 'devtools' }).api.available).toBe(true);
    });

    it('is true on a host that did not say where it is running', () => {
        // Refusing on silence would disable purchase on any vendor whose system
        // info we have not met; the host still gets the final word at call time.
        expect(host({ where: undefined }).api.available).toBe(true);
    });

    it('is false with no purchase API, and off-platform', () => {
        expect(hostWithoutPay().available).toBe(false);
        setPlatform({ name: 'web', devicePixelRatio: () => 1 } as unknown as PlatformAdapter);
        expect(api.available).toBe(false);
    });
});

describe('request', () => {
    it('sends the offer, the quantity and the zone', async () => {
        const h = host();
        await h.api.request({ offerId: 'offer-1', quantity: 3, zoneId: '7' });
        expect(h.calls[0]).toMatchObject({ mode: 'game', offerId: 'offer-1', buyQuantity: 3, zoneId: '7' });
    });

    it('defaults the zone rather than leaving it to the host', async () => {
        const h = host();
        await h.api.request({ offerId: 'o', quantity: 1 });
        expect(h.calls[0].zoneId).toBe('1');
    });

    it('names the one platform this is allowed on', async () => {
        const h = host();
        await h.api.request({ offerId: 'o', quantity: 1 });
        expect(h.calls[0].platform).toBe('android');
    });

    it('asks for the sandbox only when told to', async () => {
        const real = host();
        await real.api.request({ offerId: 'o', quantity: 1 });
        expect(real.calls[0].env).toBeUndefined();

        const test = host();
        await test.api.request({ offerId: 'o', quantity: 1, sandbox: true });
        expect(test.calls[0].env).toBe(1);
    });

    it('carries the host\'s message AND code, without interpreting either', async () => {
        // A cancel and a failure need different UI, and only the host can tell
        // them apart — a mapping invented here is a guess a game branches on.
        const h = host({ pay: (o) => o.fail?.({ errMsg: 'requestMidasPayment:fail cancel', errCode: 2 }) });
        await expect(h.api.request({ offerId: 'o', quantity: 1 }))
            .rejects.toMatchObject({ message: expect.stringContaining('cancel'), code: 2 });
    });

    it('rejects on iOS instead of charging, and says why', async () => {
        const h = host({ where: 'ios' });
        await expect(h.api.request({ offerId: 'o', quantity: 1 })).rejects.toThrow(/not available on this platform/);
        expect(h.calls).toEqual([]);
    });

    it('rejects rather than hanging where nothing is sold', async () => {
        await expect(hostWithoutPay().request({ offerId: 'o', quantity: 1 })).rejects.toThrow(/not available/);
    });
});
