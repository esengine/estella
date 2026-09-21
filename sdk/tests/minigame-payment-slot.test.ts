// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A vendor whose payment is not WeChat's can supply its own.
 *
 * The family's purchase path is `requestMidasPayment` with WeChat's rules —
 * Android only, Midas field names. Applied to every vendor it makes `canPay()`
 * answer false for a host that does sell things, and `requestPayment` reject
 * with "this host sells nothing". A profile had no way to correct that.
 */
import { describe, it, expect, vi } from 'vitest';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import type { MiniGameGlobal, MiniGameProfile } from '../src/platform/minigame';

/** A host with no WeChat payment call — which is every vendor but one. */
const hostWithoutMidas = (): MiniGameGlobal => ({
    getSystemInfoSync: () => ({ platform: 'android' }),
} as unknown as MiniGameGlobal);

const profile = (over: Partial<MiniGameProfile> = {}): MiniGameProfile => ({
    id: 'douyin', hostLabel: '抖音', global: hostWithoutMidas(), ...over,
} as MiniGameProfile);

describe('a mini-game vendor that sells things its own way', () => {
    it('says it can sell, where the family alone would say it cannot', () => {
        expect(new MiniGamePlatformAdapter(profile()).canPay()).toBe(false);
        const own = profile({ pay: { can: () => true, request: async () => {} } });
        expect(new MiniGamePlatformAdapter(own).canPay()).toBe(true);
    });

    it('is the one asked to charge, with the request untouched', async () => {
        const request = vi.fn(async () => {});
        const own = profile({ pay: { can: () => true, request } });
        await new MiniGamePlatformAdapter(own).requestPayment({ offerId: 'o1', quantity: 10 });
        expect(request).toHaveBeenCalledWith({ offerId: 'o1', quantity: 10 });
    });

    it('carries its own refusal, rather than the family\'s', async () => {
        const own = profile({
            pay: { can: () => true, request: () => Promise.reject(new Error('the player cancelled')) },
        });
        await expect(new MiniGamePlatformAdapter(own).requestPayment({ offerId: 'o1', quantity: 1 }))
            .rejects.toThrow('the player cancelled');
    });

    // Unclaimed is the honest answer until a vendor doc or a device names the
    // call: a purchase path invented from a guess charges through nothing.
    it('reports no purchase at all when the profile claims none', async () => {
        await expect(new MiniGamePlatformAdapter(profile()).requestPayment({ offerId: 'o1', quantity: 1 }))
            .rejects.toThrow('sells nothing');
    });
});
